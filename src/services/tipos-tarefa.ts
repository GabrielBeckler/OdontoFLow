import { db } from "../db";
import { executeSqliteTransaction } from "./database/transactions";
import type { Task } from "../db";

export async function listAllTasks(): Promise<Task[]> {
  return (await db()).select<Task[]>(
    "SELECT id,nome,ativo FROM tipos_tarefa ORDER BY ativo DESC,nome",
  );
}

export async function createTask(name: string): Promise<void> {
  const normalized = name.trim();
  if (!normalized) throw new Error("Informe o nome do serviço.");
  if (normalized.length > 120)
    throw new Error("O nome do serviço deve ter até 120 caracteres.");
  await executeSqliteTransaction([
    {
      query: "INSERT INTO tipos_tarefa(nome,ativo) SELECT $1,1 WHERE NOT EXISTS(SELECT 1 FROM tipos_tarefa WHERE lower(trim(nome))=lower(trim($1)))",
      values: [normalized],
      expectedRows: 1,
    },
  ]);
}

export async function setTaskActive(id: number, active: boolean): Promise<void> {
  await executeSqliteTransaction([
    {
      query: "UPDATE tipos_tarefa SET ativo=$1 WHERE id=$2",
      values: [active ? 1 : 0, id],
      expectedRows: 1,
    },
  ]);
}

export function taskErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE") || message.includes("eram esperados 1"))
    return "Já existe um serviço com esse nome ou ele foi alterado em outra janela.";
  return message;
}
