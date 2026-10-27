import { useEffect, useRef, useState } from "react";
import type { Task } from "../db";
import { createTask, listAllTasks, setTaskActive, taskErrorMessage } from "../services/tipos-tarefa";

export default function TaskSettings({ onChanged }: { onChanged: () => Promise<void> }) {
  const [rows, setRows] = useState<Task[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const busy = useRef(new Set<number>());
  const [busyIds, setBusyIds] = useState<number[]>([]);

  async function reload() {
    setLoading(true);
    try {
      setRows(await listAllTasks());
    } catch (cause) {
      console.error("Falha ao carregar tipos de serviço", cause);
      setError(
        `Não foi possível carregar os serviços: ${taskErrorMessage(cause)}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await createTask(name);
      setName("");
      await Promise.all([reload(), onChanged()]);
    } catch (cause) {
      console.error("Falha ao cadastrar tipo de serviço", cause);
      setError(
        `Não foi possível cadastrar o serviço: ${taskErrorMessage(cause)}`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggle(row: Task) {
    if (busy.current.has(row.id)) return;
    busy.current.add(row.id);
    setBusyIds((current) => [...current, row.id]);
    setError("");
    try {
      await setTaskActive(row.id, row.ativo !== 1);
      await Promise.all([reload(), onChanged()]);
    } catch (cause) {
      console.error("Falha ao alterar situação do serviço", cause);
      setError(
        `Não foi possível alterar o serviço: ${taskErrorMessage(cause)}`,
      );
    } finally {
      busy.current.delete(row.id);
      setBusyIds((current) => current.filter((id) => id !== row.id));
    }
  }

  return (
    <section className="panel task-settings">
      <div className="panel-head">
        <div>
          <h3>Tipos de serviço</h3>
          <p>
            Os serviços cadastrados ficam disponíveis nos lançamentos de OS.
          </p>
        </div>
      </div>
      <form
        className="task-settings-form"
        onSubmit={(event) => void submit(event)}
      >
        <label>
          Nome do serviço *
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            required
            placeholder="Ex.: Planejamento digital"
          />
        </label>
        <button type="submit" className="primary-button" disabled={saving}>
          {saving ? "Salvando…" : "Cadastrar serviço"}
        </button>
      </form>
      {error && (
        <p className="task-settings-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="loading">Carregando serviços…</p>
      ) : (
        <div className="task-settings-list">
          {rows.map((row) => (
            <div className="task-settings-row" key={row.id}>
              <span>{row.nome}</span>
              <small>{row.ativo ? "Ativo" : "Inativo"}</small>
              <button
                type="button"
                className="text-button"
                disabled={busyIds.includes(row.id)}
                onClick={() => void toggle(row)}
              >
                {busyIds.includes(row.id)
                  ? "Salvando…"
                  : row.ativo
                    ? "Desativar"
                    : "Reativar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

