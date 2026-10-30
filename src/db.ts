import Database from "@tauri-apps/plugin-sql";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export type StatusOS = "Em andamento" | "Finalizado" | "Retorno";
export type Order = {
  id: number;
  codigo_os: string;
  status: StatusOS;
  descricao: string | null;
  criada_em: string;
  atualizada_em: string;
  arquivada_em: string | null;
  municipio_id: number;
  municipio: string;
  total_trabalhos: number;
  task_names?: string;
};
export type Task = { id: number; nome: string; ativo: number };
export type Item = {
  id?: number;
  tipo_tarefa_id: number;
  nome: string;
  quantidade: number;
  data_referencia: string;
};
export type ReturnItem = {
  id: number;
  motivo: string;
  justificativa: string | null;
  registrado_em: string;
};
export type StatusChange = {
  id: number;
  de_status: StatusOS | null;
  para_status: StatusOS;
  alterado_em: string;
};
export type NotificationOrder = Pick<
  Order,
  "id" | "codigo_os" | "status" | "municipio"
> & {
  data_referencia: string | null;
  prioridade_data: string | null;
};

let connection: Promise<Database> | undefined;
const databasePathKey = "odontoflow.sqlite.path";

async function connectToExistingDatabase(path: string): Promise<Database> {
  const database = await Database.load(`sqlite:${path}`, { autoCreate: false });
  const tables = await database.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table'",
  );
  const tableNames = new Set(tables.map((table) => table.name));
  const required = [
    "municipios",
    "tipos_tarefa",
    "ordens_servico",
    "lancamentos_trabalho",
    "historico_retornos",
    "historico_status_os",
    "historico_alteracoes_os",
    "auditoria_lancamentos",
  ];
  const missing = required.filter((name) => !tableNames.has(name));
  if (missing.length) {
    await database.close();
    throw new Error(
      `O arquivo selecionado não contém as tabelas esperadas: ${missing.join(", ")}.`,
    );
  }
  const orderSchema = await database.select<{ sql: string }[]>(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='ordens_servico'",
  );
  const schemaText = orderSchema[0]?.sql ?? "";
  const indexes = await database.select<{ name: string; unique: number }[]>(
    "PRAGMA index_list('ordens_servico')",
  );
  let uniqueCodeIndex = false;
  for (const index of indexes.filter((row) => row.unique === 1)) {
    const escaped = index.name.replace(/"/g, '""');
    const columns = await database.select<{ name: string | null }[]>(
      `PRAGMA index_info("${escaped}")`,
    );
    if (columns.length === 1 && columns[0].name === "codigo_os") {
      uniqueCodeIndex = true;
      break;
    }
  }
  const hasInlineUnique = schemaText
    .toLowerCase()
    .replace(/[\r\n\t]/g, " ")
    .split(",")
    .some(
      (column) => column.includes("codigo_os") && column.includes("unique"),
    );
  if (hasInlineUnique || uniqueCodeIndex) {
    try {
      const tableNames = [
        "municipios",
        "tipos_tarefa",
        "ordens_servico",
        "lancamentos_trabalho",
        "historico_retornos",
        "historico_status_os",
        "historico_alteracoes_os",
        "auditoria_lancamentos",
      ];
      const data: Record<string, unknown[]> = {};
      for (const table of tableNames)
        data[table] = await database.select(`SELECT * FROM ${table}`);
      const contents = JSON.stringify({
        format: "odontoflow-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        data,
      });
      await invoke("create_backup", { contents });
      const migrated = await invoke<boolean>(
        "migrate_duplicate_order_codes_command",
        {
          db: database.path,
        },
      );
      if (migrated)
        console.info(
          "SQLite: códigos de OS agora podem se repetir; backup pré-migração criado.",
        );
    } catch (error) {
      console.error(
        "Falha na migração segura para códigos de OS duplicados",
        error,
      );
      await database.close();
      throw new Error(
        `Não foi possível atualizar o esquema de OS. O backup foi preservado. ${String(error)}`,
      );
    }
  }
  return database;
}

