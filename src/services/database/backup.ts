import { invoke } from "@tauri-apps/api/core";
import { db } from "../../db";
import { executeSqliteTransaction, type SqlStatement } from "./transactions";

const tableColumns: Record<string, string[]> = {
  municipios: ["id", "codigo", "nome", "ativo"],
  tipos_tarefa: ["id", "nome", "ativo"],
  ordens_servico: [
    "id",
    "codigo_os",
    "status",
    "descricao",
    "criada_em",
    "atualizada_em",
    "arquivada_em",
    "municipio_id",
  ],
  lancamentos_trabalho: [
    "id",
    "ordem_servico_id",
    "tipo_tarefa_id",
    "quantidade",
    "data_referencia",
    "criado_em",
    "atualizado_em",
  ],
  historico_retornos: [
    "id",
    "ordem_servico_id",
    "motivo",
    "justificativa",
    "registrado_em",
  ],
  historico_status_os: [
    "id",
    "ordem_servico_id",
    "de_status",
    "para_status",
    "alterado_em",
  ],
  historico_alteracoes_os: [
    "id",
    "ordem_servico_id",
    "operacao",
    "valores_anteriores",
    "valores_novos",
    "registrado_em",
  ],
  auditoria_lancamentos: [
    "id",
    "lancamento_id",
    "operacao",
    "valores_anteriores",
    "valores_novos",
    "registrado_em",
  ],
};

export async function createDatabaseSnapshot(): Promise<string> {
  const database = await db();
  const data: Record<string, unknown[]> = {};
  for (const table of Object.keys(tableColumns))
    data[table] = await database.select(`SELECT * FROM ${table}`);
  return JSON.stringify({
    format: "odontoflow-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    data,
  });
}

export async function restoreDatabaseSnapshot(contents: string): Promise<void> {
  const parsed = JSON.parse(contents) as {
    format?: string;
    version?: number;
    data?: Record<string, Record<string, unknown>[]>;
  };
  if (
    parsed.format !== "odontoflow-backup" ||
    parsed.version !== 1 ||
    !parsed.data ||
    Object.keys(tableColumns).some(
      (table) => !Array.isArray(parsed.data?.[table]),
    )
  )
    throw new Error("Arquivo incompatível ou incompleto.");

  await invoke("create_backup", { contents: await createDatabaseSnapshot() });
  const statements: SqlStatement[] = Object.keys(tableColumns)
    .reverse()
    .map((table) => ({ query: `DELETE FROM ${table}` }));
  for (const [table, columns] of Object.entries(tableColumns))
    for (const row of parsed.data[table]) {
      const present = columns.filter((column) =>
        Object.prototype.hasOwnProperty.call(row, column),
      );
      const values = present.map((column) => row[column]) as (
        | string
        | number
        | boolean
        | null
      )[];
      statements.push({
        query: `INSERT INTO ${table} (${present.join(",")}) VALUES (${present.map((_, index) => `$${index + 1}`).join(",")})`,
        values,
      });
    }
  await executeSqliteTransaction(statements);
}
