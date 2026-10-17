import { useEffect, useState } from "react";
import { api, type InfrastructureReview as Review } from "./api.js";
import { message, Notice, Pager } from "./components.js";

export function InfrastructureReview({
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
    void api<Review>("infrastructure-review", {
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
      aria-label="Infraestrutura e performance"
    >
      <h2>Infraestrutura e performance</h2>
      <p>
        Inventário estático de serviços/dependências Compose e diretivas Nginx
        encontrados com Evidence. A configuração declarada não comprova runtime.
      </p>
      {error && <Notice error>{error}</Notice>}
      {loading && (
        <Notice>Consultando fatos de infraestrutura do snapshot…</Notice>
      )}
      {review && (
        <>
          <Notice>
            CPU, memória, disco, I/O, rede, p95, p99 e reinícios: NOT_MEASURED.
            Nenhum container ou serviço do alvo foi executado ou sondado.
          </Notice>
          {review.components.items.map((component) => (
            <article className="card" key={component.id}>
              <h3>
                {component.kind === "compose_service"
                  ? `Serviço ${component.name}`
                  : "Diretiva Nginx declarada"}
              </h3>
              <p>
                {component.kind === "compose_service" ? "Compose" : "Nginx"}:{" "}
                <code>{component.path}</code>
                {component.line ? `:${component.line}` : ""} · não verificado em
                runtime
              </p>
              {component.kind === "nginx_directive" && (
                <p>
                  <code>{component.name}</code>
                </p>
              )}
              <p>Redação de Evidence: {component.redactionStatus}</p>
              {component.evidenceLimitations.map((limitation) => (
                <p key={limitation}>{limitation}</p>
              ))}
              {component.dependencies.length > 0 && (
                <p>
                  Dependências declaradas:{" "}
                  {component.dependencies
                    .map((dependency) => dependency.name)
                    .join(", ")}
                  .
                </p>
              )}
              <button
                type="button"
                onClick={() => onEvidence(component.evidenceId)}
              >
                Consultar Evidence {component.evidenceId}
              </button>
              {component.dependencies.map((dependency) => (
                <button
                  key={dependency.evidenceId}
                  type="button"
                  onClick={() => onEvidence(dependency.evidenceId)}
                >
                  Evidence da dependência {dependency.name}
                </button>
              ))}
            </article>
          ))}
          {review.components.total === 0 && (
            <Notice>
              Nenhum fato Compose/Nginx suportado foi observado; isso não prova
              ausência de infraestrutura.
            </Notice>
          )}
          <Pager
            offset={review.components.offset}
            total={review.components.total}
            limit={10}
            onChange={setOffset}
          />
          <details>
            <summary>Limitações desta observação</summary>
            <ul>
              {review.coverage.limitations.map((limitation, index) => (
                <li key={index}>{limitation}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
