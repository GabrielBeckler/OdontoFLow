use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;
use sqlx::{Connection, Sqlite};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::Mutex;

#[derive(Default)]
struct SqliteWriteQueue(Mutex<()>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SqlStatement {
    query: String,
    #[serde(default)]
    values: Vec<SqlValue>,
    capture_last_insert_id: Option<String>,
    expected_rows: Option<u64>,
}

const MAX_BACKUP_BYTES: usize = 64 * 1024 * 1024;
const MAX_ORDER_ITEM_QUANTITY: i64 = 1_000_000;

const BACKUP_TABLES: &[(&str, &[&str])] = &[
    ("municipios", &["id", "codigo", "nome", "ativo"]),
    ("tipos_tarefa", &["id", "nome", "ativo"]),
    (
        "ordens_servico",
        &[
            "id",
            "codigo_os",
            "status",
            "descricao",
            "criada_em",
            "atualizada_em",
            "arquivada_em",
            "municipio_id",
        ],
    ),
    (
        "lancamentos_trabalho",
        &[
            "id",
            "ordem_servico_id",
            "tipo_tarefa_id",
            "quantidade",
            "data_referencia",
            "criado_em",
            "atualizado_em",
        ],
    ),
    (
        "historico_retornos",
        &[
            "id",
            "ordem_servico_id",
            "motivo",
            "justificativa",
            "registrado_em",
        ],
    ),
    (
        "historico_status_os",
        &[
            "id",
            "ordem_servico_id",
            "de_status",
            "para_status",
            "alterado_em",
        ],
    ),
    (
        "historico_alteracoes_os",
        &[
            "id",
            "ordem_servico_id",
            "operacao",
            "valores_anteriores",
            "valores_novos",
            "registrado_em",
        ],
    ),
    (
        "auditoria_lancamentos",
        &[
            "id",
            "lancamento_id",
            "operacao",
            "valores_anteriores",
            "valores_novos",
            "registrado_em",
        ],
    ),
];

fn is_integer_backup_column(column: &str) -> bool {
    column == "id"
        || matches!(
            column,
            "ativo"
                | "municipio_id"
                | "tipo_tarefa_id"
                | "quantidade"
                | "ordem_servico_id"
                | "lancamento_id"
        )
}

const ALLOWED_WRITE_QUERIES: &[&str] = &[
    "INSERT INTO municipios(codigo,nome,ativo) VALUES($1,$2,1)",
    "UPDATE municipios SET ativo=$1 WHERE id=$2",
    "INSERT INTO tipos_tarefa(nome,ativo) SELECT $1,1 WHERE NOT EXISTS(SELECT 1 FROM tipos_tarefa WHERE lower(trim(nome))=lower(trim($1)))",
    "UPDATE tipos_tarefa SET ativo=$1 WHERE id=$2",
    "UPDATE ordens_servico SET codigo_os=$1,status=$2,descricao=$3,municipio_id=$4,atualizada_em=$5 WHERE id=$6 AND atualizada_em=$7",
    "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status,alterado_em) VALUES($1,$2,$3,$4)",
    "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_anteriores,valores_novos,registrado_em) VALUES($1,'EDICAO',$2,$3,$4)",
    "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_anteriores,valores_novos,registrado_em) VALUES($1,'EDICAO',$2,$3,$4)",
    "UPDATE lancamentos_trabalho SET tipo_tarefa_id=$1,quantidade=$2,data_referencia=$3,atualizado_em=$4 WHERE id=$5 AND ordem_servico_id=$6 AND atualizado_em IS $7",
    "INSERT INTO lancamentos_trabalho(ordem_servico_id,tipo_tarefa_id,quantidade,data_referencia) VALUES($1,$2,$3,$4)",
    "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_novos) VALUES($1,'CRIACAO',$2)",
    "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_anteriores,registrado_em) VALUES($1,'EXCLUSAO',$2,$3)",
    "DELETE FROM lancamentos_trabalho WHERE id=$1 AND ordem_servico_id=$2",
    "INSERT INTO ordens_servico(codigo_os,status,descricao,municipio_id) VALUES($1,$2,$3,$4)",
    "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status) VALUES($1,NULL,$2)",
    "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_novos) VALUES($1,'CRIACAO',$2)",
    "INSERT INTO historico_retornos(ordem_servico_id,motivo,justificativa) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND arquivada_em IS NULL)",
    "UPDATE ordens_servico SET atualizada_em=$1 WHERE id=$2",
    "UPDATE ordens_servico SET arquivada_em=$1,atualizada_em=$1 WHERE id=$2",
    "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_anteriores) VALUES($1,'ARQUIVAMENTO',$2)",
    "UPDATE ordens_servico SET status=$1,atualizada_em=$2 WHERE id=$3 AND status=$4",
    "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status,alterado_em) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND status=$3 AND atualizada_em=$4)",
    "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_anteriores,valores_novos,registrado_em) SELECT $1,'EDICAO',$2,$3,$4 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND status=$5 AND atualizada_em=$4)",
];

fn normalize_sql(query: &str) -> String {
    query.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate_write_statements(statements: &[SqlStatement]) -> Result<(), String> {
    for statement in statements {
        let normalized = normalize_sql(&statement.query);
        if !ALLOWED_WRITE_QUERIES
            .iter()
            .any(|allowed| normalize_sql(allowed) == normalized)
        {
            return Err("Operação de banco não permitida pelo aplicativo.".into());
        }
        let quantity_position = match normalized.as_str() {
            "INSERT INTO lancamentos_trabalho(ordem_servico_id,tipo_tarefa_id,quantidade,data_referencia) VALUES($1,$2,$3,$4)" => Some(2),
            "UPDATE lancamentos_trabalho SET tipo_tarefa_id=$1,quantidade=$2,data_referencia=$3,atualizado_em=$4 WHERE id=$5 AND ordem_servico_id=$6 AND atualizado_em IS $7" => Some(1),
            _ => None,
        };
        if let Some(position) = quantity_position {
            let Some(SqlValue::Value(Value::Number(value))) = statement.values.get(position) else {
                return Err("A quantidade deve ser um número inteiro positivo.".into());
            };
            let Some(quantity) = value.as_i64() else {
                return Err("A quantidade deve ser um número inteiro positivo.".into());
            };
            if !(1..=MAX_ORDER_ITEM_QUANTITY).contains(&quantity) {
                return Err(format!(
                    "A quantidade máxima por lançamento é {MAX_ORDER_ITEM_QUANTITY}."
                ));
            }
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SqlValue {
    Reference { reference: String },
    Value(Value),
}

async fn execute_statements(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    statements: Vec<SqlStatement>,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let mut references = std::collections::HashMap::<String, i64>::new();
    for statement in statements {
        let mut query = sqlx::query(&statement.query);
        for value in statement.values {
            query = match value {
                SqlValue::Reference { reference } => {
                    let value = references.get(&reference).ok_or_else(|| {
                        format!("Referência de gravação desconhecida: {reference}")
                    })?;
                    query.bind(*value)
                }
                SqlValue::Value(Value::Null) => query.bind(Option::<String>::None),
                SqlValue::Value(Value::Bool(value)) => query.bind(i64::from(value)),
                SqlValue::Value(Value::Number(value)) => {
                    if let Some(integer) = value.as_i64() {
                        query.bind(integer)
                    } else if let Some(unsigned) = value.as_u64() {
                        let integer = i64::try_from(unsigned)
                            .map_err(|_| "Número excede o limite inteiro do SQLite.".to_owned())?;
                        query.bind(integer)
                    } else {
                        query.bind(value.as_f64().unwrap_or_default())
                    }
                }
                SqlValue::Value(Value::String(value)) => query.bind(value),
                SqlValue::Value(value) => query.bind(value.to_string()),
            };
        }
        let result = query
            .execute(&mut **transaction)
            .await
            .map_err(|error| error.to_string())?;
        if let Some(expected) = statement.expected_rows {
            if result.rows_affected() != expected {
                return Err(format!(
                    "A gravação afetou {} registro(s); eram esperados {expected}.",
                    result.rows_affected()
                ));
            }
        }
        if let Some(name) = statement.capture_last_insert_id {
            references.insert(name, result.last_insert_rowid());
        }
    }
    Ok(references)
}

async fn write_transaction(
    pool: &sqlx::SqlitePool,
    queue: &SqliteWriteQueue,
    statements: Vec<SqlStatement>,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let _write_guard = queue.0.lock().await;
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let mut transaction = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    let references = match execute_statements(&mut transaction, statements).await {
        Ok(references) => references,
        Err(error) => {
            if let Err(rollback_error) = transaction.rollback().await {
                return Err(format!(
                    "{error}; falha ao desfazer a transação: {rollback_error}"
                ));
            }
            return Err(error);
        }
    };
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(references)
}

async fn migrate_duplicate_order_codes(
    pool: &sqlx::SqlitePool,
    queue: &SqliteWriteQueue,
) -> Result<bool, String> {
    let _write_guard = queue.0.lock().await;
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let schema: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='ordens_servico'",
    )
    .fetch_optional(&mut *connection)
    .await
    .map_err(|error| error.to_string())?;
    let Some(schema) = schema else {
        return Err("A tabela ordens_servico não foi encontrada.".into());
    };
    let normalized = schema.to_lowercase().replace(['\n', '\r', '\t'], " ");
    let inline_unique = normalized
        .split(',')
        .any(|column| column.contains("codigo_os") && column.contains("unique"));
    let index_rows = sqlx::query("PRAGMA index_list('ordens_servico')")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let mut unique_code_index = false;
    let mut indexes_to_restore = Vec::new();
    for index in index_rows {
        let name: String = index.try_get("name").map_err(|error| error.to_string())?;
        let unique: i64 = index.try_get("unique").map_err(|error| error.to_string())?;
        let escaped = name.replace('"', "\"\"");
        let columns = sqlx::query(&format!("PRAGMA index_info(\"{escaped}\")"))
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        let names = columns
            .iter()
            .map(|row| row.try_get::<Option<String>, _>("name").ok().flatten())
            .collect::<Vec<_>>();
        if unique == 1 && names == vec![Some("codigo_os".to_owned())] {
            unique_code_index = true;
        }
        let sql: Option<String> =
            sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type='index' AND name=$1")
                .bind(&name)
                .fetch_optional(&mut *connection)
                .await
                .map_err(|error| error.to_string())?
                .flatten();
        if let Some(sql) = sql {
            if !(unique == 1 && names == vec![Some("codigo_os".to_owned())]) {
                indexes_to_restore.push(sql);
            }
        }
    }
    if !inline_unique && !unique_code_index {
        return Ok(false);
    }
    let triggers: Vec<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='ordens_servico' AND sql IS NOT NULL",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|error| error.to_string())?;

    sqlx::query("PRAGMA foreign_keys=OFF")
        .execute(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let migration = async {
        let mut transaction = connection.begin().await.map_err(|e| e.to_string())?;
        let result = async {
            sqlx::query(
                "CREATE TABLE ordens_servico_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    codigo_os TEXT NOT NULL CHECK(length(trim(codigo_os)) > 0 AND codigo_os = trim(codigo_os)),
                    status TEXT NOT NULL DEFAULT 'Em andamento' CHECK(status IN ('Em andamento','Finalizado','Retorno')),
                    descricao TEXT,
                    criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                    atualizada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                    arquivada_em TEXT,
                    municipio_id INTEGER NOT NULL REFERENCES municipios(id) ON DELETE RESTRICT
                )",
            )
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
            sqlx::query(
                "INSERT INTO ordens_servico_new(id,codigo_os,status,descricao,criada_em,atualizada_em,arquivada_em,municipio_id)
                 SELECT id,codigo_os,status,descricao,criada_em,atualizada_em,arquivada_em,municipio_id FROM ordens_servico",
            )
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
            sqlx::query("DROP TABLE ordens_servico")
                .execute(&mut *transaction)
                .await
                .map_err(|error| error.to_string())?;
            sqlx::query("ALTER TABLE ordens_servico_new RENAME TO ordens_servico")
                .execute(&mut *transaction)
                .await
                .map_err(|error| error.to_string())?;
            for sql in indexes_to_restore {
                sqlx::query(&sql)
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            for sql in triggers {
                sqlx::query(&sql)
                    .execute(&mut *transaction)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            Ok::<(), String>(())
        }
        .await;
        match result {
            Ok(()) => transaction.commit().await.map_err(|e| e.to_string()),
            Err(error) => {
                transaction.rollback().await.map_err(|e| format!("{error}; falha ao desfazer migração: {e}"))?;
                Err(error)
            }
        }
    }
    .await;
    let foreign_keys_on = sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&mut *connection)
        .await;
    if let Err(error) = foreign_keys_on {
        return Err(format!("Falha ao reativar chaves estrangeiras: {error}"));
    }
    migration?;
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    if !violations.is_empty() {
        return Err(format!(
            "Migração concluída com {} violações de chave estrangeira.",
            violations.len()
        ));
    }
    Ok(true)
}

#[tauri::command]
async fn execute_sqlite_transaction(
    db: String,
    statements: Vec<SqlStatement>,
    instances: State<'_, tauri_plugin_sql::DbInstances>,
    write_queue: State<'_, SqliteWriteQueue>,
) -> Result<std::collections::HashMap<String, i64>, String> {
    validate_write_statements(&statements)?;
    let instances = instances.0.read().await;
    let pool = match instances.get(&db) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => pool,
        None => return Err("O banco SQLite ainda não foi conectado.".into()),
    };
    write_transaction(pool, &write_queue, statements).await
}

#[tauri::command]
async fn migrate_duplicate_order_codes_command(
    db: String,
    instances: State<'_, tauri_plugin_sql::DbInstances>,
    write_queue: State<'_, SqliteWriteQueue>,
) -> Result<bool, String> {
    let instances = instances.0.read().await;
    let pool = match instances.get(&db) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => pool,
        None => return Err("O banco SQLite ainda não foi conectado.".into()),
    };
    migrate_duplicate_order_codes(pool, &write_queue).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
        Executor,
    };
    use std::sync::Arc;

    const DASHBOARD_STATUS_COUNTS_SQL: &str =
        include_str!("../../src/services/dashboard-status-counts.sql");

    fn statement(query: &str, values: Vec<SqlValue>, capture: Option<&str>) -> SqlStatement {
        SqlStatement {
            query: query.into(),
            values,
            capture_last_insert_id: capture.map(str::to_owned),
            expected_rows: None,
        }
    }

    fn value(value: serde_json::Value) -> SqlValue {
        SqlValue::Value(value)
    }

    fn expected_rows(mut statement: SqlStatement, expected: u64) -> SqlStatement {
        statement.expected_rows = Some(expected);
        statement
    }

    async fn workflow_pool() -> sqlx::SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(":memory:")
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        for sql in [
            "CREATE TABLE municipios(id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nome TEXT NOT NULL UNIQUE, ativo INTEGER NOT NULL CHECK(ativo IN (0,1)))",
            "CREATE TABLE tipos_tarefa(id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE, ativo INTEGER NOT NULL CHECK(ativo IN (0,1)))",
            "CREATE TABLE ordens_servico(id INTEGER PRIMARY KEY, codigo_os TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Em andamento','Finalizado','Retorno')), descricao TEXT, criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), atualizada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), arquivada_em TEXT, municipio_id INTEGER NOT NULL REFERENCES municipios(id))",
            "CREATE TABLE lancamentos_trabalho(id INTEGER PRIMARY KEY, ordem_servico_id INTEGER NOT NULL REFERENCES ordens_servico(id), tipo_tarefa_id INTEGER NOT NULL REFERENCES tipos_tarefa(id), quantidade INTEGER NOT NULL CHECK(quantidade > 0), data_referencia TEXT NOT NULL CHECK(length(data_referencia)=10), criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), atualizado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ",
            "CREATE TABLE historico_retornos(id INTEGER PRIMARY KEY, ordem_servico_id INTEGER NOT NULL REFERENCES ordens_servico(id), motivo TEXT NOT NULL CHECK(motivo IN ('Escaneamento incorreto','Reavaliar','Falta de espaço Protético','Falta arquivo','Outros')), justificativa TEXT, registrado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), CHECK(motivo <> 'Outros' OR (justificativa IS NOT NULL AND length(trim(justificativa)) > 0)))",
            "CREATE TABLE historico_status_os(id INTEGER PRIMARY KEY, ordem_servico_id INTEGER NOT NULL REFERENCES ordens_servico(id), de_status TEXT, para_status TEXT NOT NULL, alterado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ",
            "CREATE TABLE historico_alteracoes_os(id INTEGER PRIMARY KEY, ordem_servico_id INTEGER, operacao TEXT NOT NULL, valores_anteriores TEXT, valores_novos TEXT, registrado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ",
            "CREATE TABLE auditoria_lancamentos(id INTEGER PRIMARY KEY, lancamento_id INTEGER, operacao TEXT NOT NULL, valores_anteriores TEXT, valores_novos TEXT, registrado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ",
        ] {
            pool.execute(sql).await.unwrap();
        }
        pool
    }

    #[test]
    fn batch_uses_one_transaction_and_resolves_insert_ids() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect("sqlite::memory:")
                    .await
                    .unwrap();
                pool.execute("CREATE TABLE parent(id INTEGER PRIMARY KEY, label TEXT NOT NULL);")
                    .await
                    .unwrap();
                pool.execute(
                    "CREATE TABLE child(parent_id INTEGER NOT NULL, label TEXT NOT NULL);",
                )
                .await
                .unwrap();

                let mut connection = pool.acquire().await.unwrap();
                let mut transaction = connection.begin().await.unwrap();
                let refs = execute_statements(
                    &mut transaction,
                    vec![
                        statement(
                            "INSERT INTO parent(label) VALUES($1)",
                            vec![SqlValue::Value(Value::String("saved".into()))],
                            Some("parent"),
                        ),
                        statement(
                            "INSERT INTO child(parent_id,label) VALUES($1,$2)",
                            vec![
                                SqlValue::Reference {
                                    reference: "parent".into(),
                                },
                                SqlValue::Value(Value::String("history".into())),
                            ],
                            None,
                        ),
                    ],
                )
                .await
                .unwrap();
                assert_eq!(refs.get("parent"), Some(&1));
                transaction.commit().await.unwrap();
                drop(connection);
                let stored: i64 =
                    sqlx::query_scalar("SELECT COUNT(*) FROM child WHERE parent_id=1")
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert_eq!(stored, 1);

                let mut connection = pool.acquire().await.unwrap();
                let mut transaction = connection.begin().await.unwrap();
                let result = execute_statements(
                    &mut transaction,
                    vec![
                        statement(
                            "INSERT INTO parent(label) VALUES($1)",
                            vec![SqlValue::Value(Value::String("rolled back".into()))],
                            None,
                        ),
                        statement("INSERT INTO missing_table(label) VALUES($1)", vec![], None),
                    ],
                )
                .await;
                assert!(result.is_err());
                transaction.rollback().await.unwrap();
                drop(connection);
                let rolled_back: i64 =
                    sqlx::query_scalar("SELECT COUNT(*) FROM parent WHERE label='rolled back'")
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert_eq!(rolled_back, 0);
            });
    }

    #[test]
    fn simultaneous_writes_are_queued_and_all_commit() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let path = std::env::temp_dir()
                    .join(format!("odontoflow-write-queue-{}.db", std::process::id()));
                let options = SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true);
                let pool = SqlitePoolOptions::new()
                    .max_connections(5)
                    .connect_with(options)
                    .await
                    .unwrap();
                pool.execute("CREATE TABLE queued_writes(value INTEGER NOT NULL)")
                    .await
                    .unwrap();
                let queue = Arc::new(SqliteWriteQueue::default());
                let mut jobs = Vec::new();
                for value in 0..32_i64 {
                    let pool = pool.clone();
                    let queue = queue.clone();
                    jobs.push(tokio::spawn(async move {
                        write_transaction(
                            &pool,
                            &queue,
                            vec![statement(
                                "INSERT INTO queued_writes(value) VALUES($1)",
                                vec![SqlValue::Value(Value::Number(value.into()))],
                                None,
                            )],
                        )
                        .await
                        .unwrap();
                    }));
                }
                for job in jobs {
                    job.await.unwrap();
                }
                let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM queued_writes")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(total, 32);
                pool.close().await;
                let _ = std::fs::remove_file(path);
            });
    }

    #[test]
    fn duplicate_code_migration_preserves_ids_children_and_indexes() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                use sqlx::sqlite::SqliteConnectOptions;
                let options = SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true);
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options)
                    .await
                    .unwrap();
                pool.execute("CREATE TABLE municipios(id INTEGER PRIMARY KEY, nome TEXT NOT NULL)")
                    .await
                    .unwrap();
                pool.execute("INSERT INTO municipios VALUES(1,'Teste')")
                    .await
                    .unwrap();
                pool.execute("CREATE TABLE ordens_servico(id INTEGER PRIMARY KEY AUTOINCREMENT,codigo_os TEXT NOT NULL UNIQUE CHECK(length(trim(codigo_os))>0 AND codigo_os=trim(codigo_os)),status TEXT NOT NULL DEFAULT 'Em andamento' CHECK(status IN ('Em andamento','Finalizado','Retorno')),descricao TEXT,criada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),atualizada_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),arquivada_em TEXT,municipio_id INTEGER NOT NULL REFERENCES municipios(id) ON DELETE RESTRICT)")
                    .await
                    .unwrap();
                pool.execute("CREATE INDEX idx_os_municipio ON ordens_servico(municipio_id)")
                    .await
                    .unwrap();
                pool.execute("CREATE TABLE historico_status_os(id INTEGER PRIMARY KEY, ordem_servico_id INTEGER NOT NULL REFERENCES ordens_servico(id), para_status TEXT NOT NULL)")
                    .await
                    .unwrap();
                pool.execute("INSERT INTO ordens_servico(id,codigo_os,municipio_id) VALUES(17,'DUP',1)")
                    .await
                    .unwrap();
                pool.execute("INSERT INTO historico_status_os VALUES(1,17,'Em andamento')")
                    .await
                    .unwrap();
                assert!(migrate_duplicate_order_codes(&pool, &SqliteWriteQueue::default())
                    .await
                    .unwrap());
                pool.execute("INSERT INTO ordens_servico(codigo_os,municipio_id) VALUES('DUP',1)")
                    .await
                    .unwrap();
                let ids: Vec<i64> = sqlx::query_scalar(
                    "SELECT id FROM ordens_servico WHERE codigo_os='DUP' ORDER BY id",
                )
                .fetch_all(&pool)
                .await
                .unwrap();
                assert_eq!(ids, vec![17, 18]);
                let linked: i64 = sqlx::query_scalar(
                    "SELECT ordem_servico_id FROM historico_status_os WHERE id=1",
                )
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!(linked, 17);
                let index_exists: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_os_municipio'",
                )
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!(index_exists, 1);
                let violations = sqlx::query("PRAGMA foreign_key_check")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
                assert!(violations.is_empty());
            });
    }

    #[test]
    fn dashboard_status_counts_are_a_snapshot_at_period_end() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let options = SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true);
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options)
                    .await
                    .unwrap();
                pool.execute(
                    "CREATE TABLE ordens_servico(
                        id INTEGER PRIMARY KEY,
                        criada_em TEXT NOT NULL,
                        status TEXT NOT NULL,
                        arquivada_em TEXT
                    )",
                )
                .await
                .unwrap();
                pool.execute(
                    "CREATE TABLE historico_status_os(
                        id INTEGER PRIMARY KEY,
                        ordem_servico_id INTEGER NOT NULL,
                        para_status TEXT NOT NULL,
                        alterado_em TEXT NOT NULL
                    )",
                )
                .await
                .unwrap();

                let orders = [
                    (1, "2026-04-01T10:00:00Z", "Em andamento"),
                    (2, "2026-05-01T08:00:00Z", "Em andamento"),
                    (3, "2026-04-15T09:00:00Z", "Finalizado"),
                    (4, "2026-04-12T09:00:00Z", "Retorno"),
                    (5, "2026-05-02T00:00:00Z", "Em andamento"),
                ];
                for (id, created, status) in orders {
                    sqlx::query(
                        "INSERT INTO ordens_servico(id,criada_em,status) VALUES($1,$2,$3)",
                    )
                    .bind(id)
                    .bind(created)
                    .bind(status)
                    .execute(&pool)
                    .await
                    .unwrap();
                }

                let history = [
                    (1, 1, "Em andamento", "2026-04-01T10:00:00Z"),
                    (2, 2, "Em andamento", "2026-05-01T08:00:00Z"),
                    (3, 3, "Em andamento", "2026-04-15T09:00:00Z"),
                    (4, 3, "Finalizado", "2026-05-01T11:00:00Z"),
                    (5, 4, "Em andamento", "2026-04-12T09:00:00Z"),
                    (6, 4, "Finalizado", "2026-05-01T10:00:00Z"),
                    (7, 4, "Retorno", "2026-05-01T23:50:00Z"),
                    (8, 5, "Em andamento", "2026-05-02T00:00:00Z"),
                ];
                for (id, order_id, status, changed) in history {
                    sqlx::query(
                        "INSERT INTO historico_status_os(id,ordem_servico_id,para_status,alterado_em) VALUES($1,$2,$3,$4)",
                    )
                    .bind(id)
                    .bind(order_id)
                    .bind(status)
                    .bind(changed)
                    .execute(&pool)
                    .await
                    .unwrap();
                }

                let rows = sqlx::query(DASHBOARD_STATUS_COUNTS_SQL)
                    .bind("2026-05-02T00:00:00Z")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
                let counts = rows
                    .into_iter()
                    .map(|row| {
                        (
                            row.try_get::<String, _>("name").unwrap(),
                            row.try_get::<i64, _>("value").unwrap(),
                        )
                    })
                    .collect::<std::collections::HashMap<_, _>>();

                assert_eq!(counts.get("Em andamento"), Some(&2));
                assert_eq!(counts.get("Retorno"), Some(&1));
                assert_eq!(counts.get("Finalizado"), Some(&1));
                assert_eq!(counts.values().sum::<i64>(), 4);
            });
    }

    #[test]
    fn dashboard_status_counts_include_previous_status_when_period_has_no_changes() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let options = SqliteConnectOptions::new()
                    .filename(":memory:")
                    .foreign_keys(true);
                let pool = SqlitePoolOptions::new()
                    .max_connections(1)
                    .connect_with(options)
                    .await
                    .unwrap();
                pool.execute(
                    "CREATE TABLE ordens_servico(
                        id INTEGER PRIMARY KEY,
                        criada_em TEXT NOT NULL,
                        status TEXT NOT NULL,
                        arquivada_em TEXT
                    )",
                )
                .await
                .unwrap();
                pool.execute(
                    "CREATE TABLE historico_status_os(
                        id INTEGER PRIMARY KEY,
                        ordem_servico_id INTEGER NOT NULL,
                        para_status TEXT NOT NULL,
                        alterado_em TEXT NOT NULL
                    )",
                )
                .await
                .unwrap();
                pool.execute("INSERT INTO ordens_servico VALUES(1,'2026-01-01T00:00:00Z','Finalizado',NULL)")
                    .await
                    .unwrap();
                pool.execute("INSERT INTO historico_status_os VALUES(1,1,'Finalizado','2026-01-02T00:00:00Z')")
                    .await
                    .unwrap();

                let rows = sqlx::query(DASHBOARD_STATUS_COUNTS_SQL)
                    .bind("2026-06-01T00:00:00Z")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].try_get::<String, _>("name").unwrap(), "Finalizado");
                assert_eq!(rows[0].try_get::<i64, _>("value").unwrap(), 1);
            });
    }

    #[test]
    fn allowed_renderer_writes_reject_arbitrary_sql() {
        let allowed = statement(
            "INSERT INTO municipios(codigo,nome,ativo) VALUES($1,$2,1)",
            vec![
                value(serde_json::json!("TST")),
                value(serde_json::json!("Teste")),
            ],
            None,
        );
        assert!(validate_write_statements(&[allowed]).is_ok());

        for query in [
            "DROP TABLE ordens_servico",
            "DELETE FROM ordens_servico",
            "SELECT 1",
            "UPDATE ordens_servico SET status='Retorno'; DROP TABLE municipios",
        ] {
            let arbitrary = statement(query, Vec::new(), None);
            assert!(validate_write_statements(&[arbitrary]).is_err(), "{query}");
        }

        let insert_item = |quantity: serde_json::Value| {
            statement(
                "INSERT INTO lancamentos_trabalho(ordem_servico_id,tipo_tarefa_id,quantidade,data_referencia) VALUES($1,$2,$3,$4)",
                vec![
                    SqlValue::Reference { reference: "order_id".into() },
                    value(serde_json::json!(1)),
                    value(quantity),
                    value(serde_json::json!("2026-05-01")),
                ],
                None,
            )
        };
        for invalid in [
            serde_json::json!(0),
            serde_json::json!(-1),
            serde_json::json!(1.5),
            serde_json::json!(MAX_ORDER_ITEM_QUANTITY + 1),
            serde_json::json!("2"),
        ] {
            assert!(validate_write_statements(&[insert_item(invalid)]).is_err());
        }
        assert!(validate_write_statements(&[insert_item(serde_json::json!(
            MAX_ORDER_ITEM_QUANTITY
        ))])
        .is_ok());
    }

    #[test]
    fn backup_validation_rejects_malformed_and_oversized_contents() {
        assert!(validate_backup_contents("not json").is_err());
        assert!(validate_backup_contents(r#"{"format":"other","version":1,"data":{}}"#).is_err());
        assert!(validate_backup_contents(&" ".repeat(MAX_BACKUP_BYTES + 1)).is_err());

        let empty_tables = BACKUP_TABLES
            .iter()
            .map(|(table, _)| ((*table).to_owned(), serde_json::json!([])))
            .collect::<serde_json::Map<_, _>>();
        let valid = serde_json::json!({
            "format": "odontoflow-backup",
            "version": 1,
            "createdAt": "2026-05-01T00:00:00.000Z",
            "data": empty_tables,
        })
        .to_string();
        assert!(validate_backup_contents(&valid).is_ok());
    }

    #[test]
    fn backup_paths_are_normalized_and_symlink_targets_are_rejected() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "odontoflow-backup-path-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("nested")).unwrap();
        let selected = root.join("nested").join("..").join("backup.json");
        let normalized = selected_json_path(selected, false).unwrap();
        assert_eq!(normalized, root.canonicalize().unwrap().join("backup.json"));

        write_atomically(&normalized, b"complete backup").unwrap();
        assert_eq!(fs::read(&normalized).unwrap(), b"complete backup");

        #[cfg(unix)]
        {
            let link = root.join("linked.json");
            std::os::unix::fs::symlink(&normalized, &link).unwrap();
            assert!(selected_json_path(link, true).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn order_return_archive_and_backup_restore_preserve_related_data() {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async {
                let source = workflow_pool().await;
                let queue = SqliteWriteQueue::default();
                source
                    .execute("INSERT INTO municipios(id,codigo,nome,ativo) VALUES(1,'TST','Teste',1)")
                    .await
                    .unwrap();
                source
                    .execute("INSERT INTO tipos_tarefa(id,nome,ativo) VALUES(1,'Coroa',1)")
                    .await
                    .unwrap();

                let create = vec![
                    {
                        let mut query = statement(
                            "INSERT INTO ordens_servico(codigo_os,status,descricao,municipio_id) VALUES($1,$2,$3,$4)",
                            vec![
                                value(serde_json::json!("OS-TESTE")),
                                value(serde_json::json!("Em andamento")),
                                value(serde_json::Value::Null),
                                value(serde_json::json!(1)),
                            ],
                            Some("order_id"),
                        );
                        query.expected_rows = Some(1);
                        query
                    },
                    statement(
                        "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status) VALUES($1,NULL,$2)",
                        vec![
                            SqlValue::Reference { reference: "order_id".into() },
                            value(serde_json::json!("Em andamento")),
                        ],
                        None,
                    ),
                    statement(
                        "INSERT INTO lancamentos_trabalho(ordem_servico_id,tipo_tarefa_id,quantidade,data_referencia) VALUES($1,$2,$3,$4)",
                        vec![
                            SqlValue::Reference { reference: "order_id".into() },
                            value(serde_json::json!(1)),
                            value(serde_json::json!(2)),
                            value(serde_json::json!("2026-05-01")),
                        ],
                        Some("item_id"),
                    ),
                    statement(
                        "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_novos) VALUES($1,'CRIACAO',$2)",
                        vec![
                            SqlValue::Reference { reference: "item_id".into() },
                            value(serde_json::json!("{}")),
                        ],
                        None,
                    ),
                ];
                validate_write_statements(&create).unwrap();
                let inserted = write_transaction(&source, &queue, create).await.unwrap();
                let order_id = inserted["order_id"];
                let item_id = inserted["item_id"];
                let before = sqlx::query("SELECT atualizada_em FROM ordens_servico WHERE id=$1")
                    .bind(order_id)
                    .fetch_one(&source)
                    .await
                    .unwrap()
                    .try_get::<String, _>("atualizada_em")
                    .unwrap();
                let item_before = sqlx::query("SELECT atualizado_em FROM lancamentos_trabalho WHERE id=$1")
                    .bind(item_id)
                    .fetch_one(&source)
                    .await
                    .unwrap()
                    .try_get::<String, _>("atualizado_em")
                    .unwrap();

                let edit = vec![
                    expected_rows(
                        statement(
                            "UPDATE ordens_servico SET codigo_os=$1,status=$2,descricao=$3,municipio_id=$4,atualizada_em=$5 WHERE id=$6 AND atualizada_em=$7",
                            vec![
                                value(serde_json::json!("OS-TESTE")),
                                value(serde_json::json!("Finalizado")),
                                value(serde_json::Value::Null),
                                value(serde_json::json!(1)),
                                value(serde_json::json!("2026-05-02T12:00:00.000Z")),
                                value(serde_json::json!(order_id)),
                                value(serde_json::json!(before.clone())),
                            ],
                            None,
                        ),
                        1,
                    ),
                    statement(
                        "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status,alterado_em) VALUES($1,$2,$3,$4)",
                        vec![
                            value(serde_json::json!(order_id)),
                            value(serde_json::json!("Em andamento")),
                            value(serde_json::json!("Finalizado")),
                            value(serde_json::json!("2026-05-02T12:00:00.000Z")),
                        ],
                        None,
                    ),
                    expected_rows(
                        statement(
                            "UPDATE lancamentos_trabalho SET tipo_tarefa_id=$1,quantidade=$2,data_referencia=$3,atualizado_em=$4 WHERE id=$5 AND ordem_servico_id=$6 AND atualizado_em IS $7",
                            vec![
                                value(serde_json::json!(1)),
                                value(serde_json::json!(3)),
                                value(serde_json::json!("2026-05-02")),
                                value(serde_json::json!("2026-05-02T12:00:00.000Z")),
                                value(serde_json::json!(item_id)),
                                value(serde_json::json!(order_id)),
                                value(serde_json::json!(item_before.clone())),
                            ],
                            None,
                        ),
                        1,
                    ),
                ];
                validate_write_statements(&edit).unwrap();
                write_transaction(&source, &queue, edit).await.unwrap();

                let stale_edit = expected_rows(
                    statement(
                        "UPDATE ordens_servico SET codigo_os=$1,status=$2,descricao=$3,municipio_id=$4,atualizada_em=$5 WHERE id=$6 AND atualizada_em=$7",
                        vec![
                            value(serde_json::json!("OS-ANTIGA")),
                            value(serde_json::json!("Em andamento")),
                            value(serde_json::Value::Null),
                            value(serde_json::json!(1)),
                            value(serde_json::json!("2026-05-03T12:00:00.000Z")),
                            value(serde_json::json!(order_id)),
                            value(serde_json::json!(before)),
                        ],
                        None,
                    ),
                    1,
                );
                assert!(write_transaction(&source, &queue, vec![stale_edit]).await.is_err());

                let returns = vec![
                    expected_rows(
                        statement(
                            "INSERT INTO historico_retornos(ordem_servico_id,motivo,justificativa) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND arquivada_em IS NULL)",
                            vec![
                                value(serde_json::json!(order_id)),
                                value(serde_json::json!("Reavaliar")),
                                value(serde_json::Value::Null),
                            ],
                            None,
                        ),
                        1,
                    ),
                    expected_rows(
                        statement(
                            "INSERT INTO historico_retornos(ordem_servico_id,motivo,justificativa) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND arquivada_em IS NULL)",
                            vec![
                                value(serde_json::json!(order_id)),
                                value(serde_json::json!("Outros")),
                                value(serde_json::json!("Ajuste de adaptação")),
                            ],
                            None,
                        ),
                        1,
                    ),
                ];
                validate_write_statements(&returns).unwrap();
                write_transaction(&source, &queue, returns).await.unwrap();

                let invalid_other = statement(
                    "INSERT INTO historico_retornos(ordem_servico_id,motivo,justificativa) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND arquivada_em IS NULL)",
                    vec![
                        value(serde_json::json!(order_id)),
                        value(serde_json::json!("Outros")),
                        value(serde_json::json!("   ")),
                    ],
                    None,
                );
                assert!(write_transaction(&source, &queue, vec![invalid_other]).await.is_err());

                let archive = vec![
                    expected_rows(
                        statement(
                            "UPDATE ordens_servico SET arquivada_em=$1,atualizada_em=$1 WHERE id=$2",
                            vec![
                                value(serde_json::json!("2026-05-04T12:00:00.000Z")),
                                value(serde_json::json!(order_id)),
                            ],
                            None,
                        ),
                        1,
                    ),
                    statement(
                        "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_anteriores) VALUES($1,'ARQUIVAMENTO',$2)",
                        vec![
                            value(serde_json::json!(order_id)),
                            value(serde_json::json!("{}")),
                        ],
                        None,
                    ),
                ];
                validate_write_statements(&archive).unwrap();
                write_transaction(&source, &queue, archive).await.unwrap();

                let backup = backup_document(snapshot_data(&source).await.unwrap()).unwrap();
                let parsed = validate_backup_contents(&backup).unwrap();
                let target = workflow_pool().await;
                let restore = backup_restore_statements(&parsed).unwrap();
                write_transaction(&target, &queue, restore).await.unwrap();

                let mut broken_restore = parsed.clone();
                broken_restore["data"]["lancamentos_trabalho"][0]["ordem_servico_id"] =
                    serde_json::json!(999);
                let broken_restore = validate_backup_contents(&broken_restore.to_string()).unwrap();
                assert!(write_transaction(
                    &target,
                    &queue,
                    backup_restore_statements(&broken_restore).unwrap(),
                )
                .await
                .is_err());

                let restored_order: (String, String) = sqlx::query_as(
                    "SELECT codigo_os,arquivada_em FROM ordens_servico WHERE id=$1",
                )
                .bind(order_id)
                .fetch_one(&target)
                .await
                .unwrap();
                assert_eq!(restored_order.0, "OS-TESTE");
                assert_eq!(restored_order.1, "2026-05-04T12:00:00.000Z");
                let item_quantity: i64 = sqlx::query_scalar(
                    "SELECT quantidade FROM lancamentos_trabalho WHERE id=$1 AND ordem_servico_id=$2",
                )
                .bind(item_id)
                .bind(order_id)
                .fetch_one(&target)
                .await
                .unwrap();
                assert_eq!(item_quantity, 3);
                let return_count: i64 = sqlx::query_scalar(
                    "SELECT COUNT(*) FROM historico_retornos WHERE ordem_servico_id=$1",
                )
                .bind(order_id)
                .fetch_one(&target)
                .await
                .unwrap();
                assert_eq!(return_count, 2);
                let violations = sqlx::query("PRAGMA foreign_key_check")
                    .fetch_all(&target)
                    .await
                    .unwrap();
                assert!(violations.is_empty());
            });
    }
}

fn snapshot_query() -> String {
    let objects = BACKUP_TABLES
        .iter()
        .map(|(table, columns)| {
            let fields = columns
                .iter()
                .map(|column| format!("'{column}', {column}"))
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "'{table}', json(COALESCE((SELECT json_group_array(json_object({fields})) FROM {table}), '[]'))"
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("SELECT json_object({objects})")
}

async fn snapshot_data(pool: &sqlx::SqlitePool) -> Result<serde_json::Value, String> {
    let raw: String = sqlx::query_scalar(&snapshot_query())
        .fetch_one(pool)
        .await
        .map_err(|error| format!("Não foi possível criar snapshot do banco: {error}"))?;
    serde_json::from_str(&raw).map_err(|_| "O SQLite retornou um snapshot inválido.".to_owned())
}

fn backup_document(data: serde_json::Value) -> Result<String, String> {
    let contents = serde_json::json!({
        "format": "odontoflow-backup",
        "version": 1,
        "createdAt": chrono_stamp(),
        "data": data,
    })
    .to_string();
    validate_backup_contents(&contents)?;
    Ok(contents)
}

fn validate_backup_contents(contents: &str) -> Result<serde_json::Value, String> {
    if contents.len() > MAX_BACKUP_BYTES {
        return Err("O backup excede o limite de 64 MB.".into());
    }
    let parsed: serde_json::Value = serde_json::from_str(contents)
        .map_err(|_| "O arquivo não contém JSON válido.".to_owned())?;
    if parsed.get("format").and_then(|value| value.as_str()) != Some("odontoflow-backup")
        || parsed.get("version").and_then(|value| value.as_u64()) != Some(1)
    {
        return Err("O arquivo não é um backup OdontoFlow compatível.".into());
    }
    let data = parsed
        .get("data")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "O backup está incompleto: dados ausentes.".to_owned())?;
    for (table, columns) in BACKUP_TABLES {
        let rows = data
            .get(*table)
            .and_then(|value| value.as_array())
            .ok_or_else(|| format!("O backup está incompleto: tabela {table} ausente."))?;
        for (index, row) in rows.iter().enumerate() {
            let row = row.as_object().ok_or_else(|| {
                format!("O backup contém um registro inválido em {table} ({index}).")
            })?;
            for key in row.keys() {
                if !columns.contains(&key.as_str()) {
                    return Err(format!(
                        "O backup contém uma coluna desconhecida em {table}."
                    ));
                }
            }
            for column in *columns {
                if !row.contains_key(*column) {
                    return Err(format!(
                        "O backup não contém a coluna {column} da tabela {table}."
                    ));
                }
                let value = &row[*column];
                let valid_type = value.is_null()
                    || if is_integer_backup_column(column) {
                        value.as_i64().is_some()
                    } else {
                        value.as_str().is_some()
                    };
                if !valid_type {
                    return Err(format!(
                        "O backup contém um valor inválido em {table}.{column}."
                    ));
                }
            }
        }
    }
    Ok(parsed)
}

fn backup_restore_statements(parsed: &serde_json::Value) -> Result<Vec<SqlStatement>, String> {
    let data = parsed
        .get("data")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "O backup está incompleto: dados ausentes.".to_owned())?;
    let mut statements = BACKUP_TABLES
        .iter()
        .rev()
        .map(|(table, _)| SqlStatement {
            query: format!("DELETE FROM {table}"),
            values: Vec::new(),
            capture_last_insert_id: None,
            expected_rows: None,
        })
        .collect::<Vec<_>>();
    for (table, columns) in BACKUP_TABLES {
        let rows = data
            .get(*table)
            .and_then(|value| value.as_array())
            .ok_or_else(|| format!("O backup está incompleto: tabela {table} ausente."))?;
        for row in rows {
            let row = row
                .as_object()
                .ok_or_else(|| format!("O backup contém um registro inválido em {table}."))?;
            let values = columns
                .iter()
                .map(|column| {
                    row.get(*column)
                        .cloned()
                        .map(SqlValue::Value)
                        .ok_or_else(|| format!("O backup não contém {table}.{column}."))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let placeholders = (1..=columns.len())
                .map(|index| format!("${index}"))
                .collect::<Vec<_>>()
                .join(",");
            statements.push(SqlStatement {
                query: format!(
                    "INSERT INTO {table} ({}) VALUES ({placeholders})",
                    columns.join(",")
                ),
                values,
                capture_last_insert_id: None,
                expected_rows: None,
            });
        }
    }
    Ok(statements)
}

fn selected_json_path(path: PathBuf, must_exist: bool) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Selecione um arquivo JSON de backup válido.".into());
    }
    let path = if !must_exist && path.extension().is_none() {
        path.with_extension("json")
    } else {
        path
    };
    if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
        return Err("Selecione um arquivo JSON de backup válido.".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "O local selecionado não é válido.".to_owned())?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|_| "Não foi possível validar a pasta selecionada.".to_owned())?;
    let file_name = path
        .file_name()
        .filter(|name| *name != "." && *name != "..")
        .ok_or_else(|| "O nome do arquivo selecionado não é válido.".to_owned())?;
    let target = canonical_parent.join(file_name);
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("Links simbólicos e pastas não são aceitos como backup.".into());
            }
            if must_exist && metadata.len() > MAX_BACKUP_BYTES as u64 {
                return Err("O backup excede o limite de 64 MB.".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !must_exist => {}
        Err(_) => return Err("Não foi possível validar o arquivo selecionado.".into()),
    }
    Ok(target)
}

fn write_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "O destino selecionado não é válido.".to_owned())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "O nome do destino selecionado não é válido.".to_owned())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(".{file_name}.{}.{}.tmp", std::process::id(), nonce));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result.map_err(|_| "Não foi possível gravar o backup selecionado.".to_owned())
}

