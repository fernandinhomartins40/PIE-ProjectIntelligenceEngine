import { useEffect, useState } from "react";
import { api, setCsrf, type Session } from "./api.js";
import { message, Notice } from "./components.js";
import { Dashboard } from "./Dashboard.js";

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
