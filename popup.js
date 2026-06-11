const statusEl = document.getElementById("status");
const openBtn = document.getElementById("open");
const ALLOWED = "construafacil.semf.teresina.pi.gov.br";

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const url = tab && tab.url ? tab.url : "";
  if (url.includes(ALLOWED)) {
    statusEl.textContent = "Você está no Construa Fácil ✔";
    statusEl.className = "status ok";
    openBtn.disabled = false;
    openBtn.addEventListener("click", () => {
      chrome.tabs.sendMessage(tab.id, { action: "openPanel" });
      window.close();
    });
  } else {
    statusEl.textContent = "Abra o painel do Construa Fácil para usar as ferramentas.";
    statusEl.className = "status no";
  }
});