fn create_internal_backup(app: &AppHandle, contents: &str) -> Result<PathBuf, String> {
    validate_backup_contents(contents)?;
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let stamp = chrono_stamp();
    let path = folder.join(format!("odontoflow-{stamp}.json"));
    write_atomically(&path, contents.as_bytes())?;
    let mut files: Vec<PathBuf> = fs::read_dir(&folder)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();
    files.sort();
    while files.len() > 30 {
        let expired = files.remove(0);
        let _ = fs::remove_file(expired);
    }
    Ok(path)
}

#[tauri::command]
fn create_backup(app: AppHandle, contents: String) -> Result<String, String> {
    let path = create_internal_backup(&app, &contents)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn write_backup_to_path(app: AppHandle, contents: String) -> Result<bool, String> {
    validate_backup_contents(&contents)?;
    let selected = app
        .dialog()
        .file()
        .set_title("Salvar backup do OdontoFlow")
        .set_file_name("odontoflow-backup.json")
        .add_filter("Backup JSON", &["json"])
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(false);
    };
    let path = selected
        .into_path()
        .map_err(|_| "Não foi possível acessar o destino selecionado.".to_owned())?;
    let path = selected_json_path(path, false)?;
    write_atomically(&path, contents.as_bytes())?;
    Ok(true)
}

