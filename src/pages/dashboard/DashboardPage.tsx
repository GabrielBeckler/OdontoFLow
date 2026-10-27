import { Activity, Archive, ArrowDownToLine, ClipboardList, ListChecks } from "lucide-react";
import { Bar, BarChart, Cell, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Order, StatusOS } from "../../db";
import type { MunicipalityOrderCount, ReturnCount, TaskQuantity } from "../../services/dashboard";
import Metric from "../../components/Metric";
import OrderTable from "../../components/OrderTable";

const colors = ["#38a68b", "#6485d7", "#eda85d", "#cc7791", "#8a75c9", "#57a8b8"];
const fmtReferenceDate = (s: string) => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : new Date(s).toLocaleDateString("pt-BR");
};

type Props = {
 orders: Order[]; totalWork: number; countByStatus: {name: StatusOS; value: number}[];
 totalReturns: number; municipalityOrders: MunicipalityOrderCount[]; selectedDate: string;
 taskQuantities: TaskQuantity[]; returnStats: ReturnCount[];
 setView: (view: "dashboard" | "ordens" | "quadro" | "tarefas" | "municipios" | "config") => void;
 setTaskFilter: (id: number) => void;
 openMunicipalityOrders: (name: string, status?: string) => void;
 beginOrder: (order?: Order) => void;
};

