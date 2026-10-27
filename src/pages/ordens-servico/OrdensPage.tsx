import { ArrowDownToLine, FilePlus2, Search } from "lucide-react";
import type { Order, Task, StatusOS } from "../../db";
import OrderTable from "../../components/OrderTable";

const statuses: StatusOS[] = ["Em andamento", "Finalizado", "Retorno"];
const fmtReferenceDate = (s: string) => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : new Date(s).toLocaleDateString("pt-BR");
};

type Props = {
  orders: Order[]; tasks: Task[]; selectedDate: string; query: string;
  setQuery: (value: string) => void; statusFilter: string;
  setStatusFilter: (value: string) => void; taskFilter: number;
  setTaskFilter: (value: number) => void; beginOrder: (order?: Order) => void;
  archiveOrder: (order: Order) => void;
};

export default function OrdensPage({ orders, tasks, selectedDate, query, setQuery, statusFilter, setStatusFilter, taskFilter, setTaskFilter, beginOrder, archiveOrder }: Props) {
  return (
              <div className="content">
                <div className="list-toolbar">
                  <div className="search-field">
                    <Search size={17} />
                    <input
                      placeholder="Buscar por código ou município..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">Todos os status</option>
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <select
                    className="filter-select"
                    value={taskFilter}
                    onChange={(e) => setTaskFilter(Number(e.target.value))}
                  >
                    <option value={0}>Todas as tarefas</option>
                    {tasks.map((t) => (
                      <option value={t.id} key={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary-button"
                    onClick={() => void beginOrder()}
                  >
                    <FilePlus2 size={16} /> Cadastrar OS
                  </button>
                </div>
                <section className="panel table-panel">
                  <div className="panel-head">
                    <div>
                      <h3>{orders.length} ordens de serviço</h3>
                      <p>
                        Data: {fmtReferenceDate(selectedDate)}
                      </p>
                    </div>
                    <button
                      className="outline-button"
                      onClick={() => window.print()}
                    >
                      <ArrowDownToLine size={15} /> Exportar / PDF
                    </button>
                  </div>
                  <OrderTable
                    rows={orders}
                    open={(o) => void beginOrder(o)}
                    archive={(o) => void archiveOrder(o)}
                  />
                </section>
              </div>
  );
}
