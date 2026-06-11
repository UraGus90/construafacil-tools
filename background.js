/* Service worker mínimo. A lógica vive no content script;
   aqui só garantimos que a extensão fique ativa. */
chrome.runtime.onInstalled.addListener(() => {
  console.log("Construa Fácil — Ferramentas instalada.");
});