export default function DashboardPage({ orders, totalWork, countByStatus, totalReturns, municipalityOrders, selectedDate, taskQuantities, returnStats, setView, setTaskFilter, openMunicipalityOrders, beginOrder }: Props) {
 return (
              <div className="content">
                <div className="welcome-row">
                  <div>
                    <h2>
                      Olá, Gabriel <span>✦</span>
                    </h2>
                    <p>
                      Acompanhe a produção do seu laboratório em um só lugar.
                    </p>
                  </div>
                  <button
                    className="outline-button"
                    onClick={() => window.print()}
                  >
                    <ArrowDownToLine size={16} /> Exportar relatório
                  </button>
                </div>
                <div className="metric-grid">
                  <Metric
                    label="OS cadastradas"
                    value={orders.length}
                    icon={<ClipboardList />}
                    tone="mint"
                    sub="Criadas na data selecionada"
                  />
                  <Metric
                    label="Trabalhos registrados"
                    value={totalWork}
                    icon={<ListChecks />}
                    tone="blue"
                    sub="Lançamentos na data selecionada"
                  />
                  <Metric
                    label="OS finalizadas"
                    value={countByStatus[1].value}
                    icon={<Activity />}
                    tone="green"
                    sub="Status ao fim da data selecionada"
                  />
                  <Metric
                    label="Ocorrências de retorno"
                    value={totalReturns}
                    icon={<Archive />}
                    tone="orange"
                    sub="Registradas na data selecionada"
                  />
                </div>
                <div className="dashboard-grid">
                  <section className="panel municipality-dashboard-panel">
                    <div className="panel-head">
                      <div>
                        <h3>Ordens de serviço por município</h3>
                        <p>
                          OS criadas em {fmtReferenceDate(selectedDate)}
                        </p>
                      </div>
                    </div>
                    {municipalityOrders.length ? (
                      <>
                        <div
                          className="municipality-bars"
                          style={{
                            height: Math.max(220, municipalityOrders.length * 31),
                          }}
                        >
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={municipalityOrders}
                              layout="vertical"
                              margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
                              barCategoryGap={8}
                            >
                              <CartesianGrid
                                horizontal={false}
                                stroke="#edf1ee"
                              />
                              <XAxis
                                type="number"
                                allowDecimals={false}
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 9, fill: "#87948c" }}
                              />
                              <YAxis
                                type="category"
                                dataKey="name"
                                width={108}
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 9, fill: "#68766e" }}
                              />
                              <Tooltip
                                formatter={(value) => [`${value} OS`, "Total"]}
                              />
                              <Bar
                                dataKey="total"
                                radius={[0, 5, 5, 0]}
                                onClick={(entry) =>
                                  openMunicipalityOrders(
                                    String(entry.name ?? ""),
                                  )
                                }
                              >
                                {municipalityOrders.map((row, index) => (
                                  <Cell
                                    key={row.id}
                                    fill={colors[index % colors.length]}
                                    cursor="pointer"
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="municipality-counts">
                          {municipalityOrders.map((row, index) => (
                            <div
                              className="municipality-count-row"
                              key={row.id}
                            >
                              <button
                                className="municipality-total"
                                onClick={() => openMunicipalityOrders(row.name)}
                              >
                                <i
                                  style={{
                                    background: colors[index % colors.length],
                                  }}
                                />
                                <b>{row.name}</b>
                                <strong>{row.total}</strong>
                              </button>
                              <div className="municipality-status-counts">
                                <button
                                  title={`Ver OS em andamento de ${row.name}`}
                                  onClick={() =>
                                    openMunicipalityOrders(
                                      row.name,
                                      "Em andamento",
                                    )
                                  }
                                >
                                  Em andamento <b>{row.inProgress}</b>
                                </button>
                                <button
                                  title={`Ver OS finalizadas de ${row.name}`}
                                  onClick={() =>
                                    openMunicipalityOrders(
                                      row.name,
                                      "Finalizado",
                                    )
                                  }
                                >
                                  Finalizado <b>{row.finalized}</b>
                                </button>
                                <button
                                  title={`Ver OS em retorno de ${row.name}`}
                                  onClick={() =>
                                    openMunicipalityOrders(row.name, "Retorno")
                                  }
                                >
                                  Retorno <b>{row.returns}</b>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="empty-small">
                        Nenhuma OS cadastrada nesta data.
                      </div>
                    )}
                  </section>
                  <section className="panel status-panel">
                    <div className="panel-head">
                      <div>
                        <h3>OS por status</h3>
                        <p>Situação ao fim de {fmtReferenceDate(selectedDate)}</p>
                      </div>
                      <button className="more-button">•••</button>
                    </div>
                    <div className="donut-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={countByStatus}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={4}
                            stroke="none"
                          >
                            {countByStatus.map((x, i) => (
                              <Cell
                                key={x.name}
                                fill={["#56b99a", "#6587dd", "#eda458"][i]}
                              />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="donut-center">
                        <b>{countByStatus.reduce((s, x) => s + x.value, 0)}</b>
                        <span>OS nesta data</span>
                      </div>
                    </div>
                    <div className="legend">
                      {countByStatus.map((x, i) => (
                        <div key={x.name}>
                          <span
                            style={{
                              background: ["#56b99a", "#6587dd", "#eda458"][i],
                            }}
                          />
                          {x.name}
                          <b>{x.value}</b>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
                <div className="bottom-grid">
                  <section className="panel task-panel">
                    <div className="panel-head">
                      <div>
                        <h3>Distribuição por tarefa</h3>
                        <p>Total de {totalWork} trabalhos na data selecionada</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setView("tarefas")}
                      >
                        Ver todas →
                      </button>
                    </div>
                    <div className="task-list">
                      {taskQuantities.map((t, i) => (
                        <button
                          className="task-row"
                          key={t.id}
                          onClick={() => {
                            setTaskFilter(t.id);
                            setView("tarefas");
                          }}
                        >
                          <span
                            className="task-dot"
                            style={{ background: colors[i % colors.length] }}
                          />
                          <span>{t.name}</span>
                          <div className="progress">
                            <i
                              style={{
                                width: `${totalWork ? Math.max(4, (t.value / totalWork) * 100) : 0}%`,
                                background: colors[i % colors.length],
                              }}
                            />
                          </div>
                          <b>{t.value}</b>
                          <small>
                            {totalWork
                              ? Math.round((t.value / totalWork) * 100)
                              : 0}
                            %
                          </small>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="panel return-panel">
                    <div className="panel-head">
                      <div>
                        <h3>Motivos de retorno</h3>
                        <p>Ocorrências registradas na data selecionada</p>
                      </div>
                      <button className="more-button">•••</button>
                    </div>
                    {returnStats.length === 0 ? (
                      <div className="empty-small">
                        Nenhum retorno registrado nesta data.
                      </div>
                    ) : (
                      <div className="return-list">
                        {returnStats.map((r, i) => (
                          <button
                            key={r.name}
                            onClick={() => setView("ordens")}
                          >
                            <span
                              className="return-dot"
                              style={{
                                background: colors[(i + 2) % colors.length],
                              }}
                            />
                            <span>{r.name}</span>
                            <b>{r.value}</b>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
                <section className="panel recent-panel">
                  <div className="panel-head">
                    <div>
                      <h3>Ordens recentes</h3>
                        <p>Ordens criadas na data selecionada</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setView("ordens")}
                    >
                      Ver todas →
                    </button>
                  </div>
                  <OrderTable
                    rows={orders.slice(0, 5)}
                    open={(o) => void beginOrder(o)}
                  />
                </section>
              </div>
 );
}
