/* ============================================================
   Construa Fácil — Ferramentas (content script)
   - Filtros "estilo Excel" no cabeçalho de cada coluna (funil ▾)
   - Produtividade do órgão (registro + relatório mensal CSV)
   - Relatório da tabela atual (contagem por coluna + CSV)
   Tudo salvo localmente (chrome.storage.local). UI em Shadow DOM.
   ============================================================ */

(() => {
  if (window.__cfTools) return;
  window.__cfTools = true;

  const HOST_KEY = "cfTools:" + location.hostname;
  const PROD_KEY = "cfTools:prod:records";
  let state = { tableIndex: 0, groupCol: -1 };

  // Gravação automática em arquivo (File System Access API) e fila de downloads.
  let regFileHandle = null;          // handle do arquivo .csv escolhido pelo usuário
  let DL_GAP_MS = 1500;              // intervalo entre downloads na fila
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CSV_HEADER = "Data do registro;Nº Solicitação;Órgão;Tipo;Resultado;Analista\n";

  /* ===================== utilidades de tabela ===================== */

  function getTables() {
    const grids = [...document.querySelectorAll('table[role="grid"]')];
    if (grids.length) return grids;
    return [...document.querySelectorAll("table")].filter(
      (t) => t.querySelector("thead") && t.querySelectorAll("tr").length >= 2
    );
  }
  function getTableLabel(table, i) {
    const c = table.closest(".ui-datatable");
    if (c) {
      const h = c.querySelector(".ui-datatable-header");
      if (h && h.textContent.trim()) return h.textContent.trim().slice(0, 45);
    }
    return `Tabela ${i + 1} (${getHeaders(table).slice(0, 3).join(" · ")})`;
  }
  function getHeaderCells(table) {
    let cells = table.querySelectorAll("thead th, thead td");
    if (!cells.length) {
      const fr = table.querySelector("tr");
      cells = fr ? fr.querySelectorAll("th, td") : [];
    }
    return [...cells];
  }
  function getHeaders(table) {
    return getHeaderCells(table).map((c, i) => {
      // Pega só o título da coluna (ignora ícones de ordenação).
      const t = (c.querySelector(".ui-column-title") || c).textContent.trim();
      return t || `Coluna ${i + 1}`;
    });
  }
  function getBodyRows(table) {
    const tb = table.querySelector("tbody");
    if (tb) return [...tb.querySelectorAll("tr")];
    return [...table.querySelectorAll("tr")].slice(1);
  }
  function cellText(row, i) {
    const c = row.querySelectorAll("td, th")[i];
    return c ? (c.textContent || "").trim() : "";
  }
  function parseDate(str) {
    if (!str) return null;
    str = str.trim();
    let m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { let [, d, mo, y] = m; if (y.length === 2) y = "20" + y; const dt = new Date(+y, +mo - 1, +d); return isNaN(dt) ? null : dt; }
    m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { const dt = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(dt) ? null : dt; }
    return null;
  }
  function isDateColumn(table, ci) {
    const rows = getBodyRows(table);
    let dates = 0, filled = 0;
    rows.slice(0, 20).forEach((r) => { const v = cellText(r, ci); if (v) { filled++; if (parseDate(v)) dates++; } });
    return filled > 0 && dates / filled >= 0.6;
  }

  /* ===================== leitura de campos do processo ===================== */

  function readFieldByRegex(re) {
    const lab = [...document.querySelectorAll("label")].find((l) => re.test((l.textContent || "").trim()));
    if (!lab) return "";
    const td = lab.closest("td");
    if (td && td.nextElementSibling) {
      const inp = td.nextElementSibling.querySelector("input, textarea, select");
      return inp ? (inp.value || "").trim() : td.nextElementSibling.textContent.trim();
    }
    return "";
  }
  function getMyOrgao() {
    const el = document.querySelector(".saudacao-texto");
    if (!el) return "";
    const m = el.textContent.match(/ORG[ÃA]O\s*-\s*([A-Za-zÀ-ú0-9\-]+)/i);
    return m ? m[1].trim().toUpperCase() : "";
  }
  function getAnalista() {
    const el = document.querySelector(".saudacao-texto");
    if (!el) return "";
    const m = el.textContent.match(/,\s*(.+?)\s*-\s*ANALISTA/i);
    return m ? m[1].trim() : "";
  }
  const getProcesso = () => readFieldByRegex(/^n\W*solicita/i);
  const getTipoSolicitacao = () => readFieldByRegex(/^tipo da solicita/i);

  function detectOutcome(myOrgao) {
    if (!myOrgao) return null;
    const up = (s) => (s || "").toUpperCase();
    const mo = up(myOrgao);
    const tables = getTables();
    for (const t of tables) {
      const h = getHeaders(t).map(up);
      const oi = h.findIndex((x) => x.includes("RG"));
      const ti = h.findIndex((x) => x.startsWith("TIPO"));
      if (oi < 0 || ti < 0) continue;
      for (const row of getBodyRows(t))
        if (up(cellText(row, oi)).includes(mo) && up(cellText(row, ti)).includes("PEND")) return "pendencia";
    }
    for (const t of tables) {
      const h = getHeaders(t).map(up);
      const si = h.findIndex((x) => x.includes("SIGLA"));
      if (si < 0) continue;
      for (const row of getBodyRows(t)) if (up(cellText(row, si)).includes(mo)) return "analisado";
    }
    return null;
  }

  /* ===================== armazenamento ===================== */

  const loadRecords = () => new Promise((res) => { try { chrome.storage.local.get(PROD_KEY, (r) => res((r && r[PROD_KEY]) || [])); } catch (e) { res([]); } });
  const saveRecords = (l) => { try { chrome.storage.local.set({ [PROD_KEY]: l }); } catch (e) {} };
  const saveState = () => { try { chrome.storage.local.set({ [HOST_KEY]: state }); } catch (e) {} };

  async function logOutcome(resultado) {
    const orgao = getMyOrgao(), processo = getProcesso();
    if (!processo) { alert("Não encontrei o Nº da Solicitação. Abra a página de detalhe de um processo."); return; }
    const list = await loadRecords();
    const id = processo + "|" + orgao;
    const rec = { id, processo, orgao, resultado, tipo: getTipoSolicitacao(), analista: getAnalista(), dataISO: new Date().toISOString() };
    const idx = list.findIndex((r) => r.id === id);
    let msg; if (idx >= 0) { list[idx] = rec; msg = "Registro atualizado"; } else { list.push(rec); msg = "Registrado"; }
    saveRecords(list);
    let extra = "";
    if (regFileHandle) { const ok = await appendRecordToFile(rec); extra = ok ? " · gravado no arquivo ✔" : " · (não gravou no arquivo)"; }
    refreshProdInfo(`${msg}: ${processo} → ${resultado === "analisado" ? "Analisado" : "Com pendência"}${extra}`);
  }

  /* ===================== gravação automática em arquivo (File System Access) ===================== */
  // O navegador não permite escrever em arquivos sem permissão. Aqui o usuário
  // escolhe um .csv UMA vez (showSaveFilePicker); guardamos o handle no IndexedDB
  // do site e, a cada registro, acrescentamos uma linha. Requer contexto seguro (HTTPS).

  const IDB_NAME = "cfToolsDB", IDB_STORE = "handles", FILE_KEY = "registroFile";
  const fsSupported = () => typeof window.showSaveFilePicker === "function";

  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) { const db = await idbOpen(); return new Promise((res, rej) => { const q = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function idbSet(key, val) { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, "readwrite"); tx.objectStore(IDB_STORE).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
  async function idbDel(key) { const db = await idbOpen(); return new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, "readwrite"); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }

  const csvCell = (s) => (s == null ? "" : String(s)).replace(/[;\n\r]/g, ",");
  const csvLineFor = (r) => `${fmtDate(r.dataISO)};${csvCell(r.processo)};${csvCell(r.orgao)};${csvCell(r.tipo)};${lbl(r.resultado)};${csvCell(r.analista)}\n`;

  async function ensureRW(handle) {
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if ((await handle.requestPermission(opts)) === "granted") return true;
    return false;
  }

  async function pickRegistroFile() {
    if (!fsSupported()) {
      updateFileStatus("Indisponível aqui. Para gravar em arquivo, acesse o sistema por HTTPS (https://…). O export manual continua funcionando.", "no");
      return;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "produtividade_construafacil.csv",
        types: [{ description: "Planilha CSV", accept: { "text/csv": [".csv"] } }],
      });
      if (!(await ensureRW(handle))) { updateFileStatus("Permissão de escrita negada para o arquivo.", "no"); return; }
      regFileHandle = handle;
      try { await idbSet(FILE_KEY, handle); } catch (e) {}
      // se for um arquivo novo/vazio, escreve o cabeçalho
      try { const f = await handle.getFile(); if (f.size === 0) { const w = await handle.createWritable(); await w.write(new Blob(["﻿" + CSV_HEADER])); await w.close(); } } catch (e) {}
      updateFileStatus("Gravando automaticamente em: " + handle.name, "ok");
    } catch (e) {
      if (e && e.name === "AbortError") return; // usuário cancelou
      updateFileStatus("Não foi possível escolher o arquivo.", "no");
    }
  }

  async function appendRecordToFile(rec) {
    if (!regFileHandle) return false;
    if (!(await ensureRW(regFileHandle))) { updateFileStatus("Permissão para gravar foi negada.", "no"); return false; }
    try {
      let f = await regFileHandle.getFile();
      let size = f.size;
      const w = await regFileHandle.createWritable({ keepExistingData: true });
      let out = "";
      if (size === 0) out = "﻿" + CSV_HEADER; // arquivo vazio: garante cabeçalho
      out += csvLineFor(rec);
      await w.seek(size);
      await w.write(out);
      await w.close();
      updateFileStatus("Gravando automaticamente em: " + regFileHandle.name, "ok");
      return true;
    } catch (e) {
      updateFileStatus("Falha ao gravar (o arquivo foi movido, renomeado ou excluído?). Escolha-o de novo.", "no");
      return false;
    }
  }

  async function forgetRegistroFile() {
    regFileHandle = null;
    try { await idbDel(FILE_KEY); } catch (e) {}
    updateFileStatus("Gravação automática desligada. Os registros ficam no navegador até exportar.", null);
  }

  async function restoreRegistroFile() {
    if (!fsSupported()) { updateFileStatus("Gravação em arquivo indisponível (precisa de HTTPS). Use o export manual.", null); return; }
    try {
      const h = await idbGet(FILE_KEY);
      if (!h) return;
      regFileHandle = h;
      const perm = await h.queryPermission({ mode: "readwrite" });
      if (perm === "granted") updateFileStatus("Gravando automaticamente em: " + h.name, "ok");
      else updateFileStatus("Arquivo: " + h.name + " — ao registrar, o navegador vai pedir permissão (clique permitir).", null);
    } catch (e) {}
  }

  /* ===================== MOTOR DE FILTROS (estilo Excel) ===================== */
  // Estado por tabela: WeakMap(table -> { colIndex: filtro })
  // filtro: {type:'values', set:Set} | {type:'date', from:Date|null, to:Date|null}
  const FILT = new WeakMap();
  const getFilters = (t) => { if (!FILT.has(t)) FILT.set(t, {}); return FILT.get(t); };

  function applyAll(table) {
    const f = getFilters(table);
    const active = Object.entries(f);
    let visible = 0, total = 0;
    getBodyRows(table).forEach((row) => {
      total++;
      let show = true;
      for (const [ci, filt] of active) {
        const val = cellText(row, +ci);
        if (filt.type === "values") {
          if (!filt.set.has(val || "(vazio)")) { show = false; break; }
        } else if (filt.type === "date") {
          const d = parseDate(val);
          if (filt.from && (!d || d < filt.from)) { show = false; break; }
          if (filt.to && (!d || d > filt.to)) { show = false; break; }
        }
      }
      row.style.display = show ? "" : "none";
      if (show) visible++;
    });
    updateHeaderIcons(table);
    return { visible, total };
  }

  // Reordena as linhas da tabela pela data da coluna ci (mantém o filtro vigente).
  function sortByDate(table, ci, dir) {
    const tb = table.querySelector("tbody");
    if (!tb) return;
    const rows = [...tb.querySelectorAll(":scope > tr")];
    const sign = dir === "asc" ? 1 : -1;
    rows
      .map((row, i) => ({ row, i, d: parseDate(cellText(row, ci)) }))
      .sort((a, b) => {
        // linhas sem data válida vão para o fim, preservando a ordem original
        if (!a.d && !b.d) return a.i - b.i;
        if (!a.d) return 1;
        if (!b.d) return -1;
        const diff = a.d - b.d;
        return diff !== 0 ? sign * diff : a.i - b.i;
      })
      .forEach((o) => tb.appendChild(o.row));
  }

  function clearAllFilters() {
    getTables().forEach((t) => { FILT.set(t, {}); getBodyRows(t).forEach((r) => (r.style.display = "")); updateHeaderIcons(t); });
  }

  // Injeta o botão de funil em cada cabeçalho da tabela.
  function attachFilters(table) {
    const cells = getHeaderCells(table);
    const headers = getHeaders(table);
    cells.forEach((th, ci) => {
      const name = (headers[ci] || "").toLowerCase();
      if (!name || name === "ações" || name === "acoes") return; // sem filtro útil
      if (th.querySelector(".cf-fbtn")) return; // já injetado
      const btn = document.createElement("button");
      btn.className = "cf-fbtn";
      btn.title = "Filtrar coluna";
      btn.innerHTML = funnelSVG();
      // estilos inline para sobreviver ao CSS do site
      Object.assign(btn.style, {
        marginLeft: "6px", border: "1px solid #cdd6df", background: "#fff",
        borderRadius: "5px", cursor: "pointer", padding: "1px 3px", lineHeight: "0",
        verticalAlign: "middle", display: "inline-flex", alignItems: "center"
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        openDropdown(table, ci, btn);
      });
      th.appendChild(btn);
    });
    updateHeaderIcons(table);
  }

  function funnelSVG(active) {
    const c = active ? "#0b5d3b" : "#5b6b7a";
    const fill = active ? "#0b5d3b" : "none";
    return `<svg width="11" height="11" viewBox="0 0 16 16" fill="${fill}" stroke="${c}" stroke-width="1.4" stroke-linejoin="round"><path d="M1.5 2.5h13L9.5 8.2V14l-3-1.6V8.2z"/></svg>`;
  }

  function updateHeaderIcons(table) {
    const f = getFilters(table);
    getHeaderCells(table).forEach((th, ci) => {
      const btn = th.querySelector(".cf-fbtn");
      if (!btn) return;
      const on = !!f[ci];
      btn.innerHTML = funnelSVG(on);
      btn.style.borderColor = on ? "#0b5d3b" : "#cdd6df";
      btn.style.background = on ? "#e7f4ec" : "#fff";
    });
  }

  /* ===================== dropdown do filtro (no Shadow DOM) ===================== */

  let drop; // elemento único reutilizado
  let dropCtx = null; // {table, ci}

  function openDropdown(table, ci, btn) {
    dropCtx = { table, ci };
    const headers = getHeaders(table);
    const f = getFilters(table);
    const dateCol = isDateColumn(table, ci);

    let inner = `<div class="fd-title">${headers[ci] || "Coluna"}</div>`;
    if (dateCol) {
      const cur = f[ci] && f[ci].type === "date" ? f[ci] : { from: null, to: null };
      const fromV = cur.from ? cur.from.toISOString().slice(0, 10) : "";
      const toV = cur.to ? cur.to.toISOString().slice(0, 10) : "";
      inner += `
        <div class="fd-row2">
          <div><label>De</label><input type="date" id="fd-from" value="${fromV}"></div>
          <div><label>Até</label><input type="date" id="fd-to" value="${toV}"></div>
        </div>
        <label class="fd-all" style="margin-top:2px">Ordenar por esta data</label>
        <div class="fd-row2">
          <button class="fd-sort" id="fd-sort-desc" title="Datas mais recentes primeiro">⬇ Mais novo → antigo</button>
          <button class="fd-sort" id="fd-sort-asc" title="Datas mais antigas primeiro">⬆ Antigo → novo</button>
        </div>`;
    } else {
      // valores distintos + contagem
      const counts = new Map();
      getBodyRows(table).forEach((r) => { const v = cellText(r, ci) || "(vazio)"; counts.set(v, (counts.get(v) || 0) + 1); });
      const vals = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
      const sel = f[ci] && f[ci].type === "values" ? f[ci].set : null;
      inner += `<input type="text" id="fd-search" placeholder="Buscar...">`;
      inner += `<label class="fd-all"><input type="checkbox" id="fd-allchk"> Selecionar tudo</label>`;
      inner += `<div class="fd-list" id="fd-list">` + vals.map(([v, n]) => {
        const checked = !sel || sel.has(v) ? "checked" : "";
        return `<label class="fd-item" data-v="${encodeURIComponent(v)}"><input type="checkbox" class="fd-chk" ${checked}> <span class="fd-vt">${v}</span> <span class="fd-ct">${n}</span></label>`;
      }).join("") + `</div>`;
    }
    inner += `<div class="fd-actions"><button class="fd-clear">Limpar</button><button class="fd-apply">Aplicar</button></div>`;
    drop.innerHTML = inner;
    drop.dataset.mode = dateCol ? "date" : "values";

    // posiciona perto do botão
    const r = btn.getBoundingClientRect();
    drop.style.display = "block";
    const w = 230;
    let left = Math.min(r.left, window.innerWidth - w - 10);
    drop.style.left = Math.max(8, left) + "px";
    drop.style.top = r.bottom + 4 + "px";

    // eventos internos
    if (!dateCol) {
      const list = drop.querySelector("#fd-list");
      const allchk = drop.querySelector("#fd-allchk");
      const chks = () => [...list.querySelectorAll(".fd-chk")];
      const syncAll = () => { const cs = chks().filter((c) => c.closest(".fd-item").style.display !== "none"); allchk.checked = cs.length && cs.every((c) => c.checked); };
      syncAll();
      allchk.addEventListener("change", () => { chks().forEach((c) => { if (c.closest(".fd-item").style.display !== "none") c.checked = allchk.checked; }); });
      drop.querySelector("#fd-search").addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase();
        list.querySelectorAll(".fd-item").forEach((it) => {
          const v = decodeURIComponent(it.dataset.v).toLowerCase();
          it.style.display = v.includes(q) ? "" : "none";
        });
        syncAll();
      });
    }
    if (dateCol) {
      const sd = drop.querySelector("#fd-sort-desc");
      const sa = drop.querySelector("#fd-sort-asc");
      if (sd) sd.addEventListener("click", () => { applyDropdown(); sortByDate(table, ci, "desc"); });
      if (sa) sa.addEventListener("click", () => { applyDropdown(); sortByDate(table, ci, "asc"); });
    }
    drop.querySelector(".fd-apply").addEventListener("click", () => applyDropdown());
    drop.querySelector(".fd-clear").addEventListener("click", () => { delete getFilters(table)[ci]; applyAll(table); closeDropdown(); });
  }

  function applyDropdown() {
    if (!dropCtx) return;
    const { table, ci } = dropCtx;
    const f = getFilters(table);
    if (drop.dataset.mode === "date") {
      const fromV = drop.querySelector("#fd-from").value;
      const toV = drop.querySelector("#fd-to").value;
      const from = fromV ? new Date(fromV + "T00:00:00") : null;
      const to = toV ? new Date(toV + "T23:59:59") : null;
      if (!from && !to) delete f[ci];
      else f[ci] = { type: "date", from, to };
    } else {
      const items = [...drop.querySelectorAll(".fd-item")];
      const total = items.length;
      const set = new Set();
      items.forEach((it) => { if (it.querySelector(".fd-chk").checked) set.add(decodeURIComponent(it.dataset.v)); });
      if (set.size === total || set.size === 0) {
        if (set.size === 0) f[ci] = { type: "values", set }; // nada marcado = esconde tudo
        else delete f[ci]; // tudo marcado = sem filtro
      } else f[ci] = { type: "values", set };
    }
    applyAll(table);
    closeDropdown();
  }
  function closeDropdown() { if (drop) drop.style.display = "none"; dropCtx = null; }

  /* ===================== UI (Shadow DOM) ===================== */

  const hostEl = document.createElement("div");
  hostEl.id = "cf-tools-root"; hostEl.style.all = "initial";
  document.documentElement.appendChild(hostEl);
  const shadow = hostEl.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
    .launcher { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646; width: 52px; height: 52px;
      border-radius: 14px; border: none; cursor: pointer; background: #0b5d3b; color: #fff; font-size: 22px;
      box-shadow: 0 6px 20px rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center; transition: .15s; }
    .launcher:hover { transform: translateY(-2px); background: #0e7048; }
    .panel { position: fixed; right: 18px; bottom: 80px; z-index: 2147483647; width: 360px; max-height: 82vh;
      overflow: auto; background: #fff; color: #1b2733; border-radius: 16px; box-shadow: 0 18px 50px rgba(0,0,0,.28);
      border: 1px solid #e3e8ee; display: none; }
    .panel.open { display: block; }
    .head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: #0b5d3b;
      color: #fff; border-radius: 16px 16px 0 0; position: sticky; top: 0; z-index: 2; }
    .head h1 { margin: 0; font-size: 14px; font-weight: 700; }
    .head .x { background: transparent; border: none; color: #fff; font-size: 18px; cursor: pointer; }
    .body { padding: 12px 16px 18px; }
    .group { margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid #eef2f6; }
    .group:last-child { border-bottom: none; }
    .group h2 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: #6b7785; font-weight: 700; }
    label { display: block; font-size: 12px; color: #41505e; margin: 8px 0 4px; }
    select, input[type="date"], input[type="month"] { width: 100%; padding: 8px 10px; border: 1px solid #cdd6df;
      border-radius: 9px; font-size: 13px; color: #1b2733; background: #fff; }
    .btn { width: 100%; margin-top: 10px; padding: 9px 12px; border: none; border-radius: 9px; font-size: 13px;
      font-weight: 600; cursor: pointer; background: #0b5d3b; color: #fff; }
    .btn:hover { background: #0e7048; }
    .btn.sec { background: #eef2f6; color: #2a3744; } .btn.sec:hover { background: #e2e8ef; }
    .btn.ok { background: #137a43; } .btn.ok:hover { background: #0f6638; }
    .btn.warn { background: #c9821a; } .btn.warn:hover { background: #b0720f; }
    .btn.ghost { background: transparent; color: #0b5d3b; text-decoration: underline; margin-top: 6px; }
    .btn.danger { background: transparent; color: #9b2c2c; text-decoration: underline; margin-top: 6px; }
    .btn.suggested { outline: 3px solid #ffe1a8; }
    .hint { font-size: 11px; color: #8895a2; margin-top: 6px; line-height: 1.4; }
    .info { font-size: 12px; background: #eef6f1; border: 1px solid #cfe6d9; color: #14653f; border-radius: 9px; padding: 8px 10px; line-height: 1.4; }
    .info b { color: #0b5d3b; }
    .note { font-size: 12px; background: #e7f4ec; color: #0b5d3b; border-radius: 8px; padding: 7px 10px; margin-top: 8px; }
    table.report { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    table.report th, table.report td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eef2f6; }
    table.report th { color: #6b7785; font-weight: 700; }
    table.report td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .total td { font-weight: 700; border-top: 2px solid #cdd6df; }

    /* dropdown do filtro estilo Excel */
    .fdrop { position: fixed; z-index: 2147483647; width: 230px; background: #fff; color: #1b2733;
      border: 1px solid #cdd6df; border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,.22); padding: 10px; display: none; }
    .fd-title { font-size: 12px; font-weight: 700; color: #0b5d3b; margin-bottom: 6px; }
    .fdrop input[type="text"], .fdrop input[type="date"] { width: 100%; padding: 6px 8px; border: 1px solid #cdd6df; border-radius: 7px; font-size: 12px; margin-bottom: 6px; }
    .fd-row2 { display: flex; gap: 6px; } .fd-row2 > div { flex: 1; } .fd-row2 label { margin: 0 0 2px; font-size: 11px; }
    .fd-all { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; margin: 4px 0; }
    .fd-list { max-height: 180px; overflow: auto; border: 1px solid #eef2f6; border-radius: 7px; padding: 4px; }
    .fd-item { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 4px; }
    .fd-item .fd-vt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fd-item .fd-ct { color: #8895a2; font-size: 11px; }
    .fd-actions { display: flex; gap: 6px; margin-top: 8px; }
    .fd-actions button { flex: 1; padding: 7px; border: none; border-radius: 7px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .fd-clear { background: #eef2f6; color: #2a3744; }
    .fd-apply { background: #0b5d3b; color: #fff; }
    .fd-sort { flex: 1; padding: 7px 4px; border: 1px solid #cdd6df; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; background: #f3f8f5; color: #0b5d3b; }
    .fd-sort:hover { background: #e7f4ec; }
  `;
  shadow.appendChild(style);

  drop = document.createElement("div");
  drop.className = "fdrop";
  shadow.appendChild(drop);

  const launcher = document.createElement("button");
  launcher.className = "launcher"; launcher.title = "Ferramentas Construa Fácil"; launcher.textContent = "⚙";
  shadow.appendChild(launcher);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="head"><h1>Ferramentas — Construa Fácil</h1><button class="x" title="Fechar">×</button></div>
    <div class="body">

      <div class="group">
        <h2>Produtividade do órgão</h2>
        <div class="info" id="cf-prodInfo">Abra um processo para registrar.</div>
        <div class="hint" id="cf-suggest"></div>
        <button class="btn ok" id="cf-logOk">✓ Registrar: Analisado (aprovado)</button>
        <button class="btn warn" id="cf-logWarn">⚠ Registrar: Com pendência</button>
        <div class="note" id="cf-prodMsg" style="display:none"></div>

        <label style="margin-top:14px">Gravação automática em arquivo</label>
        <button class="btn sec" id="cf-pickFile">📄 Escolher arquivo de registro (.csv)</button>
        <div class="hint" id="cf-fileStatus">Nenhum arquivo escolhido. Cada registro fica só no navegador até você exportar.</div>
        <button class="btn danger" id="cf-forgetFile">Desligar gravação automática</button>

        <label style="margin-top:14px">Relatório mensal — escolha o mês</label>
        <input type="month" id="cf-month" value="${thisMonth}">
        <button class="btn" id="cf-buildMonth">Gerar relatório do mês</button>
        <div id="cf-monthArea"></div>
        <button class="btn ghost" id="cf-exportMonth" style="display:none">Exportar relatório mensal (CSV)</button>
        <button class="btn danger" id="cf-clearRecs">Apagar todos os registros salvos</button>
      </div>

      <div class="group">
        <h2>Baixar anexos da solicitação</h2>
        <div class="info" id="cf-dlInfo">Abra uma solicitação com anexos para baixar.</div>
        <button class="btn" id="cf-dlAll">🗜 Baixar todos os anexos (1 ZIP)</button>
        <p class="hint">Junta todos os anexos em <b>um único arquivo .zip</b>. Você também pode
        marcar as caixinhas nas linhas da tabela e usar <b>Baixar selecionados</b>, ou os botões
        que aparecem na barra verde acima da tabela de anexos.</p>
        <button class="btn ghost" id="cf-dlAllSeq">Baixar um a um (sem ZIP)</button>
        <label style="margin-top:10px">Intervalo do modo "um a um" (segundos)</label>
        <input type="number" id="cf-dlGap" min="0.3" max="10" step="0.1" value="1.5">
      </div>

      <div class="group">
        <h2>Filtros da tabela (estilo Excel)</h2>
        <div class="info">Clique no funil <b>▾</b> que aparece no cabeçalho de cada coluna para filtrar.
        Use a coluna <b>Data</b> para filtrar por período. Os filtros se combinam entre si.</div>
        <button class="btn sec" id="cf-clearAll">Limpar todos os filtros</button>
        <button class="btn ghost" id="cf-reattach">Reativar funis (se sumirem)</button>
      </div>

      <div class="group">
        <h2>Relatório da tabela atual</h2>
        <label>Tabela</label>
        <select id="cf-table"></select>
        <p class="hint" id="cf-noTable" style="display:none">Nenhuma tabela de dados nesta tela.</p>
        <label>Agrupar por</label>
        <select id="cf-groupCol"></select>
        <button class="btn" id="cf-buildReport">Gerar relatório</button>
        <div id="cf-reportArea"></div>
        <button class="btn ghost" id="cf-exportCsv" style="display:none">Exportar CSV</button>
        <p class="hint">Considera só as linhas visíveis (respeita os filtros) da página atual.</p>
      </div>

    </div>
  `;
  shadow.appendChild(panel);
  const $ = (s) => shadow.querySelector(s);

  function updateFileStatus(text, kind) {
    const el = $("#cf-fileStatus"); if (!el) return;
    el.textContent = text;
    el.style.color = kind === "ok" ? "#0b5d3b" : kind === "no" ? "#9b2c2c" : "#8895a2";
    el.style.fontWeight = kind === "ok" ? "600" : "400";
  }

  /* ===================== painel: seletores e produtividade ===================== */

  function refreshUI() {
    const tables = getTables();
    const sel = $("#cf-table");
    if (!tables.length) { $("#cf-noTable").style.display = "block"; sel.innerHTML = ""; }
    else {
      $("#cf-noTable").style.display = "none";
      sel.innerHTML = tables.map((t, i) => `<option value="${i}">${getTableLabel(t, i)}</option>`).join("");
      if (state.tableIndex >= tables.length) state.tableIndex = 0;
      sel.value = state.tableIndex;
      populateColumns();
    }
    refreshProdInfo();
    initAnexos();
    refreshAnexoInfo();
  }
  function populateColumns() {
    const table = getTables()[state.tableIndex];
    if (!table) return;
    const headers = getHeaders(table);
    $("#cf-groupCol").innerHTML = headers.map((h, i) => `<option value="${i}">${h}</option>`).join("");
    if (state.groupCol < 0) {
      const g = headers.findIndex((h) => /status|situa|respons|tipo|setor|fiscal|[óo]rg[ãa]o|sigla|v[áa]lid/i.test(h));
      state.groupCol = g >= 0 ? g : 0;
    }
    if (state.groupCol >= headers.length) state.groupCol = 0;
    $("#cf-groupCol").value = state.groupCol;
  }

  function refreshProdInfo(message) {
    const orgao = getMyOrgao(), processo = getProcesso();
    const info = $("#cf-prodInfo"), sugg = $("#cf-suggest"), okBtn = $("#cf-logOk"), warnBtn = $("#cf-logWarn");
    okBtn.classList.remove("suggested"); warnBtn.classList.remove("suggested");
    if (processo) {
      info.innerHTML = `Órgão: <b>${orgao || "?"}</b> · Processo: <b>${processo}</b>`;
      okBtn.disabled = false; warnBtn.disabled = false;
      const g = detectOutcome(orgao);
      if (g === "analisado") { sugg.textContent = "Sugestão: Analisado (seu órgão já saiu no histórico)."; okBtn.classList.add("suggested"); }
      else if (g === "pendencia") { sugg.textContent = "Sugestão: Com pendência (seu órgão emitiu comunicado)."; warnBtn.classList.add("suggested"); }
      else sugg.textContent = "Confirme o resultado clicando no botão.";
    } else {
      info.textContent = "Abra a página de detalhe de um processo para registrar.";
      okBtn.disabled = true; warnBtn.disabled = true; sugg.textContent = "";
    }
    if (message) { const m = $("#cf-prodMsg"); m.style.display = "block"; m.textContent = message; }
  }

  /* ===================== relatório da tabela atual ===================== */

  function csvDownload(filename, csv) {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  let lastReport = null;
  function buildReport() {
    const table = getTables()[state.tableIndex];
    if (!table) return;
    const headers = getHeaders(table);
    const groupName = headers[state.groupCol] || "Grupo";
    const counts = new Map(); let total = 0;
    getBodyRows(table).forEach((row) => { if (row.style.display === "none") return; const k = cellText(row, state.groupCol) || "(vazio)"; counts.set(k, (counts.get(k) || 0) + 1); total++; });
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    lastReport = { groupName, rows, total };
    const area = $("#cf-reportArea");
    if (!total) { area.innerHTML = `<p class="hint">Nenhuma linha visível.</p>`; $("#cf-exportCsv").style.display = "none"; return; }
    area.innerHTML = `<table class="report"><thead><tr><th>${groupName}</th><th class="num">Qtd.</th><th class="num">%</th></tr></thead><tbody>` +
      rows.map(([k, n]) => `<tr><td>${k}</td><td class="num">${n}</td><td class="num">${((n / total) * 100).toFixed(1)}%</td></tr>`).join("") +
      `<tr class="total"><td>Total</td><td class="num">${total}</td><td class="num">100%</td></tr></tbody></table>`;
    $("#cf-exportCsv").style.display = "block";
  }
  function exportTableCsv() {
    if (!lastReport) return;
    const { groupName, rows, total } = lastReport;
    let csv = `${groupName};Quantidade;Percentual\n`;
    rows.forEach(([k, n]) => (csv += `${k};${n};${((n / total) * 100).toFixed(1)}%\n`));
    csv += `Total;${total};100%\n`;
    csvDownload(`relatorio-tabela-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  /* ===================== relatório mensal de produtividade ===================== */

  const fmtMonth = (m) => { const [y, mo] = m.split("-"); return `${mo}/${y}`; };
  const fmtDate = (iso) => { const d = new Date(iso); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
  const lbl = (r) => (r === "analisado" ? "Analisado (aprovado)" : "Com pendência");
  let lastMonthData = null;
  async function buildMonthReport() {
    const month = $("#cf-month").value, orgao = getMyOrgao();
    const all = await loadRecords();
    const recs = all.filter((r) => (r.dataISO || "").slice(0, 7) === month && (!orgao || r.orgao === orgao));
    const nOk = recs.filter((r) => r.resultado === "analisado").length;
    const nPend = recs.filter((r) => r.resultado === "pendencia").length;
    lastMonthData = { month, orgao, recs, nOk, nPend };
    const area = $("#cf-monthArea");
    if (!recs.length) { area.innerHTML = `<p class="hint">Nenhum processo registrado em ${fmtMonth(month)}${orgao ? " para " + orgao : ""}.</p>`; $("#cf-exportMonth").style.display = "none"; return; }
    const total = recs.length;
    area.innerHTML = `<table class="report"><thead><tr><th>Resultado</th><th class="num">Qtd.</th><th class="num">%</th></tr></thead><tbody>` +
      `<tr><td>Analisado (aprovado)</td><td class="num">${nOk}</td><td class="num">${((nOk / total) * 100).toFixed(1)}%</td></tr>` +
      `<tr><td>Com pendência</td><td class="num">${nPend}</td><td class="num">${((nPend / total) * 100).toFixed(1)}%</td></tr>` +
      `<tr class="total"><td>Total</td><td class="num">${total}</td><td class="num">100%</td></tr></tbody></table>`;
    $("#cf-exportMonth").style.display = "block";
  }
  function exportMonthCsv() {
    if (!lastMonthData) return;
    const { month, orgao, recs, nOk, nPend } = lastMonthData;
    let csv = `Relatório de Produtividade\nÓrgão;${orgao || "(todos)"}\nMês de referência;${fmtMonth(month)}\n\nResumo\nResultado;Quantidade\nAnalisado (aprovado);${nOk}\nCom pendência;${nPend}\nTotal;${recs.length}\n\nDetalhamento\nData do registro;Nº Solicitação;Tipo;Resultado;Analista\n`;
    recs.slice().sort((a, b) => (a.dataISO < b.dataISO ? -1 : 1)).forEach((r) => {
      csv += `${fmtDate(r.dataISO)};${r.processo};${(r.tipo || "").replace(/;/g, ",")};${lbl(r.resultado)};${(r.analista || "").replace(/;/g, ",")}\n`;
    });
    csvDownload(`produtividade-${orgao || "geral"}-${month}.csv`, csv);
  }
  async function clearRecords() {
    const all = await loadRecords();
    if (!all.length) { refreshProdInfo("Não há registros para apagar."); return; }
    if (!confirm(`Apagar TODOS os ${all.length} registros salvos? Esta ação não pode ser desfeita.`)) return;
    saveRecords([]); $("#cf-monthArea").innerHTML = ""; $("#cf-exportMonth").style.display = "none";
    refreshProdInfo("Todos os registros foram apagados.");
  }

  /* ===================== downloads de anexos (em fila) ===================== */
  // Tabelas de anexos têm colunas "Nome do arquivo" e "Ações". Em cada linha há
  // um botão/link de download (PrimeFaces, via POST). Não dá para baixar tudo de
  // uma vez sem travar o sistema antigo, então clicamos um a um, com intervalo.

  const acoesColIndex = (table) => getHeaders(table).findIndex((h) => /a[cç][õo]es/i.test(h));
  const fileColIndex = (table) => getHeaders(table).findIndex((h) => /arquivo/i.test(h));

  function getAnexoTables() {
    return getTables().filter((t) => {
      const id = ((t.closest(".ui-datatable") || {}).id || "").toLowerCase();
      if (id.includes("anexo")) return true;
      return fileColIndex(t) >= 0 && acoesColIndex(t) >= 0;
    });
  }
  function anexoDataRows(table) {
    return getBodyRows(table).filter((r) => !r.classList.contains("ui-datatable-empty-message") && r.querySelector("td"));
  }
  // Localiza o elemento clicável de download dentro da linha (preferindo o que
  // "parece" download: ícone de seta/baixar). Genérico para sobreviver a mudanças.
  function findDownloadEl(row, acoesIdx) {
    const cells = row.querySelectorAll("td");
    const scope = acoesIdx >= 0 && cells[acoesIdx] ? cells[acoesIdx] : row;
    const cands = [...scope.querySelectorAll("a, button")].filter((el) => !el.classList.contains("cf-dl-pick"));
    if (!cands.length) return null;
    const looksDl = (el) => {
      const inner = el.querySelector("span, i");
      const s = [el.title, el.getAttribute("aria-label"), el.className, inner ? inner.className : "", el.textContent].join(" ").toLowerCase();
      return /down|baix|arrow|salvar|\bsave\b|fa-file|ui-icon-arrowthick/.test(s);
    };
    return cands.find(looksDl) || cands[0];
  }

  function attachAnexoControls(table) {
    const acoesIdx = acoesColIndex(table);
    const rows = anexoDataRows(table);
    if (!rows.length) return;

    // checkbox "marcar todos" no cabeçalho (primeira célula)
    const hCells = getHeaderCells(table);
    if (hCells[0] && !hCells[0].querySelector(".cf-dl-all")) {
      const m = document.createElement("input");
      m.type = "checkbox"; m.className = "cf-dl-all"; m.title = "Marcar/desmarcar todos";
      m.style.cssText = "transform:scale(1.25);cursor:pointer;vertical-align:middle;";
      hCells[0].insertBefore(m, hCells[0].firstChild);
      m.addEventListener("change", () => { anexoDataRows(table).forEach((r) => { const c = r.querySelector(".cf-dl-pick"); if (c) c.checked = m.checked; }); updateDlBar(table); });
    }

    // checkbox por linha + referência ao elemento de download
    rows.forEach((row) => {
      if (row.querySelector(".cf-dl-pick")) return;
      const dl = findDownloadEl(row, acoesIdx);
      if (!dl) return;
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "cf-dl-pick";
      cb.style.cssText = "transform:scale(1.25);margin-right:6px;cursor:pointer;vertical-align:middle;";
      cb._cfDownloadEl = dl;
      cb.addEventListener("change", () => updateDlBar(table));
      const firstCell = row.querySelector("td");
      firstCell.insertBefore(cb, firstCell.firstChild);
    });

    injectDlBar(table);
    updateDlBar(table);
  }

  function injectDlBar(table) {
    const container = table.closest(".ui-datatable") || table;
    const prev = container.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains("cf-dl-bar")) return prev;
    const bar = document.createElement("div");
    bar.className = "cf-dl-bar";
    bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0;padding:8px 10px;background:#e7f4ec;border:1px solid #bfe0cc;border-radius:8px;font-family:'Segoe UI',sans-serif;";
    const info = document.createElement("span");
    info.className = "cf-dl-info";
    info.style.cssText = "font-size:12px;font-weight:700;color:#0b5d3b;margin-right:4px;";
    const bAll = mkDlButton("⬇ Baixar todos");
    const bSel = mkDlButton("⬇ Baixar selecionados");
    bAll.addEventListener("click", () => startDownloads(collectEls([table], "all"), table));
    bSel.addEventListener("click", () => startDownloads(collectEls([table], "sel"), table));
    bar.append(info, bAll, bSel);
    container.parentNode.insertBefore(bar, container);
    bar._table = table;
    return bar;
  }
  function mkDlButton(txt) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = txt;
    b.style.cssText = "border:none;border-radius:7px;padding:6px 11px;background:#0b5d3b;color:#fff;font:600 12px 'Segoe UI',sans-serif;cursor:pointer;";
    b.addEventListener("mouseenter", () => (b.style.background = "#0e7048"));
    b.addEventListener("mouseleave", () => (b.style.background = "#0b5d3b"));
    return b;
  }
  function dlBarFor(table) {
    const container = table.closest(".ui-datatable") || table;
    const prev = container.previousElementSibling;
    return prev && prev.classList && prev.classList.contains("cf-dl-bar") ? prev : null;
  }
  function updateDlBar(table, override) {
    const bar = dlBarFor(table); if (!bar) return;
    const info = bar.querySelector(".cf-dl-info"); if (!info) return;
    let txt = override;
    if (!txt) {
      const rows = anexoDataRows(table);
      const total = rows.filter((r) => { const c = r.querySelector(".cf-dl-pick"); return c && c._cfDownloadEl; }).length;
      const sel = rows.filter((r) => { const c = r.querySelector(".cf-dl-pick"); return c && c.checked; }).length;
      txt = `${total} anexo(s)` + (sel ? ` · ${sel} selecionado(s)` : "");
    }
    if (info.textContent !== txt) info.textContent = txt; // evita re-disparar o MutationObserver
  }

  function collectEls(tables, which) {
    const out = [];
    tables.forEach((t) => anexoDataRows(t).forEach((row) => {
      const cb = row.querySelector(".cf-dl-pick"); const dl = cb && cb._cfDownloadEl;
      if (!dl) return;
      if (which === "all" || cb.checked) out.push(dl);
    }));
    return out;
  }

  /* ---- busca dos bytes de cada anexo (refazendo o POST do PrimeFaces) ---- */

  function filenameFromResponse(resp) {
    const cd = resp.headers.get("content-disposition") || "";
    let m = cd.match(/filename\*=UTF-8''([^;]+)/i); if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    m = cd.match(/filename="?([^";]+)"?/i); if (m) return m[1].trim();
    return "";
  }
  function rowFileName(el) {
    const table = el.closest("table"); const row = el.closest("tr");
    if (!table || !row) return "";
    const fi = fileColIndex(table);
    return fi >= 0 ? cellText(row, fi) : "";
  }
  // Descobre o parâmetro que identifica a ação ao "clicar" o elemento.
  function addTriggerParam(params, el) {
    if (el.tagName === "BUTTON" || (el.tagName === "INPUT" && /submit|image/i.test(el.type || ""))) {
      if (el.name) params.set(el.name, el.value || el.name);
      return;
    }
    const oc = el.getAttribute("onclick") || "";
    // mojarra.jsfcljs(form,{'id':'id'},'') ou PrimeFaces.addSubmitParam('f',{'id':'id'})
    const m = oc.match(/\{\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/);
    if (m) { params.set(m[1], m[2]); return; }
    if (el.id) params.set(el.id, el.id);
  }
  async function fetchAnexoBlob(el, idx) {
    const form = el.closest("form");
    if (!form) throw new Error("sem formulário");
    const params = new URLSearchParams();
    form.querySelectorAll("input[name], select[name], textarea[name]").forEach((inp) => {
      const t = (inp.type || "").toLowerCase();
      if (t === "submit" || t === "button" || t === "image" || t === "file") return;
      if ((t === "checkbox" || t === "radio") && !inp.checked) return;
      if (inp.classList.contains("cf-dl-pick") || inp.classList.contains("cf-dl-all")) return; // checkboxes nossos
      params.append(inp.name, inp.value);
    });
    addTriggerParam(params, el);
    const action = form.getAttribute("action") || location.pathname;
    const url = new URL(action, location.href).href;
    const resp = await fetch(url, { method: "POST", body: params, credentials: "include" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/html") || ct.includes("application/xml")) throw new Error("voltou uma página, não um arquivo");
    const blob = await resp.blob();
    if (!blob.size) throw new Error("arquivo vazio");
    let name = filenameFromResponse(resp) || rowFileName(el) || `anexo_${idx + 1}`;
    name = name.replace(/[\\/:*?"<>|]+/g, "_").trim() || `anexo_${idx + 1}`;
    return { blob, name };
  }
  function uniqueName(name, files) {
    let base = name, ext = "";
    const dot = name.lastIndexOf(".");
    if (dot > 0) { base = name.slice(0, dot); ext = name.slice(dot); }
    let cand = name, k = 1;
    const has = (n) => files.some((f) => f.name.toLowerCase() === n.toLowerCase());
    while (has(cand)) cand = `${base} (${k++})${ext}`;
    return cand;
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---- gerador de ZIP sem dependências (método "store", sem compressão) ---- */
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = []; const central = []; let offset = 0;
    const u16 = (a, x) => a.push(x & 255, (x >>> 8) & 255);
    const u32 = (a, x) => a.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255);
    for (const f of files) {
      const name = enc.encode(f.name); const data = f.data; const crc = crc32(data); const n = data.length; const at = offset;
      const lh = []; u32(lh, 0x04034b50); u16(lh, 20); u16(lh, 0x0800); u16(lh, 0); u16(lh, 0); u16(lh, 0); u32(lh, crc); u32(lh, n); u32(lh, n); u16(lh, name.length); u16(lh, 0);
      const lhu = new Uint8Array(lh); parts.push(lhu, name, data); offset += lhu.length + name.length + n;
      const ch = []; u32(ch, 0x02014b50); u16(ch, 20); u16(ch, 20); u16(ch, 0x0800); u16(ch, 0); u16(ch, 0); u16(ch, 0); u32(ch, crc); u32(ch, n); u32(ch, n); u16(ch, name.length); u16(ch, 0); u16(ch, 0); u16(ch, 0); u16(ch, 0); u32(ch, 0); u32(ch, at);
      central.push(new Uint8Array(ch), name);
    }
    const cdStart = offset; let cdSize = 0;
    central.forEach((u) => { parts.push(u); cdSize += u.length; offset += u.length; });
    const eo = []; u32(eo, 0x06054b50); u16(eo, 0); u16(eo, 0); u16(eo, files.length); u16(eo, files.length); u32(eo, cdSize); u32(eo, cdStart); u16(eo, 0);
    parts.push(new Uint8Array(eo));
    const total = parts.reduce((a, u) => a + u.length, 0); const out = new Uint8Array(total); let p = 0;
    for (const u of parts) { out.set(u, p); p += u.length; }
    return out;
  }

  let downloading = false;
  // Modo principal: junta tudo em UM zip.
  async function startDownloads(els, table) {
    if (downloading) { alert("Já há um download em andamento. Aguarde terminar."); return; }
    const setStatus = (t) => (table ? updateDlBar(table, t) : refreshAnexoInfo(t));
    const clearStatus = (ms) => setTimeout(() => (table ? updateDlBar(table) : refreshAnexoInfo()), ms);
    if (!els.length) { setStatus("Nenhum anexo marcado/disponível."); clearStatus(2500); return; }
    if (!confirm(`Baixar ${els.length} anexo(s) em um único arquivo ZIP?`)) return;
    downloading = true;
    try {
      const files = []; const failed = [];
      for (let i = 0; i < els.length; i++) {
        setStatus(`Baixando ${i + 1}/${els.length}…`);
        try {
          const { blob, name } = await fetchAnexoBlob(els[i], i);
          const data = new Uint8Array(await blob.arrayBuffer());
          files.push({ name: uniqueName(name, files), data });
        } catch (e) { failed.push(rowFileName(els[i]) || `anexo ${i + 1}`); }
        await sleep(120);
      }
      if (!files.length) {
        setStatus("Não consegui obter os anexos. Nenhum ZIP gerado.");
        alert("Não foi possível baixar os anexos para o ZIP.\n\nProvável causa: o botão de download da tabela é diferente do esperado. Me envie o HTML de uma linha de anexo para eu ajustar.\n\nEnquanto isso, tente \"Baixar um a um (sem ZIP)\".");
        clearStatus(100); return;
      }
      setStatus("Compactando…");
      const zip = makeZip(files);
      const proc = (getProcesso() || "solicitacao").replace(/[^\w.-]+/g, "_");
      downloadBlob(new Blob([zip], { type: "application/zip" }), `anexos-${proc}-${new Date().toISOString().slice(0, 10)}.zip`);
      let msg = `ZIP gerado com ${files.length} arquivo(s).`;
      if (failed.length) { msg += ` ${failed.length} falhou(aram).`; alert(`${failed.length} anexo(s) não entraram no ZIP:\n- ${failed.join("\n- ")}\n\nOs outros ${files.length} foram compactados normalmente.`); }
      setStatus(msg); clearStatus(6000);
    } finally { downloading = false; }
  }

  // Reserva: baixa um a um na pasta Downloads (sem zip), clicando os botões.
  async function clickDownloadsOneByOne(els, table) {
    if (downloading) { alert("Já há um download em andamento. Aguarde terminar."); return; }
    const setStatus = (t) => (table ? updateDlBar(table, t) : refreshAnexoInfo(t));
    if (!els.length) { setStatus("Nenhum anexo marcado/disponível."); setTimeout(() => (table ? updateDlBar(table) : refreshAnexoInfo()), 2500); return; }
    if (!confirm(`Baixar ${els.length} anexo(s) um a um (intervalo de ${(DL_GAP_MS / 1000).toFixed(1)}s)?`)) return;
    downloading = true;
    try {
      for (let i = 0; i < els.length; i++) {
        setStatus(`Baixando ${i + 1}/${els.length}…`);
        try { els[i].click(); } catch (e) {}
        if (i < els.length - 1) await sleep(DL_GAP_MS);
      }
      setStatus(`Concluído: ${els.length} anexo(s) enviados.`);
      setTimeout(() => (table ? updateDlBar(table) : refreshAnexoInfo()), 4000);
    } finally { downloading = false; }
  }

  function refreshAnexoInfo(override) {
    const el = $("#cf-dlInfo"), btn = $("#cf-dlAll"); if (!el) return;
    if (override) { el.textContent = override; return; }
    const tables = getAnexoTables();
    const n = tables.reduce((a, t) => a + anexoDataRows(t).length, 0);
    if (!n) { el.textContent = "Nenhum anexo encontrado nesta página."; if (btn) btn.disabled = true; }
    else { el.innerHTML = `<b>${n}</b> anexo(s) encontrado(s) na página.`; if (btn) btn.disabled = false; }
  }

  function initAnexos() { getAnexoTables().forEach((t) => { injectDlBar(t); attachAnexoControls(t); }); }

  /* ===================== eventos ===================== */

  launcher.addEventListener("click", () => { panel.classList.toggle("open"); if (panel.classList.contains("open")) refreshUI(); });
  $(".x").addEventListener("click", () => panel.classList.remove("open"));
  $("#cf-table").addEventListener("change", (e) => { state.tableIndex = +e.target.value; state.groupCol = -1; populateColumns(); saveState(); });
  $("#cf-groupCol").addEventListener("change", (e) => { state.groupCol = +e.target.value; saveState(); });
  $("#cf-buildReport").addEventListener("click", buildReport);
  $("#cf-exportCsv").addEventListener("click", exportTableCsv);
  $("#cf-logOk").addEventListener("click", () => logOutcome("analisado"));
  $("#cf-logWarn").addEventListener("click", () => logOutcome("pendencia"));
  $("#cf-buildMonth").addEventListener("click", buildMonthReport);
  $("#cf-exportMonth").addEventListener("click", exportMonthCsv);
  $("#cf-clearRecs").addEventListener("click", clearRecords);
  $("#cf-pickFile").addEventListener("click", pickRegistroFile);
  $("#cf-forgetFile").addEventListener("click", forgetRegistroFile);
  $("#cf-dlAll").addEventListener("click", () => startDownloads(collectEls(getAnexoTables(), "all"), null));
  $("#cf-dlAllSeq").addEventListener("click", () => clickDownloadsOneByOne(collectEls(getAnexoTables(), "all"), null));
  $("#cf-dlGap").addEventListener("change", (e) => { const v = parseFloat(e.target.value); if (v >= 0.3 && v <= 10) DL_GAP_MS = Math.round(v * 1000); else e.target.value = (DL_GAP_MS / 1000).toFixed(1); });
  $("#cf-clearAll").addEventListener("click", clearAllFilters);
  $("#cf-reattach").addEventListener("click", () => { getTables().forEach(attachFilters); initAnexos(); });

  // fecha dropdown ao clicar fora
  document.addEventListener("click", (e) => {
    if (drop.style.display !== "block") return;
    const path = e.composedPath();
    if (path.includes(drop)) return;
    if (path.some((el) => el.classList && el.classList.contains("cf-fbtn"))) return;
    closeDropdown();
  }, true);
  window.addEventListener("resize", closeDropdown);

  try { chrome.storage.local.get(HOST_KEY, (res) => { if (res && res[HOST_KEY]) state = Object.assign(state, res[HOST_KEY]); }); } catch (e) {}
  try { chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.action === "openPanel") { panel.classList.add("open"); refreshUI(); } }); } catch (e) {}

  /* ===================== inicialização e auto-reinjeção ===================== */

  function initFilters() { getTables().forEach(attachFilters); }
  initFilters();
  initAnexos();
  restoreRegistroFile();

  // PrimeFaces troca o conteúdo via AJAX (ordenar/paginar). Reinjeta os funis
  // e reaplica os filtros quando a tabela muda.
  let pending = null;
  const obs = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(() => { getTables().forEach((t) => { attachFilters(t); if (Object.keys(getFilters(t)).length) applyAll(t); }); initAnexos(); if (panel.classList.contains("open")) refreshAnexoInfo(); }, 250);
  });
  try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
