import { useFunctionalReview } from "./useFunctionalReview.js";
import type { FunctionalReview as Review } from "./api.js";
import { Notice, Pager } from "./components.js";

function Finding({
  finding,
  onEvidence,
}: {
  finding: Review["findings"]["items"][number];
  onEvidence: (id: string) => void;
}) {
  return (
    <article className="card" aria-label={`Lacuna ${finding.declaration.name}`}>
      <h3>{finding.declaration.name}</h3>
      <p>{finding.observation}</p>
      <dl>
        <dt>Estado</dt>
        <dd>Não verificado · informativo</dd>
        <dt>Fonte</dt>
        <dd className="path">
          {finding.declaration.source.path}:
          {finding.declaration.source.line ?? "linha não informada"}
        </dd>
        <dt>Responsável</dt>
        <dd>Não definido</dd>
      </dl>
      <button onClick={() => onEvidence(finding.evidenceIds[0]!)}>
        Abrir prova da declaração
      </button>
      <details>
        <summary>Incertezas e validação proposta</summary>
        <h4>Incertezas</h4>
        <ul>
          {finding.uncertainty.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
        <h4>Reprodução proposta</h4>
        <ol>
          {finding.reproduction.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ol>
        <h4>Proposta</h4>
        <p>{finding.proposal}</p>
        <h4>Critérios de validação</h4>
        <ul>
          {finding.acceptance.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function FunctionalReview({ snapshotId }: { snapshotId: string }) {
  const {
    modulePath,
    setModulePath,
    setRequest,
    review,
    proof,
    setProofId,
    error,
    loading,
  } = useFunctionalReview(snapshotId);
  return (
    <section
      className="card investigation"
      aria-label="Análise funcional estática"
    >
      <h2>Lacunas de verificação funcional</h2>
      <p>
        Páginas e endpoints declarados ainda exigem cenários de execução. Esta
        análise não executa testes nem comprova defeitos ou funcionamento.
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
          <label htmlFor="functional-module">Módulo relativo (opcional)</label>
          <input
            id="functional-module"
            maxLength={1000}
            value={modulePath}
            onChange={(event) => setModulePath(event.target.value)}
            disabled={loading}
          />
        </div>
        <button disabled={loading}>Analisar lacunas funcionais</button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {loading && <Notice>Consultando declarações e evidências…</Notice>}
      {review && (
        <>
          <Notice>
            Não verificado em execução. {review.scope.declaredTargets}{" "}
            declarações no escopo{" "}
            {review.scope.modulePath || "do snapshot completo"}.
          </Notice>
          {review.findings.items.map((finding) => (
            <Finding
              key={finding.id}
              finding={finding}
              onEvidence={setProofId}
            />
          ))}
          {review.findings.total === 0 && (
            <Notice>
              Nenhuma página ou endpoint declarado neste escopo. Isso não prova
              ausência de funcionalidade.
            </Notice>
          )}
          <Pager
            offset={review.findings.offset}
            total={review.findings.total}
            limit={10}
            onChange={(offset) =>
              setRequest((previous) =>
                previous ? { ...previous, offset } : undefined,
              )
            }
          />
          <details>
            <summary>Cobertura e limitações da análise</summary>
            <ul>
              {review.coverage.limitations.map((value, index) => (
                <li key={index}>{value}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      {proof && (
        <aside aria-label="Prova da análise funcional">
          <h3>Evidência da declaração</h3>
          <dl>
            <dt>Identificador</dt>
            <dd className="path">{proof.id}</dd>
            <dt>SHA-256</dt>
            <dd className="path">{proof.sha256}</dd>
            <dt>Observação</dt>
            <dd>{proof.observation}</dd>
            <dt>Estado</dt>
            <dd>{proof.state}</dd>
          </dl>
        </aside>
      )}
    </section>
  );
}
