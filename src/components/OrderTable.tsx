import { Archive } from "lucide-react";
import type { Order } from "../db";

const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString("pt-BR") : "—";
const slug = (s: string) =>
  s.toLowerCase().replace(/ /g, "-").replace("ã", "a");

export default function OrderTable({
  rows,
  open,
  archive,
}: {
  rows: Order[];
  open: (o: Order) => void;
  archive?: (o: Order) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>CÓDIGO DA OS</th>
            <th>MUNICÍPIO</th>
            <th>TIPOS DE TAREFA</th>
            <th>TRABALHOS</th>
            <th>STATUS</th>
            <th>ATUALIZADA</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty-cell" colSpan={7}>
                Nenhuma OS encontrada nesta data.
              </td>
            </tr>
          ) : (
            rows.map((o) => (
              <tr key={o.id} onClick={() => open(o)}>
                <td>
                  <b className="order-code">{o.codigo_os}</b>
                </td>
                <td>{o.municipio}</td>
                <td>{o.task_names || "Ver detalhes"}</td>
                <td>
                  <b>{o.total_trabalhos}</b>
                </td>
                <td>
                  <span className={`status-pill ${slug(o.status)}`}>
                    <i /> {o.status}
                  </span>
                </td>
                <td>{fmtDate(o.atualizada_em)}</td>
                <td>
                  {archive && (
                    <button
                      className="icon-button table-action"
                      title="Arquivar"
                      onClick={(e) => {
                        e.stopPropagation();
                        archive(o);
                      }}
                    >
                      <Archive size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
