import { TraceResult } from "./TraceResult.js";
import { Verifications } from "./Verifications.js";
import { VerificationQueue } from "./VerificationQueue.js";
import { FunctionalReview } from "./FunctionalReview.js";
import { ProductReview } from "./ProductReview.js";
import { InfrastructureReview } from "./InfrastructureReview.js";
import { DataReview } from "./DataReview.js";
import { SecurityReview } from "./SecurityReview.js";
import { DeclarationChanges } from "./DeclarationChanges.js";
import { RetestPlan } from "./RetestPlan.js";
import { PlanTriage } from "./PlanTriage.js";
import { useEffect, useRef, useState } from "react";
import {
  api,
  type Comparison,
  type Declarations,
  type Evidence,
  type Graph,
  type History,
  type Trace,
} from "./api.js";
import { date, message, Notice, Pager } from "./components.js";

const LIMIT = 25;
type Tab = "files" | "declarations" | "trace" | "compare";
export function Investigation({
  projectId,
  snapshotId,
  history,
}: {
  projectId: string;
  snapshotId: string;
  history: History["items"];
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [offset, setOffset] = useState(0);
  const [graph, setGraph] = useState<Graph>();
  const [declarations, setDeclarations] = useState<Declarations>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [evidence, setEvidence] = useState<Evidence>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [seed, setSeed] = useState("");
  const [direction, setDirection] = useState("dependencies");
  const [depth, setDepth] = useState(4);
  const [trace, setTrace] = useState<Trace>();
  const [beforeId, setBeforeId] = useState("");
  const [comparison, setComparison] = useState<Comparison>();
  const currentId = useRef(snapshotId);
  currentId.current = snapshotId;
  useEffect(() => {
    setOffset(0);
    setTrace(undefined);
    setComparison(undefined);
    setEvidence(undefined);
    setSeed("");
    setError("");
  }, [snapshotId]);
  useEffect(() => {
    setOffset(0);
  }, [tab]);
  useEffect(() => {
    if (tab === "trace" || tab === "compare") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const endpoint = tab === "declarations" ? "declarations" : "graph";
    void api<Graph | Declarations>(
      `${endpoint}/${snapshotId}?limit=${LIMIT}&offset=${tab === "files" || tab === "declarations" ? offset : 0}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if ("nodes" in value) setGraph(value);
        else setDeclarations(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [snapshotId, tab, offset]);
  async function showEvidence(id: string) {
    const selected = snapshotId;
    setEvidenceLoading(true);
    setError("");
    try {
      const value = await api<Evidence>(`evidence/${id}`);
      if (currentId.current === selected) setEvidence(value);
    } catch (cause) {
      if (currentId.current === selected) setError(message(cause));
    } finally {
      if (currentId.current === selected) setEvidenceLoading(false);
    }
  }
  async function runTrace(nextOffset = 0, accepted?: Trace) {
    const selected = snapshotId;
    setLoading(true);
    setError("");
    try {
      const value = await api<Trace>("trace", {
        method: "POST",
        body: {
          snapshotId,
          nodeId: accepted?.seedId ?? seed,
          direction: accepted?.direction ?? direction,
          maxDepth: accepted?.coverage.maxDepth ?? depth,
          offset: nextOffset,
          limit: LIMIT,
        },
      });
      if (currentId.current === selected) {
        setTrace(value);
        setOffset(nextOffset);
      }
    } catch (cause) {
      if (currentId.current === selected) setError(message(cause));
    } finally {
      if (currentId.current === selected) setLoading(false);
    }
  }
  async function compare(nextOffset = 0, accepted?: Comparison) {
    const selected = snapshotId;
    setLoading(true);
    setError("");
    try {
      const value = await api<Comparison>("compare", {
        method: "POST",
        body: {
          beforeId: accepted?.beforeId ?? beforeId,
          afterId: snapshotId,
          offset: nextOffset,
          limit: LIMIT,
        },
      });
      if (currentId.current === selected) {
        setComparison(value);
        setOffset(nextOffset);
      }
    } catch (cause) {
      if (currentId.current === selected) setError(message(cause));
    } finally {
      if (currentId.current === selected) setLoading(false);
    }
  }
  function chooseSeed(id: string) {
    setSeed(id);
    setTab("trace");
  }
  const coverage = (tab === "declarations" ? declarations : graph)?.coverage;
  return (
    <>
      <section className="summary">
        <div className="card">
          <span>Arquivos observados</span>
          <strong>{graph?.nodes.total ?? "—"}</strong>
        </div>
        <div className="card">
          <span>Relações de imports</span>
          <strong>{graph?.edges.total ?? "—"}</strong>
        </div>
        <div className="card">
          <span>Cobertura de arquivos</span>
          <strong className="status-label">
            {coverage?.status === "complete"
              ? "Completa no escopo Git"
              : coverage
                ? "Parcial"
                : "Carregando"}
          </strong>
        </div>
        <div className="card">
          <span>Funcionamento em execução</span>
          <strong className="status-label">Não verificado</strong>
        </div>
      </section>
      <section
        className="card investigation"
        aria-label="Observações estáticas"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">INVESTIGAÇÃO</p>
            <h2>Explore as observações</h2>
          </div>
          <span className="snapshot-id">Snapshot {snapshotId.slice(0, 8)}</span>
        </div>
        <nav className="tabs" aria-label="Visões da investigação">
          {(
            [
              ["files", "Arquivos"],
              ["declarations", "Declarações"],
              ["trace", "Relações"],
              ["compare", "Comparar versões"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {error && <Notice error>{error}</Notice>}
        {loading && <Notice>Consultando observações…</Notice>}
        {tab === "files" && graph && (
          <>
            <div className="table-wrap">
              <table>
                <caption>Arquivos lidos no snapshot</caption>
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Classificação por nome</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.nodes.items.map((node) => (
                    <tr key={node.id}>
                      <td className="path">{node.path}</td>
                      <td>{node.kind}</td>
                      <td className="row-actions">
                        <button onClick={() => chooseSeed(node.id)}>
                          Rastrear
                        </button>
                        <button
                          onClick={() =>
                            void showEvidence(node.evidenceIds[0]!)
                          }
                        >
                          Ver evidência
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              total={graph.nodes.total}
              limit={LIMIT}
              onChange={setOffset}
            />
          </>
        )}
        {tab === "declarations" && declarations && (
          <>
            {declarations.declarations.total === 0 && (
              <Notice>
                Nenhuma declaração coletada neste snapshot. Consulte a cobertura
                e os limites dos adaptadores.
              </Notice>
            )}
            <div className="table-wrap">
              <table>
                <caption>
                  Declarações estáticas — funcionamento não verificado
                </caption>
                <thead>
                  <tr>
                    <th>Declaração</th>
                    <th>Tipo / adaptador</th>
                    <th>Origem</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {declarations.declarations.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.name}
                        {item.parent && <small>em {item.parent}</small>}
                      </td>
                      <td>
                        {item.kind}
                        <small>{item.adapter}</small>
                      </td>
                      <td className="path">
                        {item.source.path}:{item.source.line}
                      </td>
                      <td className="row-actions">
                        <button onClick={() => chooseSeed(item.id)}>
                          Rastrear
                        </button>
                        <button
                          onClick={() => void showEvidence(item.evidenceId)}
                        >
                          Ver evidência
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              total={declarations.declarations.total}
              limit={LIMIT}
              onChange={setOffset}
            />
          </>
        )}
        {tab === "trace" && (
          <>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runTrace();
              }}
            >
              <div className="grow">
                <label htmlFor="seed">Nó inicial</label>
                <input
                  id="seed"
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                  required
                  placeholder="Selecione Rastrear em um arquivo ou declaração"
                />
              </div>
              <div>
                <label htmlFor="direction">Direção</label>
                <select
                  id="direction"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value)}
                >
                  <option value="dependencies">Dependências</option>
                  <option value="dependents">Dependentes</option>
                  <option value="both">Ambas</option>
                </select>
              </div>
              <div>
                <label htmlFor="depth">Profundidade</label>
                <input
                  id="depth"
                  type="number"
                  min={0}
                  max={32}
                  value={depth}
                  onChange={(event) => setDepth(Number(event.target.value))}
                />
              </div>
              <button className="primary" disabled={loading || !seed}>
                Rastrear relações
              </button>
            </form>
            {trace && (
              <TraceResult
                trace={trace}
                limit={LIMIT}
                onEvidence={(id) => void showEvidence(id)}
                onPage={(value) => void runTrace(value, trace)}
              />
            )}
          </>
        )}
        {tab === "compare" && (
          <>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void compare();
              }}
            >
              <div className="grow">
                <label htmlFor="before">Comparar snapshot atual com</label>
                <select
                  id="before"
                  value={beforeId}
                  onChange={(event) => setBeforeId(event.target.value)}
                  required
                >
                  <option value="">Selecione uma observação anterior</option>
                  {beforeId &&
                    !history.some((item) => item.id === beforeId) && (
                      <option value={beforeId}>
                        Snapshot escolhido · {beforeId.slice(0, 8)}
                      </option>
                    )}
                  {history
                    .filter((item) => item.id !== snapshotId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {date(item.created_at)} · {item.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </div>
              <button className="primary" disabled={loading || !beforeId}>
                Comparar snapshots
              </button>
            </form>
            {history.filter((item) => item.id !== snapshotId).length === 0 && (
              <Notice>
                São necessários dois snapshots do mesmo projeto para comparar
                mudanças.
              </Notice>
            )}
            {comparison && (
              <>
                <Notice>
                  {comparison.status === "unchanged"
                    ? "Conteúdo observado sem alteração"
                    : comparison.status === "changed"
                      ? "Mudanças de conteúdo observadas"
                      : "Comparação inconclusiva"}
                  . {comparison.counts.modified} modificados,{" "}
                  {comparison.counts.added} adicionados,{" "}
                  {comparison.counts.removed} removidos e{" "}
                  {comparison.counts.unknown} ausências não conclusivas. Isso
                  não valida regressões em execução.
                </Notice>
                <div className="table-wrap">
                  <table>
                    <caption>Mudanças entre snapshots</caption>
                    <thead>
                      <tr>
                        <th>Arquivo</th>
                        <th>Observação</th>
                        <th>Evidência posterior</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.changes.items.map((item) => (
                        <tr key={item.path}>
                          <td className="path">{item.path}</td>
                          <td>{item.state}</td>
                          <td>
                            {item.after?.evidenceIds[0] && (
                              <button
                                onClick={() =>
                                  void showEvidence(item.after!.evidenceIds[0]!)
                                }
                              >
                                Ver evidência
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  offset={offset}
                  total={Math.max(
                    comparison.changes.total,
                    comparison.declarationChanges.total,
                  )}
                  limit={LIMIT}
                  onChange={(value) => void compare(value, comparison)}
                />
                <DeclarationChanges
                  comparison={comparison}
                  onEvidence={(id) => void showEvidence(id)}
                />
                <RetestPlan
                  key={`${comparison.beforeId}:${comparison.afterId}`}
                  beforeId={comparison.beforeId}
                  afterId={comparison.afterId}
                  onEvidence={(id) => void showEvidence(id)}
                />
                <p>
                  {comparison.impact.total} arquivos no impacto registrado pelos
                  dois grafos.
                </p>
              </>
            )}
          </>
        )}
        {coverage && (
          <details className="coverage">
            <summary>Cobertura e limitações da descoberta</summary>
            <p>
              {coverage.examinedFiles} de {coverage.enumeratedFiles} arquivos
              rastreados examinados · {coverage.bytesRead} bytes lidos.
            </p>
            <ul>
              {coverage.limitations.map((value, index) => (
                <li key={index}>{value}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {evidenceLoading && <Notice>Carregando evidência…</Notice>}
      {evidence && (
        <aside className="card evidence" aria-label="Detalhes da evidência">
          <div className="section-heading">
            <h2>Evidência observada</h2>
            <button onClick={() => setEvidence(undefined)}>
              Fechar evidência
            </button>
          </div>
          <dl>
            <dt>Origem</dt>
            <dd className="path">
              {evidence.source.path}
              {evidence.source.line ? `:${evidence.source.line}` : ""}
            </dd>
            <dt>Método / confiança</dt>
            <dd>
              {evidence.method} / {evidence.confidence}
            </dd>
            <dt>Estado</dt>
            <dd>Não verificado em execução</dd>
            <dt>Revisão</dt>
            <dd className="path">{evidence.revision ?? "Sem commit"}</dd>
            <dt>Ambiente / data</dt>
            <dd>
              {evidence.environment} · {date(evidence.createdAt)}
            </dd>
            <dt>SHA-256 da evidência</dt>
            <dd className="path">{evidence.sha256}</dd>
            <dt>Observação</dt>
            <dd>{evidence.observation}</dd>
          </dl>
          <ul>
            {evidence.limitations.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ul>
        </aside>
      )}
      <Verifications key={projectId} projectId={projectId} />
      <FunctionalReview
        key={`functional-${snapshotId}`}
        snapshotId={snapshotId}
      />
      <ProductReview key={`product-${snapshotId}`} snapshotId={snapshotId} />
      <SecurityReview
        key={`security-${snapshotId}`}
        snapshotId={snapshotId}
        onEvidence={(id) => void showEvidence(id)}
      />
      <InfrastructureReview
        key={`infrastructure-${snapshotId}`}
        snapshotId={snapshotId}
        onEvidence={(id) => void showEvidence(id)}
      />
      <DataReview
        key={"data-" + snapshotId}
        snapshotId={snapshotId}
        onEvidence={(id) => void showEvidence(id)}
      />
      <VerificationQueue key={`queue-${snapshotId}`} snapshotId={snapshotId} />
      <PlanTriage
        key={`plan-${snapshotId}`}
        snapshotId={snapshotId}
        onEvidence={(id) => void showEvidence(id)}
      />
    </>
  );
}