async function chooseDatabasePath(): Promise<string> {
  const selected = await open({
    title: "Abrir banco de dados do OdontoFlow",
    multiple: false,
    filters: [
      { name: "Banco SQLite", extensions: ["db", "sqlite", "sqlite3"] },
    ],
  });
  if (!selected || Array.isArray(selected))
    throw new Error(
      "Selecione o arquivo SQLite criado no DBeaver para continuar.",
    );
  return selected;
}

export const db = () => {
  if (connection) return connection;
  const attempt = (async () => {
    const path =
      localStorage.getItem(databasePathKey) ?? (await chooseDatabasePath());
    const database = await connectToExistingDatabase(path);
    localStorage.setItem(databasePathKey, path);
    return database;
  })();
  connection = attempt;
  void attempt.catch(() => {
    if (connection === attempt) connection = undefined;
  });
  return attempt;
};

export function currentDatabasePath() {
  return localStorage.getItem(databasePathKey) ?? "";
}

export async function changeDatabase(): Promise<string | null> {
  const selected = await open({
    title: "Selecionar banco de dados do OdontoFlow",
    defaultPath: currentDatabasePath() || undefined,
    multiple: false,
    filters: [
      { name: "Banco SQLite", extensions: ["db", "sqlite", "sqlite3"] },
    ],
  });
  if (!selected || Array.isArray(selected)) return null;
  if (selected === currentDatabasePath()) return selected;
  const next = await connectToExistingDatabase(selected);
  const previous = connection
    ? await connection.catch(() => undefined)
    : undefined;
  if (previous && selected !== currentDatabasePath()) await previous.close();
  localStorage.setItem(databasePathKey, selected);
  connection = Promise.resolve(next);
  return selected;
}

type FilterMode = "day" | "month";

function periodWindow(date: string, mode: FilterMode = "day") {
  const [year, month, day] = date.split("-").map(Number);
  if (mode === "month") {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      dateStart: `${year}-${String(month).padStart(2, "0")}-01`,
      dateEnd: `${new Date(year, month, 1).getFullYear()}-${String(new Date(year, month, 1).getMonth() + 1).padStart(2, "0")}-01`,
    };
  }
  const startDate = new Date(year, month - 1, day);
  const endDate = new Date(year, month - 1, day + 1);
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    dateStart: date,
    dateEnd: `${new Date(year, month - 1, day + 1).getFullYear()}-${String(new Date(year, month - 1, day + 1).getMonth() + 1).padStart(2, "0")}-${String(new Date(year, month - 1, day + 1).getDate()).padStart(2, "0")}`,
  };
}

