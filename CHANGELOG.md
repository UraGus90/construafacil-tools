# Changelog

Todas as mudanças relevantes desta extensão são documentadas aqui.
O formato segue, em linhas gerais, o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e o versionamento segue o [SemVer](https://semver.org/lang/pt-BR/).

## [1.4.0] - 2026-08-07
### Alterado
- **Geração do ZIP muito mais rápida.** Os anexos passam a ser buscados em
  paralelo (4 por vez, em vez de um a um) e o intervalo fixo de 120 ms entre as
  requisições foi removido. Em solicitações com muitos anexos o tempo total deixa
  de crescer com a soma das esperas de rede.
- O código de verificação (CRC) de cada anexo agora é calculado assim que ele
  chega, enquanto os outros ainda estão baixando, e o `.zip` é montado direto das
  suas partes — sem copiar todo o conteúdo para um buffer único antes de salvar.
  A etapa "Compactando…" ficou praticamente instantânea e o consumo de memória
  com anexos grandes caiu.
- A mensagem final informa o tempo total ("ZIP gerado com N arquivo(s) em X,Ys").

### Adicionado
- Campo **Downloads simultâneos** no painel (1 a 8, padrão 4). Reduzir para 1
  reproduz o comportamento sequencial das versões anteriores.
- Nova tentativa automática, um a um, dos anexos que falharem durante a busca em
  paralelo — o sistema é antigo e pode recusar requisições simultâneas.

## [1.3.0] - 2026-06-11
### Adicionado
- Ordenação por data no filtro das colunas de data: botões
  **⬇ Mais novo → antigo** e **⬆ Antigo → novo**, para analisar em ordem
  crescente ou decrescente. Linhas sem data válida vão para o fim;
  a ordenação respeita o filtro De/Até vigente.

## [1.2.0]
### Adicionado
- Download de todos os anexos selecionados em um **único arquivo .zip**
  (gerador próprio, sem dependências), aumentando a produtividade.
- Modo reserva "Baixar um a um (sem ZIP)" com intervalo ajustável.

## [1.1.0]
### Adicionado
- **Gravação automática em arquivo** (.csv) via File System Access API:
  escolhe-se o arquivo uma vez e cada registro é anexado automaticamente.
- Seleção de anexos por linha (caixinhas) com "Baixar todos" / "Baixar
  selecionados".

## [1.0.0]
### Adicionado
- Filtros estilo Excel nas tabelas (texto e período de data).
- Produtividade do órgão com relatório mensal e exportação em CSV.
- Relatório da tabela atual agrupado por coluna.
