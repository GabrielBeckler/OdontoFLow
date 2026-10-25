import { invoke } from "@tauri-apps/api/core";
import { db } from "../../db";

export type SqlParameter = string | number | boolean | null | { reference: string };
export type SqlStatement = {
  query: string;
  values?: SqlParameter[];
  captureLastInsertId?: string;
  expectedRows?: number;
};

export async function executeSqliteTransaction(
  statements: SqlStatement[],
): Promise<Record<string, number>> {
  const database = await db();
  try {
    return await invoke<Record<string, number>>("execute_sqlite_transaction", {
      db: database.path,
      statements,
    });
  } catch (error) {
    console.error("Falha ao confirmar transação SQLite", error);
    throw error;
  }
}
