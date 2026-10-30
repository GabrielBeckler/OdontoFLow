# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O usuário principal é o técnico de laboratório de design dentário, trabalhando em um computador Windows local para cadastrar e acompanhar ordens de serviço.

## Product Purpose

O OdontoFlow organiza ordens de serviço de design dentário e o acompanhamento do trabalho associado. Sucesso significa permitir que o técnico registre OS e acompanhe seu status e seus lançamentos de trabalho com dados persistentes no computador.

## Positioning

O mecanismo confirmado é um aplicativo desktop local com dados em SQLite, sem sincronização entre computadores na primeira versão. Não há uma alegação de diferenciação de mercado confirmada.

## Operating Context

- A primeira versão será usada por uma pessoa em um único computador Windows, sem sincronização.
- O aplicativo é entregue em uma janela desktop Tauri com interface React e TypeScript.
- O README instrui a conexão a um arquivo SQLite existente com o esquema esperado; a seleção e troca do banco são feitas no próprio aplicativo.
- O fluxo principal é cadastrar e acompanhar OS. O sistema também registra itens de trabalho e retornos, oferece consultas por período e permite imprimir relatórios em PDF pelo diálogo do sistema.
- O aplicativo faz backups locais automáticos ao iniciar e periodicamente, permite exportar uma cópia JSON e oferece restauração com backup de segurança.

## Capabilities and Constraints

- Uma OS contém código, município, status, descrição e itens de trabalho com tipo, quantidade e data de referência.
- Os status disponíveis são “Em andamento”, “Finalizado” e “Retorno”. Alterações de status e lançamentos possuem histórico; retornos são ocorrências separadas e não reabrem automaticamente a OS.
- Há dashboard, filtros por período, pesquisa, listagem/quadro de OS e cadastro de municípios e tipos de tarefa.
- O armazenamento da primeira versão é um arquivo SQLite local. Uso por múltiplos computadores, compartilhamento, autenticação e sincronização não fazem parte do escopo confirmado.
- A unicidade do código da OS está pendente de confirmação: o README declara código único, mas o esquema/migração atual permite duplicatas.

## Brand Commitments

- Nome do produto: OdontoFlow.
- A interface e o conteúdo atuais estão em português brasileiro.
- A direção visual aprovada para documentação é “OdontoFlow — Professional Workspace”; preservar o reconhecimento da identidade verde existente e seguir a especificação de cores, tipografia e interface em `DESIGN.md`.

## Evidence on Hand

- Código, fluxos e configuração do aplicativo neste repositório.
- O README documenta as funcionalidades locais e os formatos/ritmos de backup.
- Não há depoimentos, métricas de adoção, estudos de caso ou alegações comerciais confirmados. Não inventar prova social ou resultados.

## Product Principles

- Manter o cadastro e o acompanhamento da OS como o fluxo central do técnico.
- Preservar a rastreabilidade de status, itens de trabalho e ocorrências de retorno.
- Distinguir a quantidade de OS da quantidade de trabalho produzido.
- Tornar explícito que os dados pertencem ao fluxo local de um único computador e preservar opções de backup.
- Não tratar datas de criação da OS, datas de referência do trabalho e datas de retorno como se fossem a mesma medida.
