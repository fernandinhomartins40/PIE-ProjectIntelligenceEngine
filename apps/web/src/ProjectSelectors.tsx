import { date, Pager } from "./components.js";
import {
  HISTORY_PAGE_SIZE,
  PROJECT_PAGE_SIZE,
  type useProjectNavigation,
} from "./useProjectNavigation.js";

type Navigation = ReturnType<typeof useProjectNavigation>;
export function ProjectSelectors({ navigation }: { navigation: Navigation }) {
  return (
    <section
      className="selectors card"
      aria-label="Seleção de projeto e histórico"
    >
      <ProjectSelect navigation={navigation} />
      <SnapshotSelect navigation={navigation} />
    </section>
  );
}
function ProjectSelect({ navigation: n }: { navigation: Navigation }) {
  return (
    <div role="group" aria-label="Projetos">
      <label htmlFor="project">Histórico do projeto</label>
      <select
        id="project"
        value={n.projectId}
        onChange={(event) => n.selectProject(event.target.value)}
        disabled={!n.projects?.items.length || n.busy || n.projectsLoading}
      >
        <option value="">Nenhum projeto investigado</option>
        {n.projectId &&
          !n.projects?.items.some((item) => item.id === n.projectId) && (
            <option value={n.projectId}>
              Projeto selecionado · {n.projectId.slice(0, 8)}
            </option>
          )}
        {n.projects?.items.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {n.projectsLoading && <p role="status">Carregando projetos…</p>}
      {n.projects && n.projects.total > PROJECT_PAGE_SIZE && (
        <fieldset disabled={n.projectsLoading || n.busy}>
          <legend className="sr-only">Páginas de projetos</legend>
          <Pager
            offset={n.projects.offset}
            total={n.projects.total}
            limit={PROJECT_PAGE_SIZE}
            onChange={n.projectPage}
          />
        </fieldset>
      )}
    </div>
  );
}
function SnapshotSelect({ navigation: n }: { navigation: Navigation }) {
  return (
    <div role="group" aria-label="Snapshots">
      <label htmlFor="snapshot">Snapshot observado</label>
      <select
        id="snapshot"
        value={n.snapshotId}
        onChange={(event) => n.selectSnapshot(event.target.value)}
        disabled={!n.history?.items.length || n.busy || n.historyLoading}
      >
        <option value="">Selecione uma observação</option>
        {n.snapshotId &&
          !n.history?.items.some((item) => item.id === n.snapshotId) && (
            <option value={n.snapshotId}>
              Snapshot selecionado · {n.snapshotId.slice(0, 8)}
            </option>
          )}
        {n.history?.items.map((item) => (
          <option key={item.id} value={item.id}>
            {date(item.created_at)} · {item.id.slice(0, 8)}
          </option>
        ))}
      </select>
      {n.historyLoading && <p role="status">Carregando histórico…</p>}
      {n.history && n.history.total > HISTORY_PAGE_SIZE && (
        <fieldset disabled={n.historyLoading || n.busy}>
          <legend className="sr-only">Páginas de snapshots</legend>
          <Pager
            offset={n.history.offset}
            total={n.history.total}
            limit={HISTORY_PAGE_SIZE}
            onChange={n.historyPage}
          />
        </fieldset>
      )}
    </div>
  );
}