#[tauri::command]
async fn read_consistent_database_snapshot(
    db: String,
    instances: State<'_, tauri_plugin_sql::DbInstances>,
) -> Result<serde_json::Value, String> {
    let instances = instances.0.read().await;
    let pool = match instances.get(&db) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => pool,
        None => return Err("O banco SQLite ainda não foi conectado.".into()),
    };
    snapshot_data(pool).await
}

#[tauri::command]
async fn restore_database_snapshot(
    app: AppHandle,
    db: String,
    instances: State<'_, tauri_plugin_sql::DbInstances>,
    write_queue: State<'_, SqliteWriteQueue>,
) -> Result<bool, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Selecionar backup do OdontoFlow")
        .add_filter("Backup JSON", &["json"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(false);
    };
    let path = selected
        .into_path()
        .map_err(|_| "Não foi possível acessar o arquivo selecionado.".to_owned())?;
    let path = selected_json_path(path, true)?;
    let contents = fs::read_to_string(path)
        .map_err(|_| "Não foi possível ler o backup selecionado.".to_owned())?;
    let parsed = validate_backup_contents(&contents)?;
    let confirmed = app
        .dialog()
        .message("A restauração substituirá os dados atuais. Uma cópia de segurança será criada antes da substituição. Deseja continuar?")
        .title("Restaurar backup do OdontoFlow")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();
    if !confirmed {
        return Ok(false);
    }

    let instances = instances.0.read().await;
    let pool = match instances.get(&db) {
        Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => pool,
        None => return Err("O banco SQLite ainda não foi conectado.".into()),
    };
    let current = backup_document(snapshot_data(pool).await?)?;
    create_internal_backup(&app, &current)?;
    let statements = backup_restore_statements(&parsed)?;
    write_transaction(pool, &write_queue, statements).await?;
    Ok(true)
}

fn chrono_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = elapsed.as_secs();
    let nanos = elapsed.subsec_nanos();
    format!("{seconds}-{nanos:09}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SqliteWriteQueue::default())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            create_backup,
            write_backup_to_path,
            read_consistent_database_snapshot,
            restore_database_snapshot,
            execute_sqlite_transaction,
            migrate_duplicate_order_codes_command
        ])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar OdontoFlow");
}
