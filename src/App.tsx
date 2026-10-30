import { useEffect, useRef, useState } from "react";
import TaskSettings from "./components/TaskSettings";
import OrderTable from "./components/OrderTable";
import DashboardPage from "./pages/dashboard/DashboardPage";
import OrdensPage from "./pages/ordens-servico/OrdensPage";
import {
  Activity,
  Archive,
  ArrowDownToLine,
  Bell,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Plus,
  Settings2,
  Stethoscope,
  Sun,
  Moon,
  Trash2,
  X,
} from "lucide-react";
import lightLogo from "../OdontoFlow_Identidade_Visual_SVG/01_logo_horizontal_fundo_claro.svg";
import darkLogo from "../OdontoFlow_Identidade_Visual_SVG/02_logo_horizontal_fundo_escuro.svg";
import { confirm } from "@tauri-apps/plugin-dialog";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  changeDatabase,
  currentDatabasePath,
  db,
  getItems,
  getOrderById,
  getReturns,
  getStatusHistory,
  listOrders,
  listNotificationOrders,
  listTaskOrders,
  listTasks,
  type Item,
  type Order,
  type NotificationOrder,
  type ReturnItem,
  type StatusChange,
  type StatusOS,
  type Task,
} from "./db";
import { listMunicipalities } from "./services/municipios";
import {
  listMunicipalityOrderCounts,
  listReturnCounts,
  listStatusCounts,
  listTaskQuantities,
} from "./services/dashboard";
import type { MunicipalityOrderCount } from "./services/dashboard";
import {
  addReturn as saveReturn,
  archiveOrder as archiveOrderInDatabase,
  changeOrderStatus,
  saveOrder as saveOrderInDatabase,
} from "./services/ordens-servico";
import {
  createDatabaseSnapshot,
  restoreDatabaseSnapshot,
} from "./services/database/backup";
import MunicipiosPage from "./pages/Municipios/MunicipiosPage";
import type { Municipality } from "./types/municipality";

type View =
  | "dashboard"
  | "ordens"
  | "quadro"
  | "tarefas"
  | "municipios"
  | "config";
const statuses: StatusOS[] = ["Em andamento", "Finalizado", "Retorno"];
const reasons = [
  "Escaneamento incorreto",
  "Reavaliar",
  "Falta de espaço Protético",
  "Falta arquivo",
  "Outros",
];

const localDateInput = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);
const today = () => localDateInput(new Date());
const fmtDate = (s: string) =>
  s ? new Date(s).toLocaleDateString("pt-BR") : "—";
const fmtReferenceDate = (s: string) => {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return dateOnly ? `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}` : fmtDate(s);
};
const fmtMonthLabel = (s: string) => {
  const [year, month] = s.split("-").map(Number);
  if (!year || !month) return "Mês atual";
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
};
const formatPeriodLabel = (date: string, mode: "day" | "month") =>
  mode === "day" ? fmtReferenceDate(date) : fmtMonthLabel(date);
const errorText = (e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  if (
    message.toLowerCase().includes("database is locked") ||
    message.toLowerCase().includes("database is busy")
  )
    return "O banco está ocupado por outra operação. Aguarde e tente novamente.";
  if (message.includes("FOREIGN KEY constraint failed"))
    return "Um dos registros selecionados não está mais disponível. Atualize os dados e tente novamente.";
  return message;
};

