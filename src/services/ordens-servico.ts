import { db } from "../db";
import type { Item, Order, StatusOS } from "../db";
import { executeSqliteTransaction, type SqlStatement } from "./database/transactions";

export type OrderDraft = {
  codigo_os: string;
  status: StatusOS;
  descricao: string;
  municipio_id: number;
};

export async function saveOrder(
  editing: Order | null,
  draft: OrderDraft,
  items: Item[],
): Promise<number> {
  const timestamp = new Date().toISOString();
  const statements: SqlStatement[] = [];

  if (editing) {
    statements.push({
      query: "UPDATE ordens_servico SET codigo_os=$1,status=$2,descricao=$3,municipio_id=$4,atualizada_em=$5 WHERE id=$6",
      values: [draft.codigo_os.trim(), draft.status, draft.descricao.trim() || null, draft.municipio_id, timestamp, editing.id],
      expectedRows: 1,
    });
    if (editing.status !== draft.status)
      statements.push({
        query: "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status,alterado_em) VALUES($1,$2,$3,$4)",
        values: [editing.id, editing.status, draft.status, timestamp],
      });
    statements.push({
      query: "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_anteriores,valores_novos,registrado_em) VALUES($1,'EDICAO',$2,$3,$4)",
      values: [editing.id, JSON.stringify(editing), JSON.stringify(draft), timestamp],
    });

    const database = await db();
    for (const [index, item] of items.entries()) {
      if (item.id) {
        const old = (await database.select<Record<string, unknown>[]>(
          "SELECT * FROM lancamentos_trabalho WHERE id=$1 AND ordem_servico_id=$2",
          [item.id, editing.id],
        ))[0];
        if (!old) throw new Error("Um lançamento desta OS não foi encontrado. Atualize a tela e tente novamente.");
        const next = {
          ...old,
          tipo_tarefa_id: item.tipo_tarefa_id,
          quantidade: item.quantidade,
          data_referencia: item.data_referencia,
          atualizado_em: timestamp,
        };
        statements.push(
          {
            query: "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_anteriores,valores_novos,registrado_em) VALUES($1,'EDICAO',$2,$3,$4)",
            values: [item.id, JSON.stringify(old), JSON.stringify(next), timestamp],
          },
          {
            query: "UPDATE lancamentos_trabalho SET tipo_tarefa_id=$1,quantidade=$2,data_referencia=$3,atualizado_em=$4 WHERE id=$5 AND ordem_servico_id=$6",
            values: [item.tipo_tarefa_id, item.quantidade, item.data_referencia, timestamp, item.id, editing.id],
            expectedRows: 1,
          },
        );
      } else {
        const capture = `new_item_${index}`;
        statements.push(
          {
            query: "INSERT INTO lancamentos_trabalho(ordem_servico_id,tipo_tarefa_id,quantidade,data_referencia) VALUES($1,$2,$3,$4)",
            values: [editing.id, item.tipo_tarefa_id, item.quantidade, item.data_referencia],
            captureLastInsertId: capture,
          },
          {
            query: "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_novos) VALUES($1,'CRIACAO',$2)",
            values: [{ reference: capture }, JSON.stringify(item)],
          },
        );
      }
    }

    const keep = items.flatMap((item) => item.id ? [item.id] : []);
    const removed = await database.select<Record<string, unknown>[]>(
      keep.length
        ? `SELECT * FROM lancamentos_trabalho WHERE ordem_servico_id=$1 AND id NOT IN (${keep.map((_, index) => `$${index + 2}`).join(",")})`
        : "SELECT * FROM lancamentos_trabalho WHERE ordem_servico_id=$1",
      keep.length ? [editing.id, ...keep] : [editing.id],
    );
    for (const row of removed)
      statements.push(
        {
          query: "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_anteriores,registrado_em) VALUES($1,'EXCLUSAO',$2,$3)",
          values: [row.id as number, JSON.stringify(row), timestamp],
        },
        {
          query: "DELETE FROM lancamentos_trabalho WHERE id=$1 AND ordem_servico_id=$2",
          values: [row.id as number, editing.id],
          expectedRows: 1,
        },
      );
  } else {
    statements.push(
      {
        query: "INSERT INTO ordens_servico(codigo_os,status,descricao,municipio_id) VALUES($1,$2,$3,$4)",
        values: [draft.codigo_os.trim(), draft.status, draft.descricao.trim() || null, draft.municipio_id],
        captureLastInsertId: "order_id",
      },
      {
        query: "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status) VALUES($1,NULL,$2)",
        values: [{ reference: "order_id" }, draft.status],
      },
      {
        query: "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_novos) VALUES($1,'CRIACAO',$2)",
        values: [{ reference: "order_id" }, JSON.stringify(draft)],
      },
    );
    items.forEach((item, index) => {
      const capture = `item_${index}`;
      statements.push(
        {
          query: "INSERT INTO lancamentos_trabalho(ordem_servico_id,tipo_tarefa_id,quantidade,data_referencia) VALUES($1,$2,$3,$4)",
          values: [{ reference: "order_id" }, item.tipo_tarefa_id, item.quantidade, item.data_referencia],
          captureLastInsertId: capture,
        },
        {
          query: "INSERT INTO auditoria_lancamentos(lancamento_id,operacao,valores_novos) VALUES($1,'CRIACAO',$2)",
          values: [{ reference: capture }, JSON.stringify(item)],
        },
      );
    });
  }

  const result = await executeSqliteTransaction(statements);
  return editing?.id ?? result.order_id;
}

export async function addReturn(
  orderId: number,
  reason: string,
  justification: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  await executeSqliteTransaction([
    {
      query: "INSERT INTO historico_retornos(ordem_servico_id,motivo,justificativa) VALUES($1,$2,$3)",
      values: [orderId, reason, justification.trim() || null],
    },
    {
      query: "UPDATE ordens_servico SET atualizada_em=$1 WHERE id=$2",
      values: [timestamp, orderId],
    },
  ]);
}

export async function archiveOrder(order: Order): Promise<void> {
  const timestamp = new Date().toISOString();
  await executeSqliteTransaction([
    {
      query: "UPDATE ordens_servico SET arquivada_em=$1,atualizada_em=$1 WHERE id=$2",
      values: [timestamp, order.id],
    },
    {
      query: "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_anteriores) VALUES($1,'ARQUIVAMENTO',$2)",
      values: [order.id, JSON.stringify(order)],
    },
  ]);
}

export async function changeOrderStatus(order: Order, status: StatusOS): Promise<void> {
  if (order.status === status) return;
  const timestamp = new Date().toISOString();
  await executeSqliteTransaction([
    {
      query: "UPDATE ordens_servico SET status=$1,atualizada_em=$2 WHERE id=$3 AND status=$4",
      values: [status, timestamp, order.id, order.status],
    },
    {
      query: "INSERT INTO historico_status_os(ordem_servico_id,de_status,para_status,alterado_em) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND status=$3 AND atualizada_em=$4)",
      values: [order.id, order.status, status, timestamp],
    },
    {
      query: "INSERT INTO historico_alteracoes_os(ordem_servico_id,operacao,valores_anteriores,valores_novos,registrado_em) SELECT $1,'EDICAO',$2,$3,$4 WHERE EXISTS(SELECT 1 FROM ordens_servico WHERE id=$1 AND status=$5 AND atualizada_em=$4)",
      values: [order.id, JSON.stringify(order), JSON.stringify({ ...order, status, atualizada_em: timestamp }), timestamp, status],
    },
  ]);
}
