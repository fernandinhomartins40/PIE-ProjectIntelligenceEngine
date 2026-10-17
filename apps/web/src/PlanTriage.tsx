import { useEffect, useState } from "react";
import {
  api,
  type PlanContestations,
  type PlanTriageHistory,
  type UnifiedPlan,
} from "./api.js";
import { date, message, Notice, Pager } from "./components.js";

const LIMIT = 20;
const statuses = [
  ["open", "Aberto"],
  ["accepted", "Aceito"],
  ["rejected", "Rejeitado"],
  ["in_progress", "Em andamento"],
  ["completed", "Concluído (triagem)"],
] as const;
const statusLabel = (value: string): string =>
  statuses.find(([key]) => key === value)?.[1] ?? value;

function PlanHistory({
  snapshotId,
  planDigest,
  itemId,
}: {
  snapshotId: string;
  planDigest: string;
  itemId: string;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<PlanTriageHistory>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      snapshotId,
      planDigest,
      itemId,
      limit: String(LIMIT),
      offset: String(offset),
    });
    setHistory(undefined);
    setError("");
    void api<PlanTriageHistory>(`plan/triage-history?${query}`, {
      signal: controller.signal,
    })
      .then(setHistory)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [itemId, offset, open, planDigest, snapshotId]);
  return (
    <div className="plan-history">
      <button
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setOffset(0);
        }}
      >
        {open ? "Ocultar histórico" : "Ver histórico"}
      </button>
      {error && <Notice error>{error}</Notice>}
      {open && history && (
        <>
          {!history.items.total && <Notice>Sem alterações registradas.</Notice>}
          <ol className="plan-events">
            {history.items.items.map((event) => (
              <li key={event.id}>
                <strong>
                  Revisão {event.revision} · {date(event.createdAt)}
                </strong>
                <p>
                  {statusLabel(event.previousStatus)} →{" "}
                  {statusLabel(event.status)}
                  {event.owner !== event.previousOwner &&
                    ` · responsável: ${event.previousOwner ?? "não atribuído"} → ${event.owner ?? "não atribuído"}`}
                </p>
                {event.schemaVersion === 2 && event.priority && (
                  <p>
                    Impacto {event.priority.impact}, risco {event.priority.risk}
                    , esforço {event.priority.effort};{" "}
                    {event.priority.evidenceIds.length} Evidence vinculadas.
                  </p>
                )}
                <p>{event.justification}</p>
                <small>Hash do evento: {event.eventHash}</small>
              </li>
            ))}
          </ol>
          <Pager
            offset={offset}
            total={history.items.total}
            limit={LIMIT}
            onChange={setOffset}
          />
        </>
      )}
      {open && !history && !error && <Notice>Carregando histórico…</Notice>}
    </div>
  );
}

