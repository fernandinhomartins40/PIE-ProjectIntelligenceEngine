import { openStore, readStoredSnapshot } from "./store.js";
import { PieError } from "./contracts.js";
import type { PiePersistence } from "./persistence.js";
import { admitNodeTests } from "./execution/admission.js";
import type { NodeTestGrant } from "./execution/contracts.js";

/** Resolve actual snapshot authority before any local migration can write state. */
export async function openVerificationPersistence(
  path: string,
  grant: NodeTestGrant,
) {
  let store: PiePersistence | undefined;
  try {
    if (process.env.PIE_DATABASE_URL) store = await openPersistence(path);
    const snapshot = store
      ? await store.snapshot(grant.snapshotId)
      : readStoredSnapshot(path, grant.snapshotId);
    const admission = await admitNodeTests(grant, snapshot);
    if (!admission.ok) throw admission.error;
    store ??= await openStore(path, snapshot.root);
    await store.assertOutside(snapshot.root);
    return { store, snapshot };
  } catch (cause) {
    await store?.close();
    throw cause;
  }
}

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
    const { missingTables } = await store.inspectSchema();
    if (missingTables.length > 0)
      throw new PieError(
        "IO_ERROR",
        `PostgreSQL conectado, mas faltam ${missingTables.length} tabela(s) do schema PIE; migrations devem ser aplicadas explicitamente.`,
      );
    return store;
  } catch {
    await store.close();
    throw new PieError(
      "IO_ERROR",
      "PostgreSQL indisponível; confira conexão e migrações. Não houve fallback silencioso para SQLite.",
    );
  }
}
