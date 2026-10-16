import { useEffect, useState } from "react";
import {
  api,
  type Context,
  type Discovery,
  type History,
  type Projects,
} from "./api.js";
import { message } from "./components.js";

export const PROJECT_PAGE_SIZE = 25;
export const HISTORY_PAGE_SIZE = 50;

/** Owns selected identities separately from the currently displayed catalog pages. */
export function useProjectNavigation() {
  const [context, setContext] = useState<Context>();
  const [projects, setProjects] = useState<Projects>();
  const [projectId, setProjectId] = useState("");
  const [history, setHistory] = useState<History>();
  const [snapshotId, setSnapshotId] = useState("");
  const [projectOffset, setProjectOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setProjectsLoading(true);
    void Promise.all([
      api<Context>("context", { signal: controller.signal }),
      api<Projects>(
        `projects?limit=${PROJECT_PAGE_SIZE}&offset=${projectOffset}`,
        { signal: controller.signal },
      ),
    ])
      .then(([ctx, list]) => {
        if (controller.signal.aborted) return;
        setContext(ctx);
        setProjects(list);
        setProjectId(
          (current) =>
            current ||
            list.items.find((item) => item.root === ctx.root)?.id ||
            list.items[0]?.id ||
            "",
        );
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setProjectsLoading(false);
      });
    return () => controller.abort();
  }, [refresh, projectOffset]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    void api<History>(
      `history/${projectId}?limit=${HISTORY_PAGE_SIZE}&offset=${historyOffset ?? 0}`,
      { signal: controller.signal },
    )
      .then(async (first) => {
        const latestOffset = Math.max(
          0,
          Math.floor((first.total - 1) / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE,
        );
        const list =
          historyOffset === null && latestOffset > 0
            ? await api<History>(
                `history/${projectId}?limit=${HISTORY_PAGE_SIZE}&offset=${latestOffset}`,
                { signal: controller.signal },
              )
            : first;
        if (controller.signal.aborted) return;
        setHistory(list);
        setSnapshotId((current) => current || list.items.at(-1)?.id || "");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [projectId, refresh, historyOffset]);
  function selectProject(id: string) {
    setProjectId(id);
    setHistory(undefined);
    setHistoryOffset(null);
    setSnapshotId("");
  }
  async function investigate() {
    setBusy(true);
    setError("");
    try {
      const result = await api<Discovery>("discover", {
        method: "POST",
        body: {},
      });
      setProjectId(result.project.id);
      setSnapshotId(result.snapshot.id);
      setHistoryOffset(null);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return {
    context,
    projects,
    projectId,
    history,
    snapshotId,
    busy,
    projectsLoading,
    historyLoading,
    error,
    selectProject,
    selectSnapshot: setSnapshotId,
    projectPage: setProjectOffset,
    historyPage: setHistoryOffset,
    investigate,
    retry: () => {
      setError("");
      setRefresh((value) => value + 1);
    },
  };
}
