import { useEffect, useState } from "react";
import {
  api,
  type VerificationComparison,
  type VerificationHistory,
  type VerificationRun,
} from "./api.js";
import { date, message, Notice, Pager } from "./components.js";

const states = {
  passed: "Aprovado no escopo executado",
  failed: "Falhou",
  skipped: "Ignorado",
  blocked: "Bloqueado",
  inconclusive: "Inconclusivo",
};
const LIMIT = 50;

const comparisonStates = {
  regression_observed: "Regressão observada nos casos comparáveis",
  no_regression_observed: "Nenhuma regressão observada nos casos comparáveis",
  inconclusive: "Comparação inconclusiva",
};

const caseClassifications = {
  regression_observed: "Falhou depois de passar antes",
  recovery_observed: "Passou depois de falhar antes",
  unchanged: "Resultado igual",
  different_outcome: "Resultado diferente",
  environment_changed: "Ambiente de execução diferente",
};

const testCaseOutcomes = {
  passed: "Passou",
  failed: "Falhou",
  skipped: "Ignorado",
  todo: "Pendente (TODO)",
};

const caseExecutionStates = {
  not_selected: "Nenhum caso específico foi selecionado",
  unknown: "Indeterminado: relatório incompleto ou indisponível",
  not_reported: "Caso não reportado em relatório completo",
  observed: "Identidade do caso observada",
  ambiguous: "Identidade ambígua: múltiplos resultados correspondentes",
};

const testExecutionStates = {
  unknown: "Indeterminado",
  no_cases_reported: "Nenhum caso reportado",
  all_reported_cases_passed: "Todos os casos reportados passaram",
  failed_cases_observed: "Falha observada em caso reportado",
  skipped_or_todo_observed: "Caso ignorado ou TODO observado",
  partial: "Resultados parciais",
};

const runtimeObservationStates = {
  unknown: "Indeterminado",
  not_instrumented: "Instrumentação indisponível",
  line_observed: "Linha observada no runtime",
  line_not_observed: "Linha não observada no relatório completo",
};