export default function App() {
  const now = new Date();
  const [view, setView] = useState<View>("dashboard");
  const [filterMode, setFilterMode] = useState<"day" | "month">("month");
  const [selectedDate, setSelectedDate] = useState(() =>
    localDateInput(startOfMonth(now)),
  );
  const [calendarDraft, setCalendarDraft] = useState(() =>
    localDateInput(startOfMonth(now)),
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [municipalityOrders, setMunicipalityOrders] = useState<
    MunicipalityOrderCount[]
  >([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [taskFilter, setTaskFilter] = useState(0);
  const [modal, setModal] = useState<"order" | "return" | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationOrder[]>([]);
  const [notificationCount, setNotificationCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const notificationDialogRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const [orderMode, setOrderMode] = useState<"view" | "edit">("view");
  const [showReturns, setShowReturns] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [movingOrders, setMovingOrders] = useState<number[]>([]);
  const movingOrdersRef = useRef(new Set<number>());
  const refreshIdRef = useRef(0);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("odontoflow.theme") === "dark" ? "dark" : "light",
  );
  const [editing, setEditing] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [returns, setReturns] = useState<ReturnItem[]>([]);
  const [alert, setAlert] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusHistory, setStatusHistory] = useState<StatusChange[]>([]);
  const [returnReason, setReturnReason] = useState(reasons[0]);
  const [justification, setJustification] = useState("");
  const [lastBackup, setLastBackup] = useState("");
  const [draft, setDraft] = useState({
    codigo_os: "",
    status: "Em andamento" as StatusOS,
    descricao: "",
    municipio_id: 0,
  });

  async function refresh() {
    const requestId = ++refreshIdRef.current;
    try {
      await db();
      const [o, t, m, municipalityCounts] = await Promise.all([
        view === "tarefas"
          ? listTaskOrders({
              date: selectedDate,
              mode: filterMode,
              status: statusFilter,
              task: taskFilter,
            })
          : listOrders({
              date: selectedDate,
              mode: filterMode,
              status: view === "quadro" ? "" : statusFilter,
              query: view === "quadro" ? "" : query,
              task: view === "quadro" ? 0 : taskFilter,
            }),
        listTasks(),
        listMunicipalities(),
        listMunicipalityOrderCounts(selectedDate, filterMode),
      ]);
      if (requestId !== refreshIdRef.current) return;
      setOrders(o);
      setTasks(t);
      setMunicipalities(m);
      setMunicipalityOrders(municipalityCounts);
      void listNotificationOrders()
        .then((rows) => {
          if (requestId === refreshIdRef.current)
            setNotificationCount(rows.length);
        })
        .catch((error) => {
          console.error("Falha ao atualizar a contagem de notificações", error);
          if (requestId === refreshIdRef.current) setNotificationCount(0);
        });
    } catch (e) {
      if (requestId === refreshIdRef.current)
        setAlert(`Não foi possível abrir o banco local: ${errorText(e)}`);
    } finally {
      if (requestId === refreshIdRef.current) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [selectedDate, filterMode, statusFilter, query, taskFilter, view]);
  useEffect(() => {
    if (alert) {
      const timer = setTimeout(() => setAlert(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [alert]);
  async function makeBackup(manual = false) {
    try {
      const contents = await createDatabaseSnapshot();
      if (manual) {
        const path = await save({
          title: "Salvar backup do OdontoFlow",
          defaultPath: `odontoflow-${today()}.json`,
          filters: [{ name: "Backup JSON", extensions: ["json"] }],
        });
        if (!path) return;
        await invoke("write_backup_to_path", { path, contents });
        setLastBackup(new Date().toLocaleString("pt-BR"));
        setAlert("Backup salvo com sucesso.");
      } else {
        await invoke<string>("create_backup", { contents });
        setLastBackup(new Date().toLocaleString("pt-BR"));
      }
    } catch (e) {
      setAlert(`Falha ao criar backup: ${errorText(e)}`);
    }
  }
  async function restoreBackup() {
    const path = await open({
      title: "Selecionar backup do OdontoFlow",
      multiple: false,
      filters: [{ name: "Backup JSON", extensions: ["json"] }],
    });
    if (!path || Array.isArray(path)) return;
    if (
      !(await confirm(
        "A restauração substituirá os dados atuais. Antes disso, o sistema criará uma cópia de segurança local. Deseja continuar?",
      ))
    )
      return;
    try {
      const raw = await invoke<string>("read_backup", { path });
      await restoreDatabaseSnapshot(raw);
      setLastBackup(new Date().toLocaleString("pt-BR"));
      setAlert("Backup restaurado.");
      void refresh();
    } catch (e) {
      setAlert(`Não foi possível restaurar: ${errorText(e)}`);
    }
  }
  async function selectDatabase() {
    try {
      setLoading(true);
      const path = await changeDatabase();
      if (path) {
        setAlert("Conexão com o banco atualizada.");
        await refresh();
      } else setLoading(false);
    } catch (e) {
      setAlert(`Não foi possível conectar ao banco: ${errorText(e)}`);
      setLoading(false);
    }
  }
  useEffect(() => {
    if (loading) return;
    void makeBackup();
    const timer = window.setInterval(() => void makeBackup(), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loading]);
  useEffect(() => {
    localStorage.setItem("odontoflow.theme", theme);
  }, [theme]);

  async function openNotifications() {
    setNotificationsOpen(true);
    setNotificationsLoading(true);
    setNotificationsError("");
    try {
      const current = await listNotificationOrders();
      setNotifications(current);
    } catch (error) {
      console.error("Falha ao consultar notificações", error);
      setNotifications([]);
      setNotificationsError(
        `Não foi possível atualizar as notificações: ${errorText(error)}`,
      );
    } finally {
      setNotificationsLoading(false);
    }
  }

  useEffect(() => {
    if (!notificationsOpen) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTimer = window.setTimeout(
      () => notificationDialogRef.current?.focus(),
      0,
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
      if (event.key === "Tab" && notificationDialogRef.current) {
        const controls = [
          ...notificationDialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        ];
        if (!controls.length) {
          event.preventDefault();
          return;
        }
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [notificationsOpen]);

  async function openNotifiedOrder(notification: NotificationOrder) {
    try {
      const current = await getOrderById(notification.id);
      if (!current) throw new Error("A OS não está mais disponível.");
      setNotificationsOpen(false);
      await beginOrder(current);
    } catch (error) {
      setNotificationsError(`Não foi possível abrir a OS: ${errorText(error)}`);
    }
  }

  function openMunicipalityOrders(municipality: string, status = "") {
    setQuery(municipality);
    setStatusFilter(status);
    setTaskFilter(0);
    setView("ordens");
  }

  async function beginOrder(order?: Order, mode: "view" | "edit" = "view") {
    setEditing(order ?? null);
    setOrderMode(order ? mode : "edit");
    setShowReturns(false);
    setDraft(
      order
        ? {
            codigo_os: order.codigo_os,
            status: order.status,
            descricao: order.descricao ?? "",
            municipio_id: order.municipio_id,
          }
        : {
            codigo_os: "",
            status: "Em andamento",
            descricao: "",
            municipio_id: municipalities[0]?.id ?? 0,
          },
    );
    try {
      if (order) {
        const [orderItems, orderReturns, history] = await Promise.all([
          getItems(order.id),
          getReturns(order.id),
          getStatusHistory(order.id),
        ]);
        setItems(orderItems);
        setReturns(orderReturns);
        setStatusHistory(history);
      } else {
        setItems([
          {
            tipo_tarefa_id: tasks[0]?.id ?? 0,
            nome: tasks[0]?.nome ?? "",
            quantidade: 1,
            data_referencia: today(),
          },
        ]);
        setReturns([]);
        setStatusHistory([]);
      }
      setModal("order");
    } catch (error) {
      setAlert(`Não foi possível abrir a OS: ${errorText(error)}`);
    }
  }
  function addItem() {
    setItems((current) => [
      ...current,
      {
        tipo_tarefa_id: tasks[0]?.id ?? 0,
        nome: tasks[0]?.nome ?? "",
        quantidade: 1,
        data_referencia: today(),
      },
    ]);
  }
  function changeItem(
    index: number,
    field: keyof Item,
    value: string | number,
  ) {
    setItems((current) =>
      current.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  }
  async function saveOrder(e: React.FormEvent) {
    e.preventDefault();
    if (orderMode === "view") return;
    if (savingRef.current) return;
    if (
      !draft.codigo_os.trim() ||
      !draft.municipio_id ||
      items.length === 0 ||
      items.some((x) => !x.tipo_tarefa_id || Number(x.quantidade) < 1)
    ) {
      setAlert(
        "Preencha o código, município e ao menos um lançamento com quantidade válida.",
      );
      return;
    }
    savingRef.current = true;
    setSaving(true);
    let committedOrderId: number | undefined;
    try {
      const savedId = await saveOrderInDatabase(editing, draft, items);
      committedOrderId = savedId;
      const [updated, updatedItems, updatedReturns, updatedHistory] =
        await Promise.all([
          getOrderById(savedId),
          getItems(savedId),
          getReturns(savedId),
          getStatusHistory(savedId),
        ]);
      if (!updated)
        throw new Error(
          "A gravação foi confirmada, mas a OS não apareceu na consulta seguinte.",
        );
      setEditing(updated);
      setItems(updatedItems);
      setReturns(updatedReturns);
      setStatusHistory(updatedHistory);
      setOrderMode("view");
      setShowReturns(false);
      setModal(null);
      setAlert("Ordem de serviço salva e conferida no SQLite.");
      await refresh();
    } catch (err) {
      console.error("Falha ao salvar ou confirmar OS", err);
      if (committedOrderId !== undefined) {
        const timestamp = new Date().toISOString();
        setEditing({
          ...(editing ?? {
            id: committedOrderId,
            criada_em: timestamp,
            arquivada_em: null,
            total_trabalhos: 0,
          }),
          id: committedOrderId,
          codigo_os: draft.codigo_os.trim(),
          status: draft.status,
          descricao: draft.descricao.trim() || null,
          municipio_id: draft.municipio_id,
          municipio:
            municipalities.find((row) => row.id === draft.municipio_id)?.nome ??
            editing?.municipio ??
            "",
          atualizada_em: timestamp,
          total_trabalhos: items.reduce(
            (sum, item) => sum + Number(item.quantidade),
            0,
          ),
          task_names: [...new Set(items.map((item) => item.nome))].join(", "),
        });
        setOrderMode("view");
        setModal("order");
        setAlert(
          "O SQLite confirmou a gravação, mas não foi possível recarregar os dados. Feche e abra a OS para conferir.",
        );
      } else {
        setAlert(
          `Não foi possível salvar as alterações da OS: ${errorText(err)}`,
        );
      }
      return;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function addReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (returnReason === "Outros" && !justification.trim()) {
      setAlert("Informe a justificativa do retorno.");
      return;
    }
    try {
      await saveReturn(editing.id, returnReason, justification);
      setReturns(await getReturns(editing.id));
      setJustification("");
      setModal("order");
      setAlert("Ocorrência adicionada ao histórico.");
      void refresh();
    } catch (e) {
      setAlert(errorText(e));
    }
  }
  async function archiveOrder(order: Order) {
    if (
      !(await confirm(
        `Arquivar a OS ${order.codigo_os}? O histórico será preservado.`,
      ))
    )
      return;
    try {
      await archiveOrderInDatabase(order);
      setModal(null);
      setAlert("OS arquivada.");
      void refresh();
    } catch (error) {
      setAlert(`Não foi possível arquivar a OS: ${errorText(error)}`);
    }
  }
  async function moveOrder(order: Order, status: StatusOS) {
    if (order.status === status || movingOrdersRef.current.has(order.id))
      return;
    movingOrdersRef.current.add(order.id);
    setMovingOrders((current) => [...current, order.id]);
    setOrders((current) =>
      current.map((row) =>
        row.id === order.id
          ? { ...row, status, atualizada_em: new Date().toISOString() }
          : row,
      ),
    );
    try {
      await changeOrderStatus(order, status);
      await refresh();
    } catch (error) {
      setOrders((current) =>
        current.map((row) =>
          row.id === order.id
            ? {
                ...row,
                status: order.status,
                atualizada_em: order.atualizada_em,
              }
            : row,
        ),
      );
      setAlert(
        `Não foi possível mover a OS ${order.codigo_os}: ${errorText(error)}`,
      );
    } finally {
      movingOrdersRef.current.delete(order.id);
      setMovingOrders((current) => current.filter((id) => id !== order.id));
    }
  }

  function cancelOrderEdit() {
    if (!editing) {
      setModal(null);
      return;
    }
    void beginOrder(editing, "view");
  }
  function printOrder() {
    document.body.classList.add("print-single");
    window.print();
    window.setTimeout(
      () => document.body.classList.remove("print-single"),
      1000,
    );
  }

  const [taskQuantities, setTaskQuantities] = useState<
    { name: string; value: number; id: number }[]
  >([]);
  useEffect(() => {
    (async () => {
      try {
        setTaskQuantities(await listTaskQuantities(selectedDate, filterMode));
      } catch (error) {
        setAlert(
          `Não foi possível atualizar os indicadores de produção: ${errorText(error)}`,
        );
      }
    })();
  }, [selectedDate, filterMode, orders]);
  const totalWork = taskQuantities.reduce((s, x) => s + x.value, 0);
  const [statusStats, setStatusStats] = useState<
    { name: StatusOS; value: number }[]
  >([]);
  useEffect(() => {
    (async () => {
      try {
        setStatusStats(await listStatusCounts(selectedDate, filterMode));
      } catch (error) {
        setAlert(
          `Não foi possível atualizar os indicadores de status: ${errorText(error)}`,
        );
      }
    })();
  }, [selectedDate, filterMode, orders]);
  const countByStatus = statuses.map((s) => ({
    name: s,
    value: statusStats.find((x) => x.name === s)?.value ?? 0,
  }));
  const [returnStats, setReturnStats] = useState<
    { name: string; value: number }[]
  >([]);
  useEffect(() => {
    (async () => {
      try {
        setReturnStats(await listReturnCounts(selectedDate, filterMode));
      } catch (error) {
        setAlert(
          `Não foi possível atualizar os indicadores de retornos: ${errorText(error)}`,
        );
      }
    })();
  }, [selectedDate, filterMode, orders]);
  const totalReturns = returnStats.reduce((a, b) => a + b.value, 0);
  const title = {
    dashboard: "Visão geral",
    ordens: "Ordens de serviço",
    quadro: "Acompanhamento",
    tarefas: "Produção por tarefa",
    municipios: "Municípios",
    config: "Configurações",
  }[view];
  const nav: [View, string, typeof LayoutDashboard][] = [
    ["dashboard", "Visão geral", LayoutDashboard],
    ["ordens", "Ordens de serviço", ClipboardList],
    ["quadro", "Acompanhamento", Activity],
    ["tarefas", "Produção por tarefa", ListChecks],
    ["municipios", "Municípios", MapPin],
    ["config", "Configurações", Settings2],
  ];

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-logo"
            src={theme === "dark" ? darkLogo : lightLogo}
            alt="OdontoFlow"
          />
        </div>
        <div className="nav-label">MENU PRINCIPAL</div>
        <nav>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`nav-item ${view === key ? "active" : ""}`}
              onClick={() => setView(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === "ordens" && (
                <span className="nav-count">{orders.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="online-dot" />
            <div>
              <b>Banco local ativo</b>
              <small>Dados neste computador</small>
            </div>
          </div>
          <div className="user-chip">
            <span className="avatar">GB</span>
            <span>
              <b>Gabriel Beckler</b>
              <small>Administrador local</small>
            </span>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <div className="breadcrumbs">
              OdontoFlow <span>/</span> {title}
            </div>
            <h1>{title}</h1>
          </div>
          <div className="top-actions">
            <button
              className="period-control"
              type="button"
              aria-label={`Selecionar período, atualmente ${formatPeriodLabel(selectedDate, filterMode)}`}
              onClick={() => {
                setCalendarDraft(selectedDate);
                setCalendarOpen(true);
              }}
            >
              <CalendarDays size={16} />
              <span>{formatPeriodLabel(selectedDate, filterMode)}</span>
            </button>
            {filterMode === "day" && (
              <button
                type="button"
                className="outline-button small"
                onClick={() => {
                  setFilterMode("month");
                  const monthStart = startOfMonth(new Date(selectedDate));
                  setSelectedDate(localDateInput(monthStart));
                  setCalendarDraft(localDateInput(monthStart));
                }}
              >
                Ver mês
              </button>
            )}
            <button
              ref={notificationButtonRef}
              className="icon-button"
              title="Notificações"
              aria-label={`Abrir notificações${notificationCount ? `, ${notificationCount} OS` : ""}`}
              aria-haspopup="dialog"
              onClick={() => void openNotifications()}
            >
              <Bell size={18} />
              {notificationCount > 0 && (
                <i aria-label={`${notificationCount} notificações`} />
              )}
            </button>
            <button
              className="primary-button"
              onClick={() => void beginOrder()}
            >
              <Plus size={17} /> Nova OS
            </button>
          </div>
        </header>
        {alert && (
          <div className="toast">
            <span>{alert}</span>
            <button onClick={() => setAlert("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="loading">Preparando seu espaço de trabalho…</div>
        ) : (
          <>
            {view === "dashboard" && (
              <DashboardPage
                orders={orders}
                totalWork={totalWork}
                countByStatus={countByStatus}
                totalReturns={totalReturns}
                municipalityOrders={municipalityOrders}
                selectedDate={selectedDate}
                filterMode={filterMode}
                taskQuantities={taskQuantities}
                returnStats={returnStats}
                setView={setView}
                setTaskFilter={setTaskFilter}
                openMunicipalityOrders={openMunicipalityOrders}
                beginOrder={beginOrder}
              />
            )}
            {view === "ordens" && (
              <OrdensPage
                orders={orders}
                tasks={tasks}
                selectedDate={selectedDate}
                filterMode={filterMode}
                query={query}
                setQuery={setQuery}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                taskFilter={taskFilter}
                setTaskFilter={setTaskFilter}
                beginOrder={beginOrder}
                archiveOrder={archiveOrder}
              />
            )}
            {view === "quadro" && (
              <div className="content">
                <div className="kanban">
                  {statuses.map((s) => (
                    <section
                      className="kanban-column"
                      key={s}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const id = Number(
                          event.dataTransfer.getData("text/plain"),
                        );
                        const order = orders.find(
                          (candidate) => candidate.id === id,
                        );
                        if (order) void moveOrder(order, s);
                      }}
                    >
                      <div className="kanban-title">
                        <span className={`status-dot ${slug(s)}`} />
                        <b>{s}</b>
                        <small>
                          {orders.filter((o) => o.status === s).length}
                        </small>
                        <button
                          onClick={() => {
                            setStatusFilter(s);
                            setView("ordens");
                          }}
                        >
                          •••
                        </button>
                      </div>
                      {orders
                        .filter((o) => o.status === s)
                        .map((o) => (
                          <button
                            className={`os-card ${movingOrders.includes(o.id) ? "moving" : ""}`}
                            key={o.id}
                            draggable={!movingOrders.includes(o.id)}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                "text/plain",
                                String(o.id),
                              );
                            }}
                            onClick={() => void beginOrder(o)}
                          >
                            <div className="card-code">
                              {o.codigo_os}
                              <span className={`status-pill ${slug(o.status)}`}>
                                {o.status}
                              </span>
                            </div>
                            <p>{o.municipio}</p>
                            <div className="card-bottom">
                              <span>{o.total_trabalhos} trabalhos</span>
                              <small>
                                Atualizada {fmtDate(o.atualizada_em)}
                              </small>
                            </div>
                          </button>
                        ))}
                    </section>
                  ))}
                </div>
              </div>
            )}
            {view === "tarefas" && (
              <div className="content">
                <div className="list-toolbar">
                  <select
                    className="filter-select wide"
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
                  <div className="summary-chip">
                    {taskQuantities
                      .filter((t) => !taskFilter || taskFilter === t.id)
                      .reduce((a, t) => a + t.value, 0)}{" "}
                    trabalhos na data selecionada
                  </div>
                </div>
                <section className="panel table-panel">
                  <div className="panel-head">
                    <div>
                      <h3>Detalhamento de produção</h3>
                      <p>
                        As quantidades consideram a data de referência de cada
                        lançamento.
                      </p>
                    </div>
                    <button
                      className="outline-button"
                      onClick={() => window.print()}
                    >
                      <ArrowDownToLine size={15} /> Exportar / PDF
                    </button>
                  </div>
                  <OrderTable rows={orders} open={(o) => void beginOrder(o)} />
                </section>
              </div>
            )}
            {view === "config" && (
              <div className="content">
                <section className="panel settings-panel">
                  <div className="panel-head">
                    <div>
                      <h3>Dados e armazenamento</h3>
                      <p>
                        O aplicativo usa o mesmo arquivo SQLite configurado no
                        DBeaver.
                      </p>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="setting-icon">
                      <ClipboardList size={18} />
                    </div>
                    <div>
                      <b>Banco SQLite conectado</b>
                      <p className="db-path">
                        {currentDatabasePath() || "Nenhum arquivo selecionado"}
                      </p>
                    </div>
                    <button
                      className="outline-button"
                      onClick={() => void selectDatabase()}
                    >
                      Selecionar banco
                    </button>
                  </div>
                  <div className="settings-row">
                    <div className="setting-icon">
                      <Archive size={18} />
                    </div>
                    <div>
                      <b>Backup e restauração</b>
                      <p>
                        {lastBackup
                          ? `Último backup: ${lastBackup}`
                          : "Backup automático local a cada hora enquanto o aplicativo estiver aberto."}
                      </p>
                    </div>
                    <button
                      className="outline-button"
                      onClick={() => void makeBackup(true)}
                    >
                      <ArrowDownToLine size={14} /> Fazer backup
                    </button>
                    <button
                      className="outline-button"
                      onClick={() => void restoreBackup()}
                    >
                      Restaurar
                    </button>
                  </div>
                  <TaskSettings onChanged={refresh} />
                  <div className="settings-row">
                    <div className="setting-icon">
                      <Stethoscope size={18} />
                    </div>
                    <div>
                      <b>Municípios</b>
                      <p>
                        {municipalities.length} localidades disponíveis no
                        cadastro.
                      </p>
                    </div>
                    <button
                      className="outline-button"
                      onClick={() => setView("municipios")}
                    >
                      Gerenciar municípios
                    </button>
                  </div>
                  <div className="settings-row">
                    <div className="setting-icon">
                      <CalendarDays size={18} />
                    </div>
                    <div>
                      <b>Idioma</b>
                      <p>Português brasileiro</p>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="setting-icon">
                      {theme === "dark" ? (
                        <Moon size={18} />
                      ) : (
                        <Sun size={18} />
                      )}
                    </div>
                    <div>
                      <b>Tema do aplicativo</b>
                      <p>Preferência salva neste perfil do aplicativo.</p>
                    </div>
                    <button
                      className="outline-button"
                      aria-pressed={theme === "dark"}
                      onClick={() =>
                        setTheme((current) =>
                          current === "dark" ? "light" : "dark",
                        )
                      }
                    >
                      {theme === "dark"
                        ? "Usar tema claro"
                        : "Usar tema escuro"}
                    </button>
                  </div>
                </section>
              </div>
            )}
            {view === "municipios" && (
              <MunicipiosPage onMunicipalitiesChanged={refresh} />
            )}
          </>
        )}
      </main>
      {calendarOpen && (
        <div
          className="modal-backdrop calendar-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCalendarOpen(false);
          }}
        >
          <form
            className="modal calendar-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-title"
            onSubmit={(event) => {
              event.preventDefault();
              if (!calendarDraft) return;
              setSelectedDate(calendarDraft);
              setFilterMode("day");
              setCalendarOpen(false);
            }}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">FILTRO DO PAINEL</span>
                <h2 id="calendar-title">Selecionar data</h2>
                <p>Os indicadores e as listas serão filtrados por este dia.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Fechar calendário"
                onClick={() => setCalendarOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body calendar-body">
              <label htmlFor="dashboard-date">Dia</label>
              <input
                id="dashboard-date"
                type="date"
                required
                autoFocus
                value={calendarDraft}
                onChange={(event) => setCalendarDraft(event.target.value)}
              />
            </div>
            <div className="modal-footer">
              <span />
              <button
                className="outline-button"
                type="button"
                onClick={() => setCalendarOpen(false)}
              >
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                Aplicar data
              </button>
            </div>
          </form>
        </div>
      )}
      {modal === "order" && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (!saving && e.target === e.currentTarget) setModal(null);
          }}
        >
          <form
            className="modal order-modal"
            onSubmit={saveOrder}
            aria-busy={saving}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">
                  {!editing
                    ? "NOVO REGISTRO"
                    : orderMode === "view"
                      ? "VISUALIZAÇÃO"
                      : "EDIÇÃO"}
                </span>
                <h2>
                  {editing ? editing.codigo_os : "Cadastrar ordem de serviço"}
                </h2>
                <p>
                  {editing
                    ? `Criada em ${fmtDate(editing.criada_em)} · Atualizada em ${fmtDate(editing.atualizada_em)}`
                    : "Cadastre os dados e lançamentos de trabalho."}
                </p>
              </div>
            </div>
            <div className="modal-body">
              {orderMode === "view" && editing ? (
                <div className="order-readonly">
                  <div className="order-readonly-grid">
                    <div>
                      <small>CÓDIGO</small>
                      <b>{editing.codigo_os}</b>
                    </div>
                    <div>
                      <small>STATUS</small>
                      <span className={`status-pill ${slug(draft.status)}`}>
                        {draft.status}
                      </span>
                    </div>
                    <div>
                      <small>MUNICÍPIO</small>
                      <b>{editing.municipio}</b>
                    </div>
                    <div>
                      <small>CRIADA EM</small>
                      <b>{fmtDate(editing.criada_em)}</b>
                    </div>
                    <div className="readonly-description">
                      <small>DESCRIÇÃO</small>
                      <p>{editing.descricao || "Sem observações."}</p>
                    </div>
                  </div>
                  <div className="section-divider">
                    <h3>Lançamentos de trabalho</h3>
                  </div>
                  {items.map((item, index) => (
                    <div className="readonly-item" key={item.id ?? index}>
                      <b>{item.nome}</b>
                      <span>{item.quantidade} trabalhos</span>
                      <small>{fmtDate(item.data_referencia)}</small>
                    </div>
                  ))}
                  {draft.status === "Retorno" && (
                    <div className="section-divider return-heading">
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setShowReturns((shown) => !shown)}
                      >
                        {showReturns
                          ? "Ocultar histórico de retornos"
                          : `Ver histórico de retornos (${returns.length})`}
                      </button>
                    </div>
                  )}
                  {showReturns && draft.status === "Retorno" && (
                    <ReturnHistory rows={returns} />
                  )}
                  <div className="section-divider">
                    <h3>Histórico de status</h3>
                  </div>
                  {statusHistory.length === 0 ? (
                    <p className="empty-history">
                      Nenhuma alteração de status registrada.
                    </p>
                  ) : (
                    <div className="history-list">
                      {statusHistory.map((history) => (
                        <div className="history-item" key={history.id}>
                          <span className="status-dot" />
                          <div>
                            <b>
                              {history.de_status ?? "Cadastro"} →{" "}
                              {history.para_status}
                            </b>
                            <small>
                              {new Date(history.alterado_em).toLocaleString(
                                "pt-BR",
                              )}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="form-grid">
                    <label>
                      Código da OS *
                      <input
                        autoFocus
                        value={draft.codigo_os}
                        onChange={(e) =>
                          setDraft({ ...draft, codigo_os: e.target.value })
                        }
                        placeholder="Ex.: OS-2026-001"
                        required
                      />
                    </label>
                    <label>
                      Status *
                      <select
                        value={draft.status}
                        onChange={(e) => {
                          setDraft({
                            ...draft,
                            status: e.target.value as StatusOS,
                          });
                          setShowReturns(false);
                        }}
                      >
                        {statuses.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Município *
                      <select
                        value={draft.municipio_id}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            municipio_id: Number(e.target.value),
                          })
                        }
                        required
                      >
                        {municipalities.map((m) => (
                          <option value={m.id} key={m.id}>
                            {m.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="span-2">
                      Descrição / observações
                      <textarea
                        value={draft.descricao}
                        onChange={(e) =>
                          setDraft({ ...draft, descricao: e.target.value })
                        }
                        rows={2}
                        placeholder="Informações complementares (opcional)"
                      />
                    </label>
                  </div>
                  <div className="section-divider">
                    <h3>Lançamentos de trabalho</h3>
                    <button
                      className="text-button"
                      type="button"
                      onClick={addItem}
                    >
                      <Plus size={15} /> Adicionar tarefa
                    </button>
                  </div>
                  <div className="items-head">
                    <span>TIPO DE TAREFA</span>
                    <span>QUANTIDADE</span>
                    <span>DATA DE REFERÊNCIA</span>
                    <span />
                  </div>
                  {items.map((it, i) => (
                    <div className="item-edit-row" key={it.id ?? `new${i}`}>
                      <select
                        value={it.tipo_tarefa_id}
                        onChange={(e) => {
                          const task = tasks.find(
                            (t) => t.id === Number(e.target.value),
                          );
                          changeItem(
                            i,
                            "tipo_tarefa_id",
                            Number(e.target.value),
                          );
                          changeItem(i, "nome", task?.nome ?? "");
                        }}
                      >
                        {[
                          ...tasks,
                          ...items
                            .filter(
                              (entry) =>
                                entry.tipo_tarefa_id === it.tipo_tarefa_id &&
                                !tasks.some(
                                  (task) => task.id === entry.tipo_tarefa_id,
                                ),
                            )
                            .map((entry) => ({
                              id: entry.tipo_tarefa_id,
                              nome: `${entry.nome} (inativo)`,
                              ativo: 0,
                            })),
                        ].map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.nome}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={it.quantidade}
                        onChange={(e) =>
                          changeItem(i, "quantidade", Number(e.target.value))
                        }
                      />
                      <input
                        type="date"
                        value={it.data_referencia}
                        onChange={(e) =>
                          changeItem(i, "data_referencia", e.target.value)
                        }
                      />
                      <button
                        className="icon-button danger"
                        type="button"
                        disabled={items.length === 1}
                        onClick={() =>
                          setItems(items.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <div className="total-line">
                    Total de trabalhos nesta OS{" "}
                    <b>
                      {items.reduce((s, x) => s + Number(x.quantidade || 0), 0)}
                    </b>
                  </div>
                  {editing && draft.status === "Retorno" && (
                    <>
                      <div className="section-divider return-heading">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => setShowReturns((shown) => !shown)}
                        >
                          {showReturns
                            ? "Ocultar histórico de retornos"
                            : `Ver histórico de retornos (${returns.length})`}
                        </button>
                        <button
                          className="outline-button small"
                          type="button"
                          onClick={() => setModal("return")}
                        >
                          <Plus size={14} /> Registrar retorno
                        </button>
                      </div>
                      {showReturns && <ReturnHistory rows={returns} />}
                    </>
                  )}
                  {editing && (
                    <>
                      <div className="section-divider">
                        <h3>Histórico de status</h3>
                      </div>
                      {statusHistory.length === 0 ? (
                        <p className="empty-history">
                          Nenhuma alteração de status registrada.
                        </p>
                      ) : (
                        <div className="history-list">
                          {statusHistory.map((history) => (
                            <div className="history-item" key={history.id}>
                              <span className="status-dot" />
                              <div>
                                <b>
                                  {history.de_status ?? "Cadastro"} →{" "}
                                  {history.para_status}
                                </b>
                                <small>
                                  {new Date(history.alterado_em).toLocaleString(
                                    "pt-BR",
                                  )}
                                </small>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
              {orderMode === "view" && editing ? (
                <>
                  <button
                    type="button"
                    className="outline-button"
                    onClick={printOrder}
                  >
                    <ArrowDownToLine size={14} /> Exportar
                  </button>
                  <span />
                  <button
                    type="button"
                    className="outline-button"
                    onClick={() => setModal(null)}
                  >
                    Sair
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setOrderMode("edit")}
                  >
                    Editar
                  </button>
                </>
              ) : (
                <>
                  {editing && (
                    <button
                      type="button"
                      className="danger-link"
                      onClick={() => void archiveOrder(editing)}
                      disabled={saving}
                    >
                      <Archive size={15} /> Arquivar OS
                    </button>
                  )}
                  <span />
                  <button
                    type="button"
                    className="outline-button"
                    onClick={cancelOrderEdit}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving}
                  >
                    {saving ? "Salvando…" : "Salvar alterações"}
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      )}
      {modal === "return" && (
        <div className="modal-backdrop">
          <form className="modal return-modal" onSubmit={addReturn}>
            <div className="modal-head">
              <div>
                <span className="eyebrow">
                  HISTÓRICO DA OS {editing?.codigo_os}
                </span>
                <h2>Registrar retorno</h2>
                <p>
                  A ocorrência será adicionada ao histórico sem apagar as
                  anteriores.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModal("order")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <label>
                Motivo do retorno *
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                >
                  {reasons.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              {returnReason === "Outros" && (
                <label className="justification">
                  Justificativa *
                  <textarea
                    required
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    rows={3}
                  />
                </label>
              )}
            </div>
            <div className="modal-footer">
              <span />
              <button
                className="outline-button"
                type="button"
                onClick={() => setModal("order")}
              >
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                Registrar retorno
              </button>
            </div>
          </form>
        </div>
      )}
      {notificationsOpen && (
        <div
          className="modal-backdrop notification-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setNotificationsOpen(false);
          }}
        >
          <section
            className="modal notification-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notifications-title"
            aria-describedby="notifications-description"
            tabIndex={-1}
            ref={notificationDialogRef}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">ACOMPANHAMENTO</span>
                <h2 id="notifications-title">Notificações</h2>
                <p id="notifications-description">
                  Ordens em andamento e retornos que precisam de atenção.
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Fechar notificações"
                onClick={() => setNotificationsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body notification-body">
              {notificationsLoading ? (
                <p role="status">Atualizando notificações…</p>
              ) : notificationsError ? (
                <div className="notification-error" role="alert">
                  {notificationsError}
                  <button
                    className="outline-button small"
                    onClick={() => void openNotifications()}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <p className="notification-empty">
                  Não há OS em andamento ou retorno no momento.
                </p>
              ) : (
                (["Retorno", "Em andamento"] as const).map((status) => {
                  const rows = notifications.filter(
                    (row) => row.status === status,
                  );
                  if (!rows.length) return null;
                  return (
                    <section className="notification-section" key={status}>
                      <h3>
                        {status}
                        <span>{rows.length}</span>
                      </h3>
                      {rows.map((row) => (
                        <button
                          className="notification-row"
                          key={row.id}
                          onClick={() => void openNotifiedOrder(row)}
                        >
                          <span
                            className={`notification-status ${status === "Retorno" ? "return" : "progress"}`}
                          >
                            {status}
                          </span>
                          <b>{row.codigo_os}</b>
                          <span>{row.municipio}</span>
                          <small>
                            {row.prioridade_data
                              ? `Retorno registrado em ${fmtDate(row.prioridade_data)}`
                              : row.data_referencia
                                ? `Referência ${fmtReferenceDate(row.data_referencia)}`
                                : "Sem data de referência"}
                          </small>
                          <ChevronDown
                            size={15}
                            className="notification-chevron"
                          />
                        </button>
                      ))}
                    </section>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ReturnHistory({ rows }: { rows: ReturnItem[] }) {
  return rows.length === 0 ? (
    <p className="empty-history">Nenhuma ocorrência registrada.</p>
  ) : (
    <div className="history-list">
      {rows.map((item) => (
        <div className="history-item" key={item.id}>
          <span className="return-dot" />
          <div>
            <b>{item.motivo}</b>
            {item.justificativa && <p>{item.justificativa}</p>}
            <small>
              {new Date(item.registrado_em).toLocaleString("pt-BR")}
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/ /g, "-").replace("ã", "a");
}
