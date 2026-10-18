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
  } catch {
    await store.close();
    throw new PieError(
      "IO_ERROR",
      "PostgreSQL indisponível; confira conexão e migrações. Não houve fallback silencioso para SQLite.",
    );
  }
  try {
    const { missingTables, migrations } = await store.inspectSchema();
    if (missingTables.length > 0 || migrations.status !== "current") {
      const migrationIssues =
        migrations.status === "missing_history"
          ? "histórico _prisma_migrations ausente"
          : [
              migrations.missing > 0
                ? `${migrations.missing} migration(s) pendente(s)`
                : null,
              migrations.unfinished > 0
                ? `${migrations.unfinished} tentativa(s) sem finalização`
                : null,
              migrations.unknown > 0
                ? `${migrations.unknown} migration(s) fora desta versão`
                : null,
              migrations.drifted > 0
                ? `${migrations.drifted} checksum(s) diferente(s)`
                : null,
            ]
              .filter((issue): issue is string => issue !== null)
              .join(", ");
      throw new PieError(
        "IO_ERROR",
        `PostgreSQL conectado, mas schema PIE/migrations incompleto (${missingTables.length} tabela(s) ausente(s)${migrationIssues ? `; ${migrationIssues}` : ""}); aplique migrations explicitamente.`,
      );
    }
    return store;
  } catch (cause) {
    await store.close().catch(() => {});
    if (cause instanceof PieError) throw cause;
    throw new PieError(
      "IO_ERROR",
      "PostgreSQL indisponível; confira conexão e migrações. Não houve fallback silencioso para SQLite.",
    );
  }
}
