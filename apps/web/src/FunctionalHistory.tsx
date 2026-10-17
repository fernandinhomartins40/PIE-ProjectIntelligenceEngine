import type { FunctionalReview, FunctionalRecord } from "./api.js";
import { useFunctionalHistory } from "./useFunctionalHistory.js";
import { Notice, Pager, date } from "./components.js";
import { Finding } from "./FunctionalFinding.js";

function PreservedAnalysis({
  record,
  onEvidence,
}: {
  record: FunctionalRecord | undefined;
  onEvidence: (id: string) => void;
}) {
  return (
    <>
      {record && (
        <article aria-label="Análise funcional preservada">
          <h4>Registro histórico · não verificado</h4>
          <dl>
            <dt>ID</dt>
            <dd className="path">{record.id}</dd>
            <dt>SHA-256</dt>
            <dd className="path">{record.sha256}</dd>
            <dt>Módulo e página</dt>
            <dd>
              {record.request.modulePath || "Snapshot completo"} · offset{" "}
              {record.request.offset} · limite {record.request.limit}
            </dd>
          </dl>
          {record.result.findings.items.map((finding) => (
            <Finding
              key={finding.id}
              finding={finding}
              onEvidence={onEvidence}
            />
          ))}
          {!record.result.findings.items.length && (
            <Notice>
              Página preservada sem declarações. Isso não comprova ausência de
              funcionalidades.
            </Notice>
          )}
        </article>
      )}
    </>
  );
}

export function FunctionalHistory({
  snapshotId,
  review,
  onEvidence,
}: {
  snapshotId: string;
  review: FunctionalReview | undefined;
  onEvidence: (id: string) => void;
}) {
  const state = useFunctionalHistory(snapshotId, review);
  return (
    <section aria-label="Histórico funcional preservado">
      <h3>Análises funcionais preservadas</h3>
      <p>
        Salvar registra somente a página analisada. Cada salvamento explícito
        cria um registro histórico; não executa testes nem aprova
        funcionalidades.
      </p>
      <button
        disabled={!review || state.saving}
        onClick={() => {
          onEvidence("");
          void state.save();
        }}
      >
        Salvar página analisada
      </button>
      <button onClick={state.refresh} disabled={state.saving}>
        Atualizar histórico funcional
      </button>
      {state.error && <Notice error>{state.error}</Notice>}
      {state.saving && <Notice>Preservando análise…</Notice>}
      {state.history && (
        <>
          <div className="table-wrap">
            <table>
              <caption>Análises preservadas deste snapshot</caption>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Módulo</th>
                  <th>Página preservada</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {state.history.items.map((item) => (
                  <tr key={item.id}>
                    <td>{date(item.createdAt)}</td>
                    <td className="path">
                      {item.modulePath || "Snapshot completo"}
                    </td>
                    <td>
                      {item.count} de {item.total}, offset {item.offset}
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          onEvidence("");
                          state.setSelected(item.id);
                        }}
                      >
                        Abrir análise {item.id.slice(0, 8)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            offset={state.offset}
            total={state.history.total}
            limit={10}
            onChange={state.setOffset}
          />
          {!state.history.total && (
            <Notice>Nenhuma análise funcional preservada.</Notice>
          )}
        </>
      )}
      {state.selected && !state.record && !state.error && (
        <Notice>Carregando registro preservado…</Notice>
      )}
      <PreservedAnalysis record={state.record} onEvidence={onEvidence} />
    </section>
  );
}
