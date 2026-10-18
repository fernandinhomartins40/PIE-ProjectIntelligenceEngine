import { useEffect, useState } from "react";
import { api, type DataReview as Review } from "./api.js";
import { message, Notice, Pager } from "./components.js";

const selectorStates: Record<
  Review["migrations"]["items"][number]["selectors"]["state"],
  string
> = {
  not_declared: "Nenhum seletor único declarado",
  aligned_observed: "Colunas alinhadas nas fontes observadas",
  mismatch_observed: "Divergência observada entre as fontes",
  not_observed: "Seletor SQL não observado",
  inconclusive: "Comparação inconclusiva",
};

const migrationStates: Record<
  Review["migrations"]["items"][number]["state"],
  string
> = {
  no_migration_files_observed: "Nenhum arquivo de migration observado",
  table_not_observed: "Tabela não observada nas migrations",
  table_observed_without_unique_constraint:
    "Tabela observada sem constraint única reconhecida",
  unique_constraint_observed: "Constraint única observada",
  migration_inventory_incomplete: "Inventário de migrations incompleto",
};

const relationStates: Record<
  Review["relations"]["items"][number]["state"],
  string
> = {
  no_migration_files_observed: "Nenhum arquivo de migration observado",
  foreign_key_not_observed: "Chave estrangeira não observada",
  foreign_key_columns_observed:
    "Colunas da chave estrangeira alinhadas nas fontes observadas",
  foreign_key_columns_mismatch:
    "Divergência observada nas colunas da chave estrangeira",
  foreign_key_columns_unverified: "Colunas da chave estrangeira inconclusivas",
  migration_inventory_incomplete: "Inventário de migrations incompleto",
};

function EvidenceButtons({
  ids,
  onEvidence,
}: {
  ids: string[];
  onEvidence: (id: string) => void;
}) {
  return ids.length ? (
    <ul aria-label="Evidence relacionada">
      {ids.map((id) => (
        <li key={id}>
          <button type="button" onClick={() => onEvidence(id)}>
            Consultar Evidence {id}
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p>Evidence específica não disponível.</p>
  );
}

export function DataReview({
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
    void api<Review>("data-review", {
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
    <section className="card investigation" aria-label="Dados e integrações">
      <h2>Dados e integrações</h2>
      <p>
        Comparação estática entre declarações Prisma e fatos literais observados
        nas migrations do snapshot. Não consulta o banco nem calcula o estado
        final das migrations.
      </p>
      {error && <Notice error>{error}</Notice>}
      {loading && (
        <Notice>Comparando declarações e migrations observadas…</Notice>
      )}
      {review && (
        <>
          <Notice>
            Estado: não verificado em runtime. {review.coverage.examinedModels}{" "}
            modelos examinados; {review.coverage.migrationFiles} arquivos de
            migration observados. Resultados alinhados descrevem somente as
            fontes analisadas.
          </Notice>
          <h3>Seletores e migrations por modelo</h3>
          {review.migrations.items.length === 0 && (
            <p>Nenhum modelo observado neste snapshot.</p>
          )}
          {review.migrations.items.map((item) => (
            <article className="card" key={item.id}>
              <h4>{item.model.name}</h4>
              <p>{migrationStates[item.state]}</p>
              <p>
                Seletor: <strong>{selectorStates[item.selectors.state]}</strong>
              </p>
              {item.selectors.expected.map((selector, index) => (
                <p key={"expected-" + index}>
                  Esperado ({selector.kind}):{" "}
                  {selector.columns?.join(", ") ?? "colunas não comparáveis"}
                </p>
              ))}
              {item.selectors.observed.map((selector, index) => (
                <p key={"observed-" + index}>
                  Observado ({selector.kind}):{" "}
                  {selector.columns?.join(", ") ?? "colunas não comparáveis"}
                </p>
              ))}
              <EvidenceButtons ids={item.evidenceIds} onEvidence={onEvidence} />
              {item.uncertainty.map((limitation) => (
                <p key={limitation}>{limitation}</p>
              ))}
            </article>
          ))}
          <Pager
            offset={review.migrations.offset}
            total={review.migrations.total}
            limit={10}
            onChange={setOffset}
          />
          <h3>Relações Prisma e chaves estrangeiras</h3>
          {review.relations.items.map((item) => (
            <article className="card" key={item.id}>
              <h4>
                {item.relation.parent} → {item.relation.name}
              </h4>
              <p>{relationStates[item.state]}</p>
              <EvidenceButtons ids={item.evidenceIds} onEvidence={onEvidence} />
              {item.uncertainty.map((limitation) => (
                <p key={limitation}>{limitation}</p>
              ))}
            </article>
          ))}
          <Pager
            offset={review.relations.offset}
            total={review.relations.total}
            limit={10}
            onChange={setOffset}
          />
          <h3>Modelos sem seletor declarado</h3>
          {review.models.items.map((item) => (
            <article className="card" key={item.id}>
              <h4>{item.model.name}</h4>
              <p>{item.observation}</p>
              <EvidenceButtons ids={item.evidenceIds} onEvidence={onEvidence} />
              {item.uncertainty.map((limitation) => (
                <p key={limitation}>{limitation}</p>
              ))}
            </article>
          ))}
          <Pager
            offset={review.models.offset}
            total={review.models.total}
            limit={10}
            onChange={setOffset}
          />
          {review.coverage.limitations.map((limitation) => (
            <p key={limitation}>{limitation}</p>
          ))}
        </>
      )}
    </section>
  );
}
