import { useEffect, useState } from "react";
import {
  api,
  setCsrf,
  type Context,
  type Discovery,
  type History,
  type Projects,
  type Session,
} from "./api.js";
import { date, message, Notice } from "./components.js";
import { Investigation } from "./Investigation.js";

const signedOut: Session = {
  authenticated: false,
  csrfToken: null,
  expiresAt: null,
};

export function App() {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<Session>("session", { signal: controller.signal })
      .then((value) => {
        setCsrf(value.csrfToken);
        setSession(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(message(cause));
          setSession(signedOut);
        }
      });
    const expired = () => {
      setCsrf(null);
      setSession(signedOut);
      setError("Sua sessão expirou. Conecte novamente.");
    };
    window.addEventListener("pie-session-expired", expired);
    return () => {
      controller.abort();
      window.removeEventListener("pie-session-expired", expired);
    };
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = await api<Session>("session", {
        method: "POST",
        body: { token },
      });
      setCsrf(value.csrfToken);
      setSession(value);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setToken("");
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api("session", { method: "DELETE" });
      setCsrf(null);
      setSession(signedOut);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <div>
            <strong>PIE</strong>
            <span>Project Intelligence Engine</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="badge">Local · Somente leitura</span>
          {session?.authenticated && (
            <button onClick={() => void logout()} disabled={busy}>
              Sair
            </button>
          )}
        </div>
      </header>
      <main id="conteudo">
        {!session && <Notice>Conectando ao serviço local…</Notice>}
        {!session?.authenticated && session && (
          <section className="login card">
            <p className="eyebrow">CONEXÃO LOCAL</p>
            <h1>Entenda seu projeto com evidências.</h1>
            <p>
              Conecte ao PIE iniciado nesta máquina para investigar arquivos,
              relações e histórico do seu projeto.
            </p>
            <form onSubmit={(event) => void login(event)}>
              <label htmlFor="token">Credencial do serviço local</label>
              <input
                id="token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                minLength={32}
                maxLength={512}
                required
                spellCheck={false}
              />
              <p className="hint">
                Use a credencial definida em PIE_API_TOKEN ao iniciar o serviço.
              </p>
              <button className="primary" disabled={busy}>
                {busy ? "Conectando…" : "Conectar ao PIE"}
              </button>
            </form>
            <p className="hint">
              A credencial não é salva pelo painel. A sessão é encerrada ao sair
              ou expirar.
            </p>
          </section>
        )}
        {error && <Notice error>{error}</Notice>}
        {session?.authenticated && <Dashboard />}
      </main>
      <footer>
        Observação estática não comprova funcionamento. Cada resultado mantém
        suas fontes e limitações.
      </footer>
    </>
  );
}

function Dashboard() {
  const [context, setContext] = useState<Context>();
  const [projects, setProjects] = useState<Projects>();
  const [projectId, setProjectId] = useState("");
  const [history, setHistory] = useState<History>();
  const [snapshotId, setSnapshotId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api<Context>("context", { signal: controller.signal }),
      api<Projects>("projects?limit=200", { signal: controller.signal }),
    ])
      .then(([ctx, list]) => {
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
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    setSnapshotId("");
    setHistory(undefined);
  }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void api<History>(`history/${projectId}?limit=50`, {
      signal: controller.signal,
    })
      .then(async (first) => {
        const list =
          first.total > 50
            ? await api<History>(
                `history/${projectId}?limit=50&offset=${first.total - 50}`,
                { signal: controller.signal },
              )
            : first;
        if (!controller.signal.aborted) {
          setHistory(list);
          setSnapshotId((current) =>
            list.items.some((item) => item.id === current)
              ? current
              : (list.items.at(-1)?.id ?? ""),
          );
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [projectId, refresh]);
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
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
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
          onClick={() => void investigate()}
        >
          {busy ? "Investigando arquivos…" : "Nova investigação"}
        </button>
      </section>
      {error && (
        <Notice error>
          {error}{" "}
          <button
            onClick={() => {
              setError("");
              setRefresh((value) => value + 1);
            }}
          >
            Tentar novamente
          </button>
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
      <section className="selectors card">
        <div>
          <label htmlFor="project">Histórico do projeto</label>
          <select
            id="project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            disabled={!projects?.items.length || busy}
          >
            <option value="">Nenhum projeto investigado</option>
            {projects?.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {projects && projects.total > projects.items.length && (
            <p className="hint">
              Exibindo os primeiros 200 projetos. A CLI permite consultar as
              demais páginas.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="snapshot">Snapshot observado</label>
          <select
            id="snapshot"
            value={snapshotId}
            onChange={(event) => setSnapshotId(event.target.value)}
            disabled={!history?.items.length || busy}
          >
            <option value="">Selecione uma observação</option>
            {history?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {date(item.created_at)} · {item.id.slice(0, 8)}
              </option>
            ))}
          </select>
          {history && history.total > 50 && (
            <p className="hint">
              Últimos 50 snapshots do projeto. Histórico completo disponível
              pela CLI/API.
            </p>
          )}
        </div>
      </section>
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
          key={snapshotId}
          snapshotId={snapshotId}
          history={history?.items ?? []}
        />
      )}
    </>
  );
}
