import { useEffect, useState } from "react";
import { api, type InfrastructureReview as Review } from "./api.js";
import { message, Notice, Pager } from "./components.js";

type SettingKey =
  Review["components"]["items"][number]["settings"][number]["key"];

function settingLabel(key: SettingKey): string {
  switch (key) {
    case "image":
      return "Imagem";
    case "port":
      return "Porta";
    case "restart":
      return "Reinício";
    case "healthcheck":
      return "Healthcheck";
    case "build_context":
      return "Contexto de build";
    case "build_dockerfile":
      return "Dockerfile declarado";
    case "build_inline":
      return "Dockerfile inline";
    case "replicas":
      return "Réplicas declaradas";
    case "cpus_limit":
      return "CPU (limite declarado)";
    case "memory_limit":
      return "Memória (limite declarado)";
    case "pids_limit":
      return "PIDs (limite declarado)";
    case "cpus_reservation":
      return "CPU (reserva declarada)";
    case "memory_reservation":
      return "Memória (reserva declarada)";
    case "pids_reservation":
      return "PIDs (reserva declarada)";
    case "volume_mount":
      return "Montagem de volume declarada";
    case "volume_definition":
      return "Volume Compose declarado";
    case "environment_key":
      return "Variável de ambiente declarada";
    case "env_file":
      return "Arquivo env declarado";
    case "secret_mount":
      return "Referência de secret declarada";
    case "config_mount":
      return "Referência de config declarada";
    case "secret_definition":
      return "Definição de secret declarada";
    case "config_definition":
      return "Definição de config declarada";
    case "profile":
      return "Perfil Compose declarado";
    case "depends_on_options":
      return "Opções de dependência declaradas";
    case "include_path":
      return "Arquivo Compose incluído";
    case "include_project_directory":
      return "Diretório de projeto do include";
    case "extends_reference":
      return "Serviço Compose estendido";
    case "network_mode":
      return "Modo de rede declarado";
    case "privileged_mode":
      return "Modo privilegiado declarado";
    case "capability_add":
      return "Capability adicionada";
    case "capability_drop":
      return "Capability removida";
    case "network_attachment":
      return "Rede declarada no servi??o";
    case "network_definition":
      return "Rede Compose declarada";
  }
}

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
        Inventário estático de serviços, imagem, portas, política de reinício e
        presença de healthcheck declarados no Compose, além de diretivas Nginx
        com Evidence. A configuração declarada não comprova runtime.
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
            <article
              aria-label={
                component.kind === "compose_service"
                  ? `Serviço ${component.name}`
                  : component.kind === "nginx_directive"
                    ? `Diretiva Nginx ${component.name}`
                    : component.kind === "compose_volume"
                      ? `Volume Compose ${component.name}`
                      : component.kind === "compose_resource"
                        ? `Recurso Compose ${component.name}`
                        : "Configuração Compose incluída"
              }
              className="card"
              key={component.id}
            >
              <h3>
                {component.kind === "compose_service"
                  ? `Serviço ${component.name}`
                  : component.kind === "nginx_directive"
                    ? "Diretiva Nginx declarada"
                    : component.kind === "compose_volume"
                      ? `Volume Compose ${component.name}`
                      : component.kind === "compose_resource"
                        ? `Recurso Compose ${component.name}`
                        : "Configuração Compose incluída"}
              </h3>
              <p>
                {component.kind === "nginx_directive" ? "Nginx" : "Compose"}:{" "}
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
              {component.kind === "compose_service" && (
                <ul aria-label="Montagens Compose declaradas">
                  {component.settings
                    .filter((setting) => setting.key === "volume_mount")
                    .map((setting, index) => (
                      <li key={`${setting.evidenceId}:${index}`}>
                        <code>{setting.value}</code> · não verificado em runtime{" "}
                        <button
                          type="button"
                          onClick={() => onEvidence(setting.evidenceId)}
                        >
                          Evidence
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {(component.kind === "compose_volume" ||
                component.kind === "compose_resource") && (
                <p>
                  Definição declarada:{" "}
                  <code>{component.settings[0]?.value}</code>{" "}
                  <button
                    type="button"
                    onClick={() => onEvidence(component.evidenceId)}
                  >
                    Evidence
                  </button>
                </p>
              )}
              {component.kind === "compose_service" &&
                component.builds.map((build, index) => (
                  <div key={`${component.id}:build:${index}`}>
                    <p>
                      Build declarado: contexto <code>{build.context}</code>
                      {build.dockerfile && (
                        <>
                          , Dockerfile <code>{build.dockerfile}</code>
                        </>
                      )}
                    </p>
                    {build.candidatePath && (
                      <p>
                        Caminho candidato no repositório:{" "}
                        <code>{build.candidatePath}</code>
                      </p>
                    )}
                    <p>
                      {build.dockerfileObservation === "observed_in_snapshot"
                        ? "Dockerfile observado no snapshot"
                        : build.dockerfileObservation ===
                            "not_observed_in_snapshot"
                          ? "Dockerfile não observado neste snapshot; ausência não confirmada"
                          : build.dockerfileObservation ===
                              "inline_content_not_retained"
                            ? "Dockerfile inline declarado; conteúdo não retido"
                            : "Referência de Dockerfile não resolvida"}
                    </p>
                    <p>
                      {build.dockerfileAnalysis === "static_facts_observed"
                        ? "Fatos estáticos selecionados observados; comportamento de build não verificado"
                        : build.dockerfileAnalysis ===
                            "file_observed_no_supported_facts"
                          ? "Arquivo observado sem fatos suportados no snapshot; isso não comprova arquivo vazio"
                          : build.dockerfileAnalysis ===
                              "inline_content_not_retained"
                            ? "Conteúdo inline não retido para análise"
                            : build.dockerfileAnalysis ===
                                "not_observed_in_snapshot"
                              ? "Arquivo não observado; conteúdo permanece desconhecido"
                              : "Análise do Dockerfile não resolvida"}
                    </p>
                    {build.dockerfileAnalysis === "static_facts_observed" && (
                      <ul aria-label="Instruções Dockerfile observadas">
                        {build.instructions.map(
                          (instruction, instructionIndex) => (
                            <li
                              key={`${instruction.evidenceId}:${instructionIndex}`}
                            >
                              {instruction.instruction}
                              {instruction.value !== null && (
                                <>
                                  : <code>{instruction.value}</code>
                                </>
                              )}
                              {instruction.stage !== null &&
                                ` · estágio ${instruction.stage + 1}`}
                              {` · linha ${instruction.line} · `}
                              <button
                                type="button"
                                onClick={() =>
                                  onEvidence(instruction.evidenceId)
                                }
                              >
                                Evidence da instrução
                              </button>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                    {build.evidenceIds.map((evidenceId) => (
                      <button
                        key={evidenceId}
                        type="button"
                        onClick={() => onEvidence(evidenceId)}
                      >
                        Evidence do build
                      </button>
                    ))}
                  </div>
                ))}
              {component.settings.length > 0 && (
                <ul aria-label="Configurações Compose declaradas">
                  {component.settings.map((setting) => (
                    <li key={setting.evidenceId}>
                      {settingLabel(setting.key)}: <code>{setting.value}</code>{" "}
                      ·{" "}
                      <button
                        type="button"
                        onClick={() => onEvidence(setting.evidenceId)}
                      >
                        Evidence
                      </button>
                    </li>
                  ))}
                </ul>
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
