use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;
use sqlx::{Connection, Sqlite};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, State};
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
                        query.bind(unsigned as i64)
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

    fn statement(query: &str, values: Vec<SqlValue>, capture: Option<&str>) -> SqlStatement {
        SqlStatement {
            query: query.into(),
            values,
            capture_last_insert_id: capture.map(str::to_owned),
            expected_rows: None,
        }
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
}

#[tauri::command]
fn create_backup(app: AppHandle, contents: String) -> Result<String, String> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let stamp = chrono_stamp();
    let path = folder.join(format!("odontoflow-{stamp}.json"));
    fs::write(&path, contents).map_err(|e| e.to_string())?;
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
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_backup(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_backup_to_path(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| e.to_string())
}

fn chrono_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", seconds)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SqliteWriteQueue::default())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            create_backup,
            read_backup,
            write_backup_to_path,
            execute_sqlite_transaction,
            migrate_duplicate_order_codes_command
        ])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar OdontoFlow");
}
