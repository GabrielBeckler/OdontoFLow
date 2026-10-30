import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { MapPin, Plus, RotateCcw, X } from "lucide-react";
import {
  listAllMunicipalities,
  municipalityErrorMessage,
  saveMunicipality,
  setMunicipalityActive,
} from "../../services/municipios";
import type { Municipality } from "../../types/municipality";

type Props = { onMunicipalitiesChanged: () => Promise<void> };

export default function MunicipiosPage({ onMunicipalitiesChanged }: Props) {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const busyIdsRef = useRef(new Set<number>());
  const [busyIds, setBusyIds] = useState<number[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMunicipalities(await listAllMunicipalities());
      setError("");
    } catch (cause) {
      setError(
        `Não foi possível carregar municípios: ${municipalityErrorMessage(cause)}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await saveMunicipality({ codigo, nome });
      setCodigo("");
      setNome("");
      await Promise.all([refresh(), onMunicipalitiesChanged()]);
    } catch (cause) {
      setError(municipalityErrorMessage(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function toggleActive(municipality: Municipality) {
    if (busyIdsRef.current.has(municipality.id)) return;
    busyIdsRef.current.add(municipality.id);
    setBusyIds((current) => [...current, municipality.id]);
    setError("");
    try {
      await setMunicipalityActive(municipality.id, municipality.ativo !== 1);
      await Promise.all([refresh(), onMunicipalitiesChanged()]);
    } catch (cause) {
      setError(municipalityErrorMessage(cause));
    } finally {
      busyIdsRef.current.delete(municipality.id);
      setBusyIds((current) => current.filter((id) => id !== municipality.id));
    }
  }

  return (
    <div className="content municipalities-page">
      <section className="panel municipality-form-panel">
        <div className="panel-head">
          <div>
            <h3>Cadastrar município</h3>
            <p>
              O cadastro fica salvo no banco SQLite conectado ao aplicativo.
            </p>
          </div>
        </div>
        <form
          className="municipality-form"
          onSubmit={(event) => void submit(event)}
        >
          <label>
            Código *
            <input
              value={codigo}
              onChange={(event) => setCodigo(event.target.value)}
              maxLength={30}
              required
              placeholder="Ex.: ANAJ"
            />
          </label>
          <label>
            Nome do município *
            <input
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              maxLength={120}
              required
              placeholder="Ex.: Anajatuba"
            />
          </label>
          <button className="primary-button" type="submit" disabled={saving}>
            <Plus size={16} /> {saving ? "Salvando…" : "Cadastrar município"}
          </button>
        </form>
        {error && (
          <div className="municipality-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              aria-label="Fechar mensagem"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </section>

      <section className="panel municipality-list-panel">
        <div className="panel-head">
          <div>
            <h3>Municípios cadastrados</h3>
            <p>
              {municipalities.filter((item) => item.ativo === 1).length} ativos
              · {municipalities.length} no total
            </p>
          </div>
        </div>
        {loading ? (
          <div className="loading">Carregando municípios…</div>
        ) : municipalities.length === 0 ? (
          <div className="municipality-empty">
            <MapPin size={20} /> Nenhum município cadastrado.
          </div>
        ) : (
          <div className="municipality-table-wrap">
            <table className="municipality-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Município</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {municipalities.map((municipality) => (
                  <tr key={municipality.id}>
                    <td>{municipality.codigo}</td>
                    <td>{municipality.nome}</td>
                    <td>
                      <span
                        className={`municipality-state ${municipality.ativo === 1 ? "active" : "inactive"}`}
                      >
                        {municipality.ativo === 1 ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="municipality-actions">
                      <button
                        type="button"
                        className="text-button"
                        disabled={busyIds.includes(municipality.id)}
                        onClick={() => void toggleActive(municipality)}
                      >
                        {busyIds.includes(municipality.id) ? (
                          "Salvando…"
                        ) : municipality.ativo === 1 ? (
                          <>
                            <X size={14} /> Desativar
                          </>
                        ) : (
                          <>
                            <RotateCcw size={14} /> Reativar
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
