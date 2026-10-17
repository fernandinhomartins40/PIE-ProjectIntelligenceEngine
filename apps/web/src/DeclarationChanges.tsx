import type { Comparison } from "./api.js";

const labels = {
  observed_only_before: "Observada somente antes — remoção não comprovada",
  observed_only_after:
    "Observada somente depois — adição de comportamento não comprovada",
  source_changed: "Arquivo de origem alterado — comportamento não verificado",
  relocated: "Linha de origem diferente",
  ambiguous: "Ocorrências ambíguas — sem alinhamento presumido",
};
type Fact = Comparison["declarationChanges"]["items"][number]["before"][number];
function Observations({
  facts,
  version,
  onEvidence,
}: {
  facts: Fact[];
  version: string;
  onEvidence: (id: string) => void;
}) {
  return (
    <ul>
      {facts.map((fact) => (
        <li key={fact.id}>
          <span className="path">
            {fact.name} · {fact.source.path}:
            {fact.source.line ?? "linha não informada"}
          </span>
          <p>
            {fact.adapter} · {fact.kind} · contexto:{" "}
            {fact.parent ?? "não informado"}
          </p>
          <button onClick={() => onEvidence(fact.evidenceId)}>
            Prova {version} · {fact.id.slice(0, 8)}
          </button>
          {fact.derivations.map((item) => (
            <button
              key={item.evidenceId}
              onClick={() => onEvidence(item.evidenceId)}
            >
              Montagem {version} · linha {item.line} · prefixo{" "}
              {item.prefix || "/"}
            </button>
          ))}
        </li>
      ))}
      {facts.length === 0 && <li>Não observada nesta versão.</li>}
    </ul>
  );
}
export function DeclarationChanges({
  comparison,
  onEvidence,
}: {
  comparison: Comparison;
  onEvidence: (id: string) => void;
}) {
  return (
    <section aria-label="Mudanças de declarações">
      <h3>Declarações comparadas</h3>
      <p>
        {comparison.declarationChanges.total} diferenças de observação. Ausência
        de declaração não prova remoção de funcionalidade; alteração do arquivo
        não prova mudança no handler.
      </p>
      <div className="table-wrap">
        <table>
          <caption>Diferenças das declarações por versão</caption>
          <thead>
            <tr>
              <th>Observação</th>
              <th>Antes</th>
              <th>Depois</th>
            </tr>
          </thead>
          <tbody>
            {comparison.declarationChanges.items.map((item) => (
              <tr key={item.key}>
                <td>{labels[item.state]}</td>
                <td>
                  <Observations
                    facts={item.before}
                    version="anterior"
                    onEvidence={onEvidence}
                  />
                </td>
                <td>
                  <Observations
                    facts={item.after}
                    version="posterior"
                    onEvidence={onEvidence}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!comparison.declarationChanges.total && (
        <p>
          Nenhuma diferença nas declarações registradas; isso não comprova
          ausência de regressão.
        </p>
      )}
    </section>
  );
}
