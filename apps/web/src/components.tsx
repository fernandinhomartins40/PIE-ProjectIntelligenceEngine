import type { ReactNode } from "react";

export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={error ? "notice error" : "notice"}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Pager({
  offset,
  total,
  limit,
  onChange,
}: {
  offset: number;
  total: number;
  limit: number;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {total === 0
          ? "Nenhum registro"
          : `${offset + 1}–${Math.min(offset + limit, total)} de ${total}`}
      </span>
      <button
        onClick={() => onChange(Math.max(0, offset - limit))}
        disabled={offset === 0}
      >
        Anterior
      </button>
      <button
        onClick={() => onChange(offset + limit)}
        disabled={offset + limit >= total}
      >
        Próxima
      </button>
    </div>
  );
}
export const date = (value: string): string =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
export const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Falha de conexão. Tente novamente.";
