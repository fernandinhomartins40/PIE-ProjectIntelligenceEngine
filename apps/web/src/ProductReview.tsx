import { Notice, Pager } from "./components.js";
import { useProductReview } from "./useProductReview.js";

export function ProductReview({ snapshotId }: { snapshotId: string }) {
  const { modulePath, setModulePath, setRequest, review, error, loading } =
    useProductReview(snapshotId);
  return (
    <section
      className="card investigation"
      aria-label="Análise de produto e UX"
    >
      <h2>Oportunidades de produto e UX</h2>
      <p>
        Este snapshot contém declarações estáticas, não jornadas observadas. O
        relatório aponta as evidências que faltam; não presume fricção,
        acessibilidade ou melhoria a partir do código.
      </p>
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          setRequest((previous) => ({
            modulePath,
            offset: 0,
            revision: (previous?.revision ?? 0) + 1,
          }));
        }}
      >
        <div>
          <label htmlFor="product-module">Módulo relativo (opcional)</label>
          <input
            id="product-module"
            maxLength={1000}
            value={modulePath}
            onChange={(event) => setModulePath(event.target.value)}
            disabled={loading}
          />
        </div>
        <button disabled={loading}>Analisar evidências de produto</button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {loading && <Notice>Consultando snapshot e evidências…</Notice>}
      {review && (
        <>
          <Notice>
            Evidência insuficiente para confirmar oportunidades.{" "}
            {review.scope.declaredTargets} declarações no escopo{" "}
            {review.scope.modulePath || "do snapshot completo"}; nenhuma jornada
            foi observada.
          </Notice>
          {review.opportunities.items.map((item) => (
            <article className="card" key={item.id}>
              <h3>{item.declaration.name}</h3>
              <p>
                Origem: <code>{item.declaration.source.path}</code>
                {item.declaration.source.line
                  ? `:${item.declaration.source.line}`
                  : ""}
              </p>
              <p>Estado: evidência insuficiente; jornada não observada.</p>
              <p>Movimentos: ainda não avaliados.</p>
              <h4>Evidências necessárias</h4>
              <ul>
                {item.missingEvidence.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </article>
          ))}
          {review.opportunities.total === 0 && (
            <Notice>
              Nenhuma página ou endpoint declarado neste escopo. Isso não prova
              ausência de uma jornada ou funcionalidade.
            </Notice>
          )}
          <div role="group" aria-label="Paginação das evidências de produto">
            <Pager
              offset={review.opportunities.offset}
              total={review.opportunities.total}
              limit={10}
              onChange={(offset) =>
                setRequest((previous) =>
                  previous ? { ...previous, offset } : undefined,
                )
              }
            />
          </div>
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
