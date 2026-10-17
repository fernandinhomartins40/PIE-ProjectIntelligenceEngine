import type { FunctionalReview as Review } from "./api.js";
export function Finding({
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
      {finding.evidenceIds.map((evidenceId, index) => (
        <button key={evidenceId} onClick={() => onEvidence(evidenceId)}>
          {index === 0
            ? "Abrir prova da declaração"
            : `Abrir prova derivada ${index}`}
        </button>
      ))}
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
