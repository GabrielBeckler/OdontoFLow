import { invoke } from "@tauri-apps/api/core";
import { db } from "../../db";

export async function createDatabaseSnapshot(): Promise<string> {
  const database = await db();
  const data = await invoke<Record<string, unknown[]>>(
    "read_consistent_database_snapshot",
    { db: database.path },
  );
  return JSON.stringify({
    format: "odontoflow-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    data,
  });
}

export async function restoreDatabaseSnapshot(): Promise<boolean> {
  const database = await db();
  return invoke<boolean>("restore_database_snapshot", { db: database.path });
}
