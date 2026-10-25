# OdontoFlow

Aplicação desktop local para organizar ordens de serviço de design dentário. A interface usa React + TypeScript; o contêiner desktop usa Tauri 2 e o armazenamento local usa SQLite.

## Requisitos de desenvolvimento

- Node.js 20 ou superior e npm.
- Rust 1.90 ou superior e os pré-requisitos do Tauri para Windows ou Linux.

## Executar em desenvolvimento

1. Copie `.env.example` para `.env` se quiser personalizar o nome exibido.
2. Instale as dependências com `npm install`.
3. Rode `npm run tauri dev`.

Para gerar os arquivos web, use `npm run build`. Para criar o instalador da plataforma atual, use `npm run tauri build`.

## Banco de dados

Na primeira abertura, selecione o arquivo SQLite que já contém as tabelas do sistema no DBeaver. O caminho escolhido fica salvo neste perfil do aplicativo, e o OdontoFlow trabalha diretamente nesse arquivo. O aplicativo verifica a presença das tabelas esperadas e não cria nem semeia outro banco. Use Configurações para trocar o arquivo conectado.

Backups automáticos em JSON são feitos ao iniciar e a cada hora enquanto o aplicativo estiver aberto. O aplicativo retém os 30 backups internos mais recentes. A tela Configurações também permite salvar uma cópia em local escolhido e restaurar um arquivo, sempre criando um backup de segurança antes da substituição.

## Fluxos implementados

- Cadastro e edição de OS com código único, município, status, descrição e itens de trabalho.
- Histórico de status, auditoria dos lançamentos e ocorrências de retorno sem reabrir automaticamente a OS.
- Arquivamento confirmado, preservando os relacionamentos e os históricos.
- Dashboard mensal, quadro por status, pesquisa e análise de produção por data de referência.
- Impressão das telas de relatório para PDF pelo diálogo de impressão do sistema.
- Backup local automático, exportação JSON e restauração validada.

# OdontoFLow
