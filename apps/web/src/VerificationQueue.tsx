import { useVerificationQueue } from "./useVerificationQueue.js";
import { Notice } from "./components.js";

const labels = {
  queued: "Na fila",
  running: "Em execução",
  cancelling: "Cancelamento solicitado",
  succeeded: "Workflow concluído",
  failed: "Workflow falhou ou foi interrompido",
  cancelled: "Cancelado",
};

function JobDetails({
  queue,
}: {
  queue: ReturnType<typeof useVerificationQueue>;
}) {
  return (
    <>
      {queue.job && (
        <article aria-label="Job de verificação">
          <h3>{labels[queue.job.state]}</h3>
          <dl>
            <dt>Job / execução</dt>
            <dd className="path">{queue.job.id}</dd>
            <dt>Tentativas</dt>
            <dd>
              {queue.job.attempts} de {queue.job.maxAttempts}
            </dd>
            <dt>Último código informado</dt>
            <dd>{queue.job.errorCode ?? "Nenhum"}</dd>
          </dl>
          {queue.job.state === "succeeded" && (
            <Notice>
              Workflow concluído não significa testes aprovados. Atualize o
              histórico de verificações e abra o resultado correspondente ao ID
              deste job.
            </Notice>
          )}
          {["queued", "running", "cancelling"].includes(queue.job.state) && (
            <button
              disabled={queue.busy || queue.lookup !== queue.job.id}
              onClick={() => void queue.request("cancel")}
            >
              Solicitar cancelamento
            </button>
          )}
        </article>
      )}
    </>
  );
}

export function VerificationQueue({ snapshotId }: { snapshotId: string }) {
  const queue = useVerificationQueue(snapshotId);
  return (
    <section className="card investigation" aria-label="Fila de verificação">
      <h2>Autorizar e acompanhar verificação</h2>
      <p>
        Envie uma autorização VERIFY completa para este snapshot. O worker
        executará somente os testes autorizados em ambiente isolado. Não há
        repetição automática após interrupção.
      </p>
      {queue.error && <Notice error>{queue.error}</Notice>}
      {!queue.enabled ? (
        <Notice>Enfileiramento VERIFY não habilitado neste servidor.</Notice>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void queue.request("enqueue");
          }}
        >
          <label htmlFor="verify-authorization">
            Autorização VERIFY em JSON
          </label>
          <textarea
            id="verify-authorization"
            className="authorization-input"
            rows={8}
            maxLength={16384}
            required
            value={queue.authorization}
            onChange={(event) => queue.setAuthorization(event.target.value)}
            disabled={queue.busy}
          />
          <label htmlFor="verify-key">Chave idempotente da solicitação</label>
          <input
            id="verify-key"
            maxLength={200}
            required
            value={queue.key}
            onChange={(event) => queue.setKey(event.target.value)}
            disabled={queue.busy}
          />
          <p>
            Reutilize a mesma chave para consultar uma tentativa de envio
            incerta. Alterar a autorização exige outra chave. O formulário não
            salva dados no navegador; o grant enviado fica preservado no job.
          </p>
          <button type="submit" disabled={queue.busy}>
            Autorizar e enfileirar testes
          </button>
          <Notice>
            Enfileirar não inicia testes imediatamente. Um worker VERIFY
            separado precisa consumir o job. O resultado será publicado no
            histórico após a execução.
          </Notice>
        </form>
      )}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void queue.request("read");
        }}
      >
        <div>
          <label htmlFor="verify-job">UUID do job VERIFY</label>
          <input
            id="verify-job"
            required
            value={queue.lookup}
            onChange={(event) => {
              queue.setLookup(event.target.value);
            }}
            disabled={queue.busy}
          />
        </div>
        <button disabled={queue.busy}>Consultar job</button>
      </form>
      <JobDetails queue={queue} />
    </section>
  );
}
