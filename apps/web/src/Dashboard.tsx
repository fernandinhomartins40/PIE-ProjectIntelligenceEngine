import { Notice } from "./components.js";
import { Investigation } from "./Investigation.js";
import { ProjectSelectors } from "./ProjectSelectors.js";
import { useProjectNavigation } from "./useProjectNavigation.js";

export function Dashboard() {
  const navigation = useProjectNavigation();
  const { context, projectId, snapshotId, history, busy, error } = navigation;
  return (
    <>
      <section className="intro">
        <div>
          <p className="eyebrow">INTELIGÊNCIA COM PROCEDÊNCIA</p>
          <h1>Investigue. Rastreie. Confira.</h1>
          <p>Uma visão do que foi observado, com histórico e limites claros.</p>
        </div>
        <button
          className="primary"
          disabled={busy || !context}
          onClick={() => void navigation.investigate()}
        >
          {busy ? "Investigando arquivos…" : "Nova investigação"}
        </button>
      </section>
      {error && (
        <Notice error>
          {error} <button onClick={navigation.retry}>Tentar novamente</button>
        </Notice>
      )}
      {busy && (
        <Notice>
          Leitura dos arquivos rastreados e declarações em andamento. Nenhum
          código do projeto será executado.
        </Notice>
      )}
      <section className="card scope">
        <div>
          <span className="eyebrow">PROJETO AUTORIZADO PARA INVESTIGAÇÃO</span>
          <p className="path">{context?.root ?? "Carregando projeto…"}</p>
        </div>
        <span className="badge">OBSERVE</span>
      </section>
      <ProjectSelectors navigation={navigation} />
      {!snapshotId && (
        <section className="card empty">
          <h2>Comece pela primeira investigação</h2>
          <p>
            O PIE vai ler o projeto autorizado e registrar o que encontrar. Seus
            dados aparecerão aqui, sem conteúdo de demonstração.
          </p>
        </section>
      )}
      {snapshotId && (
        <Investigation
          key={`${projectId}-${snapshotId}`}
          projectId={projectId}
          snapshotId={snapshotId}
          history={history?.items ?? []}
        />
      )}
    </>
  );
}
