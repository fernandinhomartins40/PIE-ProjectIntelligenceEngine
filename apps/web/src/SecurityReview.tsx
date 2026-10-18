import { useEffect, useState } from "react";
import { api, type SecurityReview as Review } from "./api.js";
import { message, Notice, Pager } from "./components.js";

export function SecurityReview({
  snapshotId,
  onEvidence,
}: {
  snapshotId: string;
  onEvidence: (id: string) => void;
}) {
  const [review, setReview] = useState<Review>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setReview(undefined);
    setError("");
    setLoading(true);
    void api<Review>("security-review", {
      method: "POST",
      body: { snapshotId, offset, limit: 10 },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setReview(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [snapshotId, offset]);

  useEffect(() => setOffset(0), [snapshotId]);

  return (
    <section
      className="card investigation"
      aria-label="Segurança e privacidade"
    >
      <h2>Segurança, privacidade e proteção de receita</h2>
      <p>
        Findings estáticos são suspeitas e permanecem não verificados. A análise
        não executa o projeto nem certifica segurança ou conformidade legal.
      </p>
      {error && <Notice error>{error}</Notice>}
      {loading && <Notice>Analisando Evidence do snapshot…</Notice>}
      {review && (
        <>
          <Notice>
            Estado: {review.state}. {review.findings.total} findings suspeitos;
            runtime não verificado. Padrões de configuração de container:
            parcial.
          </Notice>
          <h3>Findings de segurança</h3>
          {review.findings.items.map((finding) => (
            <article className="card" key={finding.id}>
              <h4>{finding.kind}</h4>
              <p>{finding.condition}</p>
              <p>
                Severidade potencial: {finding.severity}; probabilidade: não
                avaliada. Estado: suspeito, reprodução não executada.
              </p>
              <p>
                Origem:{" "}
                <code>
                  {finding.source.path}:{finding.source.line}
                </code>
              </p>
              <p>Impacto potencial: {finding.impact}</p>
              <p>Observação: {finding.observation}</p>
              <p>Remediação proposta: {finding.remediation}</p>
              <h5>Reprodução proposta</h5>
              <ul>
                {finding.reproduction.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
              <h5>Incertezas</h5>
              <ul>
                {finding.uncertainty.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
              <h5>Regressões propostas</h5>
              <ul>
                {finding.regression.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
              <ul aria-label="Evidence relacionada ao finding">
                {finding.evidenceIds.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => onEvidence(id)}>
                      Consultar Evidence {id}
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {review.findings.total === 0 && (
            <Notice>
              Nenhum padrão coberto foi observado. Isso não comprova ausência de
              vulnerabilidades.
            </Notice>
          )}
          <Pager
            offset={review.findings.offset}
            total={review.findings.total}
            limit={10}
            onChange={setOffset}
          />
          <h3>Superfícies de autorização não verificadas</h3>
          {review.authorizationSurfaces.items.map((surface) => (
            <article className="card" key={surface.declaration.id}>
              <h4>{surface.declaration.name}</h4>
              <p>
                {surface.declaration.source.path}
                {surface.declaration.source.line
                  ? `:${surface.declaration.source.line}`
                  : ""}
              </p>
              <p>Autorização não verificada em runtime.</p>
              <ul>
                {surface.requiredChecks.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
              {surface.evidenceIds.map((id) => (
                <button key={id} type="button" onClick={() => onEvidence(id)}>
                  Consultar Evidence {id}
                </button>
              ))}
            </article>
          ))}
          <Pager
            offset={review.authorizationSurfaces.offset}
            total={review.authorizationSurfaces.total}
            limit={10}
            onChange={setOffset}
          />
          <details>
            <summary>Cobertura e limitações</summary>
            <ul>
              {review.coverage.limitations.map((value, index) => (
                <li key={index}>{value}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
