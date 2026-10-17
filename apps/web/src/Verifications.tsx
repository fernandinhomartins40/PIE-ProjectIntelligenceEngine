import { useEffect, useState } from "react";
import { api, type VerificationHistory, type VerificationRun } from "./api.js";
import { date, message, Notice, Pager } from "./components.js";

const states = {
  passed: "Aprovado no escopo executado",
  failed: "Falhou",
  skipped: "Ignorado",
  blocked: "Bloqueado",
  inconclusive: "Inconclusivo",
};
const LIMIT = 10;

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

export function Verifications({ snapshotId }: { snapshotId: string }) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<VerificationHistory>();
  const [selected, setSelected] = useState("");
  const [run, setRun] = useState<VerificationRun>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<VerificationHistory>(
      `verifications/${snapshotId}?limit=${LIMIT}&offset=${offset}`,
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
  }, [snapshotId, offset, revision]);
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
  return (
    <section
      className="card investigation"
      aria-label="Verificações do snapshot"
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
        Resultados do escopo autorizado deste snapshot. Uma aprovação não
        comprova o funcionamento de todo o projeto. Ignorados, bloqueados e
        inconclusivos não representam aprovação.
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
                  <th>Resultado</th>
                  <th>Limpeza</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => (
                  <tr key={item.id}>
                    <td>{date(item.completedAt)}</td>
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
            <Notice>Nenhuma verificação executada para este snapshot.</Notice>
          )}
        </>
      )}
      {selected && !run && !error && (
        <Notice>Carregando resultado e evidência…</Notice>
      )}
      {run && <RunDetails key={run.id} run={run} />}
    </section>
  );
}
