import { db } from "../db";
import { executeSqliteTransaction } from "./database/transactions";
import type { Municipality } from "../types/municipality";

export async function listMunicipalities(): Promise<Municipality[]> {
  return (await db()).select<Municipality[]>(
    "SELECT id,codigo,nome,ativo FROM municipios WHERE ativo=1 ORDER BY nome",
  );
}

export async function listAllMunicipalities(): Promise<Municipality[]> {
  return (await db()).select<Municipality[]>(
    "SELECT id,codigo,nome,ativo FROM municipios ORDER BY ativo DESC,nome",
  );
}

export async function saveMunicipality(input: {
  codigo: string;
  nome: string;
}): Promise<void> {
  const codigo = input.codigo.trim();
  const nome = input.nome.trim();
  if (!codigo || !nome)
    throw new Error("Informe o código e o nome do município.");

  const database = await db();
  const duplicate = await database.select<{ codigo: string; nome: string }[]>(
    "SELECT codigo,nome FROM municipios WHERE lower(trim(codigo))=lower(trim($1)) OR lower(trim(nome))=lower(trim($2)) LIMIT 1",
    [codigo, nome],
  );
  if (duplicate.length) {
    const sameCode = duplicate.some(
      (municipality) =>
        municipality.codigo.trim().toLocaleLowerCase() ===
        codigo.toLocaleLowerCase(),
    );
    throw new Error(
      sameCode
        ? "Já existe um município cadastrado com esse código."
        : "Já existe um município cadastrado com esse nome.",
    );
  }

  await executeSqliteTransaction([
    {
      query: "INSERT INTO municipios(codigo,nome,ativo) VALUES($1,$2,1)",
      values: [codigo, nome],
    },
  ]);
}

export async function setMunicipalityActive(
  id: number,
  active: boolean,
): Promise<void> {
  await executeSqliteTransaction([
    {
      query: "UPDATE municipios SET ativo=$1 WHERE id=$2",
      values: [active ? 1 : 0, id],
    },
  ]);
}

export function municipalityErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE"))
    return "Já existe um município cadastrado com esse código ou nome.";
  return message;
}