function BindingSetDetails({
  label,
  bindings,
}: {
  label: string;
  bindings: VerificationComparison["declaredBindings"]["before"];
}) {
  return (
    <section aria-label={label}>
      <h5>{label}</h5>
      {bindings.state === "unknown" ? (
        <p>Esta execução não preserva bindings verificáveis.</p>
      ) : bindings.bindings.items.length === 0 ? (
        <p>Nenhum binding foi declarado nesta execução.</p>
      ) : (
        <ul>
          {bindings.bindings.items.map((binding, index) => (
            <li key={`${binding.declarationId}-${index}`}>
              <strong>
                {binding.testCase
                  ? `Caso selecionado: ${binding.testCase.name} (nível ${binding.testCase.nesting})`
                  : "Sem seletor de caso específico"}
              </strong>
              <p className="path">
                {binding.testFile} → {binding.declaration.name} —{" "}
                {binding.declaration.sourcePath}
                {binding.declaration.line === null
                  ? ""
                  : `:${binding.declaration.line}`}
              </p>
              <dl>
                <dt>Resultado do caso vinculado</dt>
                <dd>
                  {caseExecutionStates[binding.caseExecution.state]}
                  {binding.caseExecution.outcome
                    ? ` — ${testCaseOutcomes[binding.caseExecution.outcome]}`
                    : ""}
                  {` (${binding.caseExecution.matches} correspondência(s))`}
                </dd>
                <dt>Resultados do arquivo</dt>
                <dd>
                  {testExecutionStates[binding.testExecution.state]}; relatório{" "}
                  {binding.testExecution.complete ? "completo" : "incompleto"}
                </dd>
                <dt>Observação de runtime</dt>
                <dd>
                  {runtimeObservationStates[binding.runtimeObservation.state]}
                </dd>
                <dt>Interpretação</dt>
                <dd>
                  Declaração do operador; sem cobertura semântica comprovada
                </dd>
                <dt>Evidence do caso</dt>
                <dd className="path">
                  {binding.caseExecution.evidenceId ?? "Não disponível"}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ComparisonDetails({
  comparison,
  onPage,
}: {
  comparison: VerificationComparison;
  onPage: (offset: number) => void;
}) {
  return (
    <article aria-label="Comparação de execuções VERIFY">
      <h3>{comparisonStates[comparison.state]}</h3>
      <dl>
        <dt>Execução anterior / Evidence</dt>
        <dd className="path">
          {comparison.before.runId} / {comparison.before.evidenceId}
        </dd>
        <dt>Execução posterior / Evidence</dt>
        <dd className="path">
          {comparison.after.runId} / {comparison.after.evidenceId}
        </dd>
        <dt>Casos alinhados</dt>
        <dd>{comparison.coverage.matchedCases}</dd>
        <dt>Regressões / recuperações</dt>
        <dd>
          {comparison.coverage.regressions} / {comparison.coverage.recoveries}
        </dd>
        <dt>Imagem igual</dt>
        <dd>{comparison.coverage.sameImage ? "Sim" : "Não"}</dd>
      </dl>
      <ul>
        {comparison.coverage.limitations.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
      <details>
        <summary>Bindings e resultados vinculados às declarações</summary>
        <p>
          Os vínculos refletem a intenção registrada pelo operador. Outcome
          observado não comprova que a asserção valida a declaração nem cria
          cobertura semântica.
        </p>
        <BindingSetDetails
          label="Execução anterior"
          bindings={comparison.declaredBindings.before}
        />
        <BindingSetDetails
          label="Execução posterior"
          bindings={comparison.declaredBindings.after}
        />
      </details>
      {comparison.cases.total > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <caption>Casos correspondentes por identidade exata</caption>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Caso</th>
                  <th>Antes</th>
                  <th>Depois</th>
                  <th>Leitura</th>
                </tr>
              </thead>
              <tbody>
                {comparison.cases.items.map((item) => (
                  <tr key={item.id}>
                    <td className="path">{item.file}</td>
                    <td>{item.name}</td>
                    <td>{item.before}</td>
                    <td>{item.after}</td>
                    <td>{caseClassifications[item.classification]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            offset={comparison.cases.offset}
            total={comparison.cases.total}
            limit={25}
            onChange={onPage}
          />
        </>
      ) : (
        <Notice>Nenhum caso pôde ser alinhado com segurança.</Notice>
      )}
      <Notice>
        Esta comparação cobre somente os casos e arquivos indicados. Ela não
        aprova o produto nem comprova cobertura funcional completa.
      </Notice>
    </article>
  );
}

function RunDetails({ run }: { run: VerificationRun }) {
  const [caseOffset, setCaseOffset] = useState(0);
  return (
    <article aria-label="Detalhes da verificação">
      <h3>{states[run.result.state]}</h3>
      <dl>
        <dt>Execução</dt>
        <dd className="path">{run.id}</dd>
        <dt>Concluída em</dt>
        <dd>{date(run.completedAt)}</dd>
        <dt>Imagem autorizada</dt>
        <dd className="path">{run.image}</dd>
        <dt>Limpeza dos recursos</dt>
        <dd>
          {run.cleanup === "complete"
            ? "Concluída"
            : "Pendente — consulte os recursos antes de nova execução"}
        </dd>
        <dt>Evidência</dt>
        <dd className="path">{run.evidence.id}</dd>
        <dt>SHA-256 da evidência</dt>
        <dd className="path">{run.evidence.sha256}</dd>
        <dt>Observação</dt>
        <dd>{run.evidence.observation}</dd>
      </dl>
      {run.failure && <Notice error>{run.failure.message}</Notice>}
      <ul>
        {run.result.coverage.limitations.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
      {run.schemaVersion === 2 ? (
        <details>
          <summary>Autorização e limites preservados</summary>
          <pre className="path">
            {JSON.stringify(run.authorization, null, 2)}
          </pre>
        </details>
      ) : (
        <Notice>
          Registro antigo: autorização completa não foi preservada neste
          formato.
        </Notice>
      )}
      <div className="table-wrap">
        <table>
          <caption>Casos observados nesta execução</caption>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Arquivo</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {run.result.cases
              .slice(caseOffset, caseOffset + 25)
              .map((item, index) => (
                <tr key={index}>
                  <td>{item.name}</td>
                  <td className="path">{item.file ?? "Não informado"}</td>
                  <td>
                    {item.outcome === "todo"
                      ? "Pendente"
                      : states[item.outcome]}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {run.result.cases.length > 0 && (
        <Pager
          offset={caseOffset}
          total={run.result.cases.length}
          limit={25}
          onChange={setCaseOffset}
        />
      )}
      {!run.result.cases.length && (
        <Notice>Nenhum caso de teste comprovado nesta execução.</Notice>
      )}
    </article>
  );
}

export function Verifications({ projectId }: { projectId: string }) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<VerificationHistory>();
  const [selected, setSelected] = useState("");
  const [run, setRun] = useState<VerificationRun>();
  const [beforeRunId, setBeforeRunId] = useState("");
  const [afterRunId, setAfterRunId] = useState("");
  const [comparison, setComparison] = useState<VerificationComparison>();
  const [comparisonError, setComparisonError] = useState("");
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<VerificationHistory>(
      `projects/${projectId}/verifications?limit=${LIMIT}&offset=${offset}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setHistory(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, offset, revision]);
  useEffect(() => {
    setRun(undefined);
    if (!selected) return;
    const controller = new AbortController();
    void api<VerificationRun>(`verification/${selected}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setRun(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [selected]);
  async function compareRuns(offset = 0) {
    setComparing(true);
    setComparisonError("");
    try {
      const result = await api<VerificationComparison>(
        "verification-comparison",
        {
          method: "POST",
          body: { beforeRunId, afterRunId, offset, limit: 25 },
        },
      );
      setComparison(result);
    } catch (cause) {
      setComparisonError(message(cause));
    } finally {
      setComparing(false);
    }
  }
  return (
    <section
      className="card investigation"
      aria-label="Verificações do projeto"
    >
      <div className="section-heading">
        <h2>Verificações executadas</h2>
        <button
          onClick={() => setRevision((value) => value + 1)}
          disabled={loading}
        >
          Atualizar verificações
        </button>
      </div>
      <p>
        Histórico de execuções autorizadas nos snapshots deste projeto. Uma
        aprovação não comprova o funcionamento de todo o projeto. Ignorados,
        bloqueados e inconclusivos não representam aprovação.
      </p>
      {error && <Notice error>{error}</Notice>}
      {loading && <Notice>Consultando verificações…</Notice>}
      {history && (
        <>
          <div className="table-wrap">
            <table>
              <caption>Histórico de verificações</caption>
              <thead>
                <tr>
                  <th>Concluída em</th>
                  <th>Snapshot</th>
                  <th>Resultado</th>
                  <th>Limpeza</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => (
                  <tr key={item.id}>
                    <td>{date(item.completedAt)}</td>
                    <td className="path">{item.snapshotId.slice(0, 8)}</td>
                    <td>{states[item.state]}</td>
                    <td>
                      {item.cleanup === "complete" ? "Concluída" : "Pendente"}
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          setError("");
                          setSelected(item.id);
                        }}
                      >
                        Abrir verificação {item.id.slice(0, 8)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            offset={offset}
            total={history.total}
            limit={LIMIT}
            onChange={setOffset}
          />
          {history.total === 0 && (
            <Notice>
              Nenhuma execução VERIFY foi registrada para este projeto.
            </Notice>
          )}
        </>
      )}
      {history && history.total > 0 && (
        <section aria-label="Comparar execuções VERIFY">
          <h3>Comparar execuções entre snapshots</h3>
          <p>
            Selecione duas execuções persistidas do projeto. A ausência de
            regressão observada não significa aprovação do produto.
          </p>
          <div className="inline-form">
            <div>
              <label htmlFor="verification-before">Execução anterior</label>
              <select
                id="verification-before"
                value={beforeRunId}
                onChange={(event) => {
                  setBeforeRunId(event.target.value);
                  setComparison(undefined);
                }}
              >
                <option value="">Selecione uma execução</option>
                {beforeRunId &&
                  !history.items.some((item) => item.id === beforeRunId) && (
                    <option value={beforeRunId}>
                      Execução selecionada {beforeRunId.slice(0, 8)}
                    </option>
                  )}
                {history.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {date(item.completedAt)} · {item.state} · snapshot{" "}
                    {item.snapshotId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="verification-after">Execução posterior</label>
              <select
                id="verification-after"
                value={afterRunId}
                onChange={(event) => {
                  setAfterRunId(event.target.value);
                  setComparison(undefined);
                }}
              >
                <option value="">Selecione uma execução</option>
                {afterRunId &&
                  !history.items.some((item) => item.id === afterRunId) && (
                    <option value={afterRunId}>
                      Execução selecionada {afterRunId.slice(0, 8)}
                    </option>
                  )}
                {history.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {date(item.completedAt)} · {item.state} · snapshot{" "}
                    {item.snapshotId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => void compareRuns()}
              disabled={
                comparing ||
                !beforeRunId ||
                !afterRunId ||
                beforeRunId === afterRunId
              }
            >
              {comparing ? "Comparando…" : "Comparar execuções"}
            </button>
          </div>
          {comparisonError && <Notice error>{comparisonError}</Notice>}
          {comparison && (
            <ComparisonDetails
              key={`${comparison.before.runId}-${comparison.after.runId}`}
              comparison={comparison}
              onPage={(nextOffset) => void compareRuns(nextOffset)}
            />
          )}
        </section>
      )}
      {selected && !run && !error && (
        <Notice>Carregando resultado e evidência…</Notice>
      )}
      {run && <RunDetails key={run.id} run={run} />}
    </section>
  );
}
