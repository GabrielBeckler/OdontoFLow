import { db } from "../db";
import type { StatusOS } from "../db";

export type TaskQuantity = { id: number; name: string; value: number };
export type StatusCount = { name: StatusOS; value: number };
export type ReturnCount = { name: string; value: number };
export type MunicipalityOrderCount = {
  id: number;
  name: string;
  total: number;
  inProgress: number;
  finalized: number;
  returns: number;
};

function dayBounds(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return {
    start: new Date(year, month - 1, day).toISOString(),
    end: new Date(year, month - 1, day + 1).toISOString(),
  };
}

export async function listMunicipalityOrderCounts(
  date: string,
): Promise<MunicipalityOrderCount[]> {
  const { start, end } = dayBounds(date);
  return (await db()).select<MunicipalityOrderCount[]>(
    `SELECT m.id,m.nome name,COUNT(o.id) total,
      SUM(CASE WHEN o.status='Em andamento' THEN 1 ELSE 0 END) inProgress,
      SUM(CASE WHEN o.status='Finalizado' THEN 1 ELSE 0 END) finalized,
      SUM(CASE WHEN o.status='Retorno' THEN 1 ELSE 0 END) returns
     FROM ordens_servico o JOIN municipios m ON m.id=o.municipio_id
     WHERE o.arquivada_em IS NULL AND o.criada_em >= $1 AND o.criada_em < $2
     GROUP BY m.id ORDER BY total DESC,m.nome`,
    [start, end],
  );
}

export async function listTaskQuantities(date: string): Promise<TaskQuantity[]> {
  return (await db()).select<TaskQuantity[]>(
    `SELECT t.id,t.nome name,COALESCE(SUM(l.quantidade),0) value FROM tipos_tarefa t LEFT JOIN (SELECT l.tipo_tarefa_id,SUM(l.quantidade) quantidade FROM lancamentos_trabalho l JOIN ordens_servico o ON o.id=l.ordem_servico_id AND o.arquivada_em IS NULL WHERE l.data_referencia=$1 GROUP BY l.tipo_tarefa_id) l ON l.tipo_tarefa_id=t.id WHERE t.ativo=1 GROUP BY t.id ORDER BY t.nome`,
    [date],
  );
}

export async function listStatusCounts(
  date: string,
): Promise<StatusCount[]> {
  const { end } = dayBounds(date);
  return (await db()).select<StatusCount[]>(
    `SELECT h.para_status name,COUNT(*) value FROM ordens_servico o JOIN historico_status_os h ON h.id=(SELECT h2.id FROM historico_status_os h2 WHERE h2.ordem_servico_id=o.id AND h2.alterado_em<$1 ORDER BY h2.alterado_em DESC,h2.id DESC LIMIT 1) WHERE o.criada_em<$1 AND o.arquivada_em IS NULL GROUP BY h.para_status`,
    [end],
  );
}

export async function listReturnCounts(
  date: string,
): Promise<ReturnCount[]> {
  const { start, end } = dayBounds(date);
  return (await db()).select<ReturnCount[]>(
    "SELECT motivo name,COUNT(*) value FROM historico_retornos WHERE registrado_em >= $1 AND registrado_em < $2 GROUP BY motivo ORDER BY value DESC",
    [start, end],
  );
}
