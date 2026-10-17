import type { PieService } from "../../../src/pie/service.js";

export type Projects = Awaited<ReturnType<PieService["projects"]>>;
export type History = Awaited<ReturnType<PieService["history"]>>;
export type Graph = Awaited<ReturnType<PieService["graph"]>>;
export type Declarations = Awaited<ReturnType<PieService["declarations"]>>;
export type Trace = Awaited<ReturnType<PieService["trace"]>>;
export type Comparison = Awaited<ReturnType<PieService["compare"]>>;
export type Evidence = Awaited<ReturnType<PieService["evidence"]>>;
export type FunctionalReview = Awaited<ReturnType<PieService["functional"]>>;
export type Discovery = Awaited<ReturnType<PieService["discover"]>>;
export type VerificationHistory = Awaited<
  ReturnType<PieService["verifications"]>
>;
export type VerificationRun = Awaited<ReturnType<PieService["verification"]>>;
export type Session = {
  authenticated: boolean;
  csrfToken: string | null;
  expiresAt: number | null;
};
export type Context = {
  root: string;
  profile: "OBSERVE";
  verificationEnabled: boolean;
  verificationQueueEnabled: boolean;
};

let csrf: string | null = null;
export const setCsrf = (value: string | null): void => {
  csrf = value;
};
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/v1/${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    signal: options.signal,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(csrf && options.method && options.method !== "GET"
        ? { "X-PIE-CSRF": csrf }
        : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const value = (await response.json()) as T & {
    error?: { message?: string; code?: string };
  };
  if (!response.ok) {
    if (response.status === 401 && path !== "session") {
      setCsrf(null);
      window.dispatchEvent(new Event("pie-session-expired"));
    }
    throw new Error(
      value.error?.message ??
        (response.status === 401
          ? "Credencial inválida ou sessão expirada."
          : response.status === 429
            ? "Muitas tentativas. Aguarde um minuto."
            : "Não foi possível concluir a operação."),
    );
  }
  return value;
}
