import { openStore } from "./store.js";
import { PieError } from "./contracts.js";
import type { PiePersistence } from "./persistence.js";

export async function openPersistence(
  path: string,
  targetRoot?: string,
): Promise<PiePersistence> {
  const connection = process.env.PIE_DATABASE_URL;
  if (!connection) return openStore(path, targetRoot);
  const { PostgresPieStore } = await import("./postgresStore.js");
  const store = new PostgresPieStore(connection);
  try {
    await store.connect();
    return store;
  } catch {
    await store.close();
    throw new PieError(
      "IO_ERROR",
      "PostgreSQL indisponível; confira conexão e migrações. Não houve fallback silencioso para SQLite.",
    );
  }
}
