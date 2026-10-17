import { useEffect, useState } from "react";
import { api, type RetestPlan as Plan } from "./api.js";
import { Notice, Pager, message } from "./components.js";

function PlanResults({
  plan,
  onPage,
  onEvidence,
}: {
  plan: Plan | undefined;
  onPage: (offset: number) => void;
  onEvidence: (id: string) => void;
}) {
  return (
    <>
      {plan && (
        <>
          <Notice>
            {plan.coverage.selectedTests} candidatos entre{" "}
            {plan.coverage.observedCurrentTests} testes observados. Execução não
            autorizada por este plano.
          </Notice>
          <p>
            Modo consultado:{" "}
            {plan.mode === "full"
              ? "Todos os testes observados"
              : "Impacto registrado"}
            . {plan.coverage.removedOrUnobservedPreviousTests} testes anteriores
            removidos ou não observados; não selecionados para execução.
          </p>
          <div className="table-wrap">
            <table>
              <caption>Arquivos candidatos a reteste</caption>
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Motivo</th>
                  <th>Runner</th>
                  <th>Prova</th>
                </tr>
              </thead>
              <tbody>
                {plan.candidates.items.map((candidate) => (
                  <tr key={candidate.nodeId}>
                    <td className="path">{candidate.path}</td>
                    <td>
                      {candidate.reason === "recorded_dependency_impact"
                        ? "Impacto de dependência registrado"
                        : "Inventário completo observado"}
                    </td>
                    <td>Não verificado</td>
                    <td>
                      <button
                        onClick={() => onEvidence(candidate.evidenceIds[0]!)}
                      >
                        Abrir prova do candidato
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!plan.candidates.total && (
            <Notice>
              Nenhum candidato selecionado. Isso não comprova ausência de
              regressão.
            </Notice>
          )}
          <Pager
            offset={plan.candidates.offset}
            total={plan.candidates.total}
            limit={10}
            onChange={onPage}
          />
          <details>
            <summary>Limitações do planejamento de retestes</summary>
            <ul>
              {plan.coverage.limitations.map((value, index) => (
                <li key={index}>{value}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </>
  );
}

export function RetestPlan({
  beforeId,
  afterId,
  onEvidence,
}: {
  beforeId: string;
  afterId: string;
  onEvidence: (id: string) => void;
}) {
  const [mode, setMode] = useState<"affected" | "full">("affected");
  const [request, setRequest] = useState<{
    mode: "affected" | "full";
    offset: number;
    revision: number;
  }>();
  const [plan, setPlan] = useState<Plan>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPlan(undefined);
    void api<Plan>("retest-plan", {
      method: "POST",
      body: {
        beforeId,
        afterId,
        mode: request.mode,
        offset: request.offset,
        limit: 10,
      },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPlan(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [beforeId, afterId, request]);
  return (
    <section aria-label="Planejamento de retestes">
      <h3>Candidatos a reteste</h3>
      <p>
        Seleção de arquivos observados para revisão. Não executa código nem
        autoriza testes; cobertura funcional e compatibilidade do runner
        permanecem não verificadas.
      </p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          setRequest((previous) => ({
            mode,
            offset: 0,
            revision: (previous?.revision ?? 0) + 1,
          }));
        }}
      >
        <div>
          <label htmlFor="retest-mode">Escopo dos candidatos</label>
          <select
            id="retest-mode"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "affected" | "full")
            }
            disabled={loading}
          >
            <option value="affected">
              Impacto registrado nas duas versões
            </option>
            <option value="full">
              Todos os testes observados na versão posterior
            </option>
          </select>
        </div>
        <button disabled={loading}>Planejar retestes</button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {loading && <Notice>Consultando impacto e arquivos de teste…</Notice>}
      <PlanResults
        plan={plan}
        onEvidence={onEvidence}
        onPage={(offset) =>
          setRequest((previous) =>
            previous ? { ...previous, offset } : undefined,
          )
        }
      />
    </section>
  );
}
