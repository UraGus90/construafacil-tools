# Construa Fácil — Ferramentas (extensão para Edge)

Adiciona ao painel do Construa Fácil estes recursos:

## 1) Produtividade do órgão (com relatório mensal em CSV)
- Em cada processo, a extensão lê sozinha o seu **órgão** (ex.: ASDREN) e o
  **Nº da Solicitação**, e ainda **sugere** o resultado (Analisado x Pendência)
  com base no histórico/comunicados da página.
- Você confirma com **um clique**: "Analisado (aprovado)" ou "Com pendência".
- Os registros ficam salvos no seu navegador.
- A qualquer momento, escolha o mês e clique em **Gerar relatório do mês** para
  ver quantos processos foram analisados x com pendência, e **exporte em CSV**.

### Gravação automática em arquivo (novo)
- No painel, em **Produtividade do órgão → Gravação automática em arquivo**,
  clique em **Escolher arquivo de registro (.csv)** e selecione (ou crie) um
  arquivo uma única vez.
- A partir daí, **cada** clique em "Analisado" / "Com pendência" grava
  automaticamente uma linha nesse arquivo (data, nº, órgão, tipo, resultado,
  analista). Não precisa exportar à mão.
- O navegador pode pedir **permissão** para escrever no arquivo no início de
  cada sessão — clique em **Permitir**.
- **Requisito:** acesse o sistema por **HTTPS** (https://…). Por HTTP simples o
  navegador não deixa gravar em arquivo; nesse caso, use o export manual.
- Para desligar, use **Desligar gravação automática**.

## 2) Baixar anexos da solicitação em um único ZIP (novo)
- Acima da tabela **Anexos da Solicitação** aparece uma barra verde com
  **⬇ Baixar todos** e **⬇ Baixar selecionados**.
- Cada linha de anexo ganha uma **caixinha**; marque as que quiser e use
  "Baixar selecionados", ou baixe tudo com "Baixar todos". Há também uma
  caixinha no cabeçalho para **marcar/desmarcar todos**.
- Os arquivos são buscados e **compactados num único `.zip`** (nomeado pelo nº da
  solicitação), em vez de cair um a um na pasta Downloads. Mais produtivo.
- Os anexos são baixados **vários ao mesmo tempo** (4 por padrão), o que deixa o
  ZIP bem mais rápido em solicitações com muitos arquivos. Para ajustar, use
  **Downloads simultâneos** no painel: mais alto = mais rápido; se algum anexo
  falhar sempre, reduza para **1**.
- Se algum anexo falhar, a extensão **tenta de novo um a um**; os que vierem são
  compactados normalmente e ela avisa quais não entraram.
- **Reserva:** no painel há **"Baixar um a um (sem ZIP)"**, que clica os botões
  da página com um intervalo ajustável — use se o ZIP não funcionar.

## 3) Filtros estilo Excel nas tabelas
- Aparece um ícone de funil (▾) no cabeçalho de cada coluna das tabelas.
- Colunas de texto (Órgão, Tipo, Válido?): lista de valores com caixinhas e busca.
- Coluna de Data: filtro por período (De / Até) e **ordenação** das linhas
  (⬇ Mais novo → antigo / ⬆ Antigo → novo) para analisar em ordem crescente
  ou decrescente.
- Os filtros de várias colunas se combinam (E lógico), como no Excel.
- No painel há "Limpar todos os filtros" e "Reativar funis" (se a tabela recarregar).

## 4) Relatório da tabela atual
- Conta as linhas da tabela aberta agrupando por uma coluna (Órgão, Tipo,
  Válido?…), com exportação em CSV.

---

## Instalar no Edge
1. Descompacte esta pasta num lugar fixo (ex.: Documentos). Não apague depois.
2. Abra `edge://extensions`.
3. Ative o **Modo de desenvolvedor** (canto inferior esquerdo).
4. Clique em **Carregar sem pacote** e selecione a pasta com o `manifest.json`.
5. Abra um processo no Construa Fácil → botão verde ⚙ no canto inferior direito.

## Como registrar a produtividade
1. Abra a página de detalhe de um processo.
2. Clique no ⚙ → seção **Produtividade do órgão**.
3. Confira órgão e nº (preenchidos automaticamente) e clique no resultado.
   O botão sugerido fica destacado, mas a decisão é sua.
4. No fim do mês: escolha o mês → **Gerar relatório do mês** → **Exportar CSV**.

## Observações
- Os registros e o relatório ficam **apenas no seu computador** (armazenamento
  local do Edge). Trocar de computador/perfil = registros não vão junto.
- Datas reconhecidas: dd/mm/aaaa, dd/mm/aaaa hh:mm e aaaa-mm-dd.
- O "Relatório da tabela atual" conta só a página visível da tabela; se houver
  paginação, aumente os itens por página antes de gerar.