export async function listOrders(filters: {
  date: string;
  mode?: FilterMode;
  status?: string;
  query?: string;
  task?: number;
}): Promise<Order[]> {
  const d = await db();
  const { start, end, dateStart, dateEnd } = periodWindow(
    filters.date,
    filters.mode ?? "day",
  );
  return d.select<Order[]>(
    `SELECT o.*,m.nome municipio,COALESCE(SUM(l.quantidade),0) total_trabalhos,GROUP_CONCAT(DISTINCT t.nome) task_names FROM ordens_servico o JOIN municipios m ON m.id=o.municipio_id LEFT JOIN lancamentos_trabalho l ON l.ordem_servico_id=o.id AND l.data_referencia >= $3 AND l.data_referencia < $4 LEFT JOIN tipos_tarefa t ON t.id=l.tipo_tarefa_id WHERE o.arquivada_em IS NULL AND o.criada_em >= $1 AND o.criada_em < $2 AND ($5='' OR o.status=$5) AND ($6='' OR o.codigo_os LIKE '%'||$6||'%' OR m.nome LIKE '%'||$6||'%') AND ($7=0 OR EXISTS(SELECT 1 FROM lancamentos_trabalho x WHERE x.ordem_servico_id=o.id AND x.tipo_tarefa_id=$7 AND x.data_referencia >= $3 AND x.data_referencia < $4)) GROUP BY o.id ORDER BY o.atualizada_em DESC`,
    [
      start,
      end,
      dateStart,
      dateEnd,
      filters.status ?? "",
      filters.query ?? "",
      filters.task ?? 0,
    ],
  );
}
export async function listTaskOrders(filters: {
  date: string;
  mode?: FilterMode;
  status?: string;
  task?: number;
}): Promise<Order[]> {
  const d = await db();
  const { dateStart, dateEnd } = periodWindow(
    filters.date,
    filters.mode ?? "day",
  );
  return d.select<Order[]>(
    `SELECT o.*,m.nome municipio,COALESCE(SUM(l.quantidade),0) total_trabalhos,GROUP_CONCAT(DISTINCT t.nome) task_names FROM ordens_servico o JOIN municipios m ON m.id=o.municipio_id JOIN lancamentos_trabalho l ON l.ordem_servico_id=o.id AND l.data_referencia >= $1 AND l.data_referencia < $2 JOIN tipos_tarefa t ON t.id=l.tipo_tarefa_id WHERE o.arquivada_em IS NULL AND ($3='' OR o.status=$3) AND ($4=0 OR l.tipo_tarefa_id=$4) GROUP BY o.id ORDER BY o.atualizada_em DESC`,
    [dateStart, dateEnd, filters.status ?? "", filters.task ?? 0],
  );
}
export async function getOrderById(id: number): Promise<Order | undefined> {
  const rows = await (
    await db()
  ).select<Order[]>(
    `SELECT o.*,m.nome municipio,COALESCE(SUM(l.quantidade),0) total_trabalhos,GROUP_CONCAT(DISTINCT t.nome) task_names FROM ordens_servico o JOIN municipios m ON m.id=o.municipio_id LEFT JOIN lancamentos_trabalho l ON l.ordem_servico_id=o.id LEFT JOIN tipos_tarefa t ON t.id=l.tipo_tarefa_id WHERE o.id=$1 GROUP BY o.id`,
    [id],
  );
  return rows[0];
}
export async function listNotificationOrders(): Promise<NotificationOrder[]> {
  return (await db()).select<NotificationOrder[]>(
    `SELECT o.id,o.codigo_os,o.status,m.nome municipio,
      (SELECT MIN(l.data_referencia) FROM lancamentos_trabalho l WHERE l.ordem_servico_id=o.id) data_referencia,
      (SELECT MAX(h.registrado_em) FROM historico_retornos h WHERE h.ordem_servico_id=o.id) prioridade_data
     FROM ordens_servico o JOIN municipios m ON m.id=o.municipio_id
     WHERE o.arquivada_em IS NULL AND o.status IN ('Em andamento','Retorno')
     ORDER BY CASE WHEN o.status='Retorno' THEN 0 ELSE 1 END,
       CASE WHEN o.status='Retorno' THEN COALESCE((SELECT MAX(h.registrado_em) FROM historico_retornos h WHERE h.ordem_servico_id=o.id),o.atualizada_em)
            ELSE COALESCE((SELECT MIN(l.data_referencia) FROM lancamentos_trabalho l WHERE l.ordem_servico_id=o.id),o.atualizada_em) END ASC,
       o.atualizada_em ASC`,
  );
}
export const listTasks = async () =>
  (await db()).select<Task[]>(
    "SELECT * FROM tipos_tarefa WHERE ativo=1 ORDER BY nome",
  );
export const getItems = async (id: number) =>
  (await db()).select<Item[]>(
    "SELECT l.id,l.tipo_tarefa_id,t.nome,l.quantidade,l.data_referencia FROM lancamentos_trabalho l JOIN tipos_tarefa t ON t.id=l.tipo_tarefa_id WHERE l.ordem_servico_id=$1 ORDER BY t.nome",
    [id],
  );
export const getReturns = async (id: number) =>
  (await db()).select<ReturnItem[]>(
    "SELECT * FROM historico_retornos WHERE ordem_servico_id=$1 ORDER BY registrado_em DESC",
    [id],
  );
export const getStatusHistory = async (id: number) =>
  (await db()).select<StatusChange[]>(
    "SELECT id,de_status,para_status,alterado_em FROM historico_status_os WHERE ordem_servico_id=$1 ORDER BY alterado_em DESC,id DESC",
    [id],
  );
