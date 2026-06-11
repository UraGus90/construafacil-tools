# Changelog

Todas as mudanças relevantes desta extensão são documentadas aqui.
O formato segue, em linhas gerais, o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/)
e o versionamento segue o [SemVer](https://semver.org/lang/pt-BR/).

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