function PlanItem({
  item,
  position,
  plan,
  snapshotId,
  onEvidence,
  onSaved,
  onContested,
}: {
  item: UnifiedPlan["items"]["items"][number];
  position: number;
  plan: UnifiedPlan;
  snapshotId: string;
  onEvidence: (id: string) => void;
  onSaved: () => void;
  onContested: () => void;
}) {
  const [owner, setOwner] = useState(item.owner ?? "");
  const [status, setStatus] = useState(item.status);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const itemKey = encodeURIComponent(item.id);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("plan/triage", {
        method: "POST",
        body: {
          id: crypto.randomUUID(),
          snapshotId,
          planDigest: plan.planDigest,
          itemId: item.id,
          expectedRevision: item.triageRevision ?? 0,
          owner: owner.trim() || null,
          status,
          justification,
        },
      });
      setJustification("");
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="plan-item" aria-labelledby={`plan-title-${itemKey}`}>
      <header className="plan-item-heading">
        <div>
          <p className="eyebrow">
            {item.engine} · {item.sourceState}
          </p>
          <h3 id={`plan-title-${itemKey}`}>{item.title}</h3>
        </div>
        <span className="badge">{statusLabel(item.status)}</span>
      </header>
      <p>
        {item.priorityAssessment
          ? `Prioridade manual ${position} · impacto ${item.priorityAssessment.impact}, risco ${item.priorityAssessment.risk}, esforço ${item.priorityAssessment.effort}.`
          : "Prioridade não avaliada."}{" "}
        Estado técnico: não verificado. Revisão de triagem{" "}
        {item.triageRevision ?? 0}.
      </p>
      <h4>Critérios de aceitação propostos</h4>
      <ul>
        {item.acceptance.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
      {!!item.uncertainty.length && (
        <details>
          <summary>Limitações e incertezas</summary>
          <ul>
            {item.uncertainty.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="row-actions" aria-label="Evidências relacionadas">
        {item.evidenceIds.map((id) => (
          <button key={id} onClick={() => onEvidence(id)}>
            Ver evidência {id.slice(0, 8)}
          </button>
        ))}
      </div>
      <PlanContestForm
        item={item}
        plan={plan}
        snapshotId={snapshotId}
        onContested={onContested}
      />
      <PlanPriorityForm
        key={`${plan.planDigest}:${item.id}:${item.triageRevision ?? 0}`}
        item={item}
        plan={plan}
        snapshotId={snapshotId}
        onSaved={onSaved}
      />
      <form className="plan-triage-form" onSubmit={(event) => void save(event)}>
        <div>
          <label htmlFor={`owner-${itemKey}`}>Responsável (opcional)</label>
          <input
            id={`owner-${itemKey}`}
            value={owner}
            maxLength={160}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="Nome ou equipe"
          />
        </div>
        <div>
          <label htmlFor={`status-${itemKey}`}>Estado de triagem</label>
          <select
            id={`status-${itemKey}`}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="plan-justification">
          <label htmlFor={`justification-${itemKey}`}>
            Justificativa da alteração
          </label>
          <textarea
            id={`justification-${itemKey}`}
            value={justification}
            minLength={10}
            maxLength={4_000}
            required
            onChange={(event) => setJustification(event.target.value)}
          />
        </div>
        {error && (
          <>
            <Notice error>{error}</Notice>
            <button type="button" onClick={onSaved}>
              Recarregar estado atual
            </button>
          </>
        )}
        <button
          className="primary"
          disabled={busy || justification.trim().length < 10}
        >
          {busy ? "Registrando…" : "Registrar alteração"}
        </button>
      </form>
      {item.triageRevision ? (
        <PlanHistory
          key={`${snapshotId}:${plan.planDigest}:${item.id}:${item.triageRevision}`}
          snapshotId={snapshotId}
          planDigest={plan.planDigest}
          itemId={item.id}
        />
      ) : (
        <p>Sem alterações de triagem registradas.</p>
      )}
    </article>
  );
}

function PlanPriorityForm({
  item,
  plan,
  snapshotId,
  onSaved,
}: {
  item: UnifiedPlan["items"]["items"][number];
  plan: UnifiedPlan;
  snapshotId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState(
    String(item.priorityAssessment?.impact ?? ""),
  );
  const [risk, setRisk] = useState(String(item.priorityAssessment?.risk ?? ""));
  const [effort, setEffort] = useState(
    String(item.priorityAssessment?.effort ?? ""),
  );
  const [evidenceIds, setEvidenceIds] = useState(
    item.priorityAssessment?.evidenceIds ?? [],
  );
  const [clear, setClear] = useState(false);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ratings = [impact, risk, effort];
  const partialRating = ratings.some(Boolean) && !ratings.every(Boolean);
  const invalid =
    partialRating ||
    (ratings.every(Boolean) && evidenceIds.length === 0) ||
    evidenceIds.length > 10;
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("plan/triage", {
        method: "POST",
        body: {
          id: crypto.randomUUID(),
          snapshotId,
          planDigest: plan.planDigest,
          itemId: item.id,
          expectedRevision: item.triageRevision ?? 0,
          ...(clear
            ? { priority: null }
            : ratings.every(Boolean)
              ? {
                  priority: {
                    impact: Number(impact),
                    risk: Number(risk),
                    effort: Number(effort),
                    evidenceIds,
                  },
                }
              : {}),
          justification,
        },
      });
      setJustification("");
      setClear(false);
      setOpen(false);
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="plan-priority">
      <button aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open
          ? "Fechar priorização"
          : item.priorityAssessment
            ? "Reavaliar prioridade"
            : "Avaliar prioridade"}
      </button>
      {open && (
        <form
          className="plan-triage-form"
          onSubmit={(event) => void save(event)}
        >
          <p className="plan-priority-rule">
            Notas humanas com Evidence. Ordenação: impacto decrescente, risco
            decrescente, esforço crescente; empates pelo ID estável. Itens sem
            avaliação ficam após os avaliados. A escala não afirma probabilidade
            nem comprovação técnica.
          </p>
          {(["impacto", "risco", "esforço"] as const).map((label, index) => {
            const values = [impact, risk, effort];
            const setters = [setImpact, setRisk, setEffort];
            const id = `priority-${index}-${encodeURIComponent(item.id)}`;
            return (
              <div key={id}>
                <label htmlFor={id}>{label} · 1 baixo, 5 alto</label>
                <select
                  id={id}
                  value={values[index]}
                  onChange={(event) => {
                    setters[index]!(event.target.value);
                    setClear(false);
                  }}
                >
                  <option value="">Não avaliado</option>
                  {[1, 2, 3, 4, 5].map((score) => (
                    <option key={score} value={score}>
                      {score}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <fieldset className="plan-evidence-select">
            <legend>Evidence que sustenta a avaliação (1 a 10)</legend>
            {item.evidenceIds.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={evidenceIds.includes(id)}
                  onChange={(event) =>
                    setEvidenceIds((current) =>
                      event.target.checked
                        ? [...current, id]
                        : current.filter((value) => value !== id),
                    )
                  }
                />
                {id}
              </label>
            ))}
          </fieldset>
          {item.priorityAssessment && (
            <button
              type="button"
              onClick={() => {
                setClear(true);
                setImpact("");
                setRisk("");
                setEffort("");
                setEvidenceIds([]);
              }}
            >
              Limpar avaliação e deixar não avaliada
            </button>
          )}
          <div className="plan-justification">
            <label
              htmlFor={`priority-justification-${encodeURIComponent(item.id)}`}
            >
              Justificativa (obrigatória)
            </label>
            <textarea
              id={`priority-justification-${encodeURIComponent(item.id)}`}
              value={justification}
              minLength={10}
              maxLength={4_000}
              required
              onChange={(event) => setJustification(event.target.value)}
            />
          </div>
          {error && (
            <>
              <Notice error>{error}</Notice>
              <button type="button" onClick={onSaved}>
                Recarregar estado atual
              </button>
            </>
          )}
          <button
            className="primary"
            disabled={busy || invalid || justification.trim().length < 10}
          >
            {busy ? "Registrando avaliação…" : "Salvar avaliação"}
          </button>
        </form>
      )}
    </div>
  );
}

function PlanContestForm({
  item,
  plan,
  snapshotId,
  onContested,
}: {
  item: UnifiedPlan["items"]["items"][number];
  plan: UnifiedPlan;
  snapshotId: string;
  onContested: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("plan/contest", {
        method: "POST",
        body: {
          id: crypto.randomUUID(),
          snapshotId,
          planDigest: plan.planDigest,
          itemId: item.id,
          justification,
          evidenceIds,
        },
      });
      setJustification("");
      setEvidenceIds([]);
      setOpen(false);
      onContested();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="plan-contest">
      <button aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? "Cancelar contestação" : "Contestar recomendação"}
      </button>
      {open && (
        <form
          className="plan-triage-form"
          onSubmit={(event) => void submit(event)}
        >
          <fieldset className="plan-evidence-select">
            <legend>Evidence de apoio (selecione de 1 a 10)</legend>
            {item.evidenceIds.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={evidenceIds.includes(id)}
                  onChange={(event) =>
                    setEvidenceIds((current) =>
                      event.target.checked
                        ? [...current, id]
                        : current.filter((value) => value !== id),
                    )
                  }
                />
                {id}
              </label>
            ))}
          </fieldset>
          <div className="plan-justification">
            <label htmlFor={`contest-${encodeURIComponent(item.id)}`}>
              Por que a recomendação deve ser revista?
            </label>
            <textarea
              id={`contest-${encodeURIComponent(item.id)}`}
              value={justification}
              minLength={10}
              maxLength={4_000}
              required
              onChange={(event) => setJustification(event.target.value)}
            />
          </div>
          {error && <Notice error>{error}</Notice>}
          <button
            className="primary"
            disabled={
              busy ||
              evidenceIds.length < 1 ||
              evidenceIds.length > 10 ||
              justification.trim().length < 10
            }
          >
            {busy ? "Preservando contestação…" : "Registrar contestação"}
          </button>
        </form>
      )}
    </div>
  );
}

function PlanContestHistory({
  snapshotId,
  planDigest,
  onEvidence,
  refresh,
}: {
  snapshotId: string;
  planDigest: string;
  onEvidence: (id: string) => void;
  refresh: number;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<PlanContestations>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      snapshotId,
      planDigest,
      limit: String(LIMIT),
      offset: String(offset),
    });
    setHistory(undefined);
    setError("");
    void api<PlanContestations>(`plan/contestations?${query}`, {
      signal: controller.signal,
    })
      .then(setHistory)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [offset, open, planDigest, refresh, snapshotId]);
  return (
    <section
      className="plan-contestation-history"
      aria-label="Histórico de contestações"
    >
      <button
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setOffset(0);
        }}
      >
        {open ? "Ocultar contestações" : "Histórico de contestações"}
      </button>
      {error && <Notice error>{error}</Notice>}
      {open && history && (
        <>
          {!history.items.total && (
            <Notice>Nenhuma recomendação contestada.</Notice>
          )}
          <ol className="plan-events">
            {history.items.items.map((record) => (
              <li key={record.id}>
                <strong>
                  {record.item.title} · {date(record.createdAt)}
                </strong>
                <p>{record.justification}</p>
                <div
                  className="row-actions"
                  aria-label="Evidence da contestação"
                >
                  {record.evidenceIds.map((id) => (
                    <button key={id} onClick={() => onEvidence(id)}>
                      Ver Evidence {id.slice(0, 8)}
                    </button>
                  ))}
                </div>
                <small>Hash do evento: {record.eventHash}</small>
              </li>
            ))}
          </ol>
          <Pager
            offset={offset}
            total={history.items.total}
            limit={LIMIT}
            onChange={setOffset}
          />
        </>
      )}
      {open && !history && !error && <Notice>Carregando contestações…</Notice>}
    </section>
  );
}

export function PlanTriage({
  snapshotId,
  onEvidence,
}: {
  snapshotId: string;
  onEvidence: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [plan, setPlan] = useState<UnifiedPlan>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [contestRefresh, setContestRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<UnifiedPlan>("plan", {
      method: "POST",
      body: { snapshotId, limit: LIMIT, offset },
      signal: controller.signal,
    })
      .then(setPlan)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, refresh, snapshotId]);
  return (
    <section className="card plan-triage" aria-labelledby="plan-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PLANO UNIFICADO</p>
          <h2 id="plan-heading">Revisar e atribuir itens</h2>
        </div>
        {plan && (
          <span className="snapshot-id">
            Digest {plan.planDigest.slice(0, 12)}
          </span>
        )}
      </div>
      <Notice>
        Prioridade é uma avaliação humana justificada e ligada a Evidence,
        ordenada por impacto desc., risco desc. e esforço asc.; notas ausentes
        ficam por último. Estados e responsáveis são registros de triagem:
        “Concluído” não significa verificado, e este plano não autoriza
        execução.
      </Notice>
      {error && <Notice error>{error}</Notice>}
      {loading && <Notice>Carregando plano preservado…</Notice>}
      {plan && (
        <>
          {plan.items.items.map((item, index) => (
            <PlanItem
              key={`${plan.planDigest}:${item.id}:${item.triageRevision ?? 0}`}
              item={item}
              position={offset + index + 1}
              plan={plan}
              snapshotId={snapshotId}
              onEvidence={onEvidence}
              onSaved={() => setRefresh((value) => value + 1)}
              onContested={() => setContestRefresh((value) => value + 1)}
            />
          ))}
          {!plan.items.total && (
            <Notice>Este snapshot não gerou itens no plano atual.</Notice>
          )}
          <Pager
            offset={offset}
            total={plan.items.total}
            limit={LIMIT}
            onChange={setOffset}
          />
          <PlanContestHistory
            key={`${snapshotId}:${plan.planDigest}`}
            snapshotId={snapshotId}
            planDigest={plan.planDigest}
            onEvidence={onEvidence}
            refresh={contestRefresh}
          />
          {plan.engines.map((engine) => (
            <p key={engine.engine} className="plan-coverage">
              {engine.engine}: {engine.includedCount} itens incluídos de{" "}
              {engine.sourceCount}; cobertura{" "}
              {engine.status === "not_implemented"
                ? "não implementada"
                : "parcial estática"}
              .
            </p>
          ))}
        </>
      )}
    </section>
  );
}
