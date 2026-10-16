import { mkdir, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { PieError } from "../contracts.js";
import { nodeTestGrantSchema } from "./contracts.js";
import { readInventoryFile } from "../readFile.js";
import { openVerificationPersistence } from "../openPersistence.js";
import { NodeVerification } from "./verification.js";
import { VerificationJournal } from "./resourceJournal.js";
import {
  DockerCommand,
  validateDockerClientSelection,
} from "./dockerCommand.js";
import { ResourceRecovery } from "./resourceRecovery.js";
import { pageSchema } from "../graph.js";

export interface ExecutionCliOptions {
  stateDirectory?: string | undefined;
  executable?: string | undefined;
  endpoint?: string | undefined;
  limit?: string | undefined;
  offset?: string | undefined;
}

/** No permissions are inferred from a manifest or executable found in the target tree. */
async function privateState(
  path?: string,
  auditedRoot?: string,
): Promise<string> {
  if (process.platform !== "linux")
    throw new PieError(
      "POLICY_DENIED",
      "Execução e recuperação VERIFY disponíveis somente no Linux comprovado.",
    );
  if (!path || !isAbsolute(path))
    throw new PieError(
      "INVALID_INPUT",
      "Informe --state-dir absoluto e privado (modo 0700).",
    );
  const actual = await realpath(path);
  const stat = await lstat(actual);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0
  )
    throw new PieError(
      "POLICY_DENIED",
      "Diretório de estado deve pertencer ao usuário e ter modo 0700.",
    );
  if (auditedRoot) {
    const root = await realpath(auditedRoot);
    const delta = relative(root, actual);
    if (
      delta === "" ||
      (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`))
    )
      throw new PieError(
        "POLICY_DENIED",
        "Estado VERIFY deve ficar fora do projeto auditado.",
      );
  }
  return actual;
}
function selectedClient(
  options: ExecutionCliOptions,
  config: string,
): DockerCommand {
  if (!options.executable || !options.endpoint)
    throw new PieError(
      "INVALID_INPUT",
      "Informe --docker-bin absoluto e --docker-host local explícitos.",
    );
  validateDockerClientSelection(options.executable, options.endpoint, config);
  return new DockerCommand(options.executable, options.endpoint, config);
}

export async function verifyCli(
  grantFile: string,
  dbPath: string,
  options: ExecutionCliOptions,
) {
  const bytes = await readInventoryFile(grantFile, 1_000_000, () => 1);
  if (!bytes)
    throw new PieError(
      "INVALID_INPUT",
      "Arquivo de autorização excede limite de 1 MB ou não é regular.",
    );
  const grant = nodeTestGrantSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown,
  );
  const state = await privateState(
    options.stateDirectory,
    grant.repositoryRoot,
  );
  const selected = selectedClient(options, state);
  const { store, snapshot } = await openVerificationPersistence(dbPath, grant);
  let journal: VerificationJournal | undefined;
  let owner: NodeVerification | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    journal = await VerificationJournal.open(join(state, "resources.sqlite"));
    owner = new NodeVerification({
      executable: selected.executable,
      endpoint: selected.endpoint,
      temporaryParent: state,
      journal,
    });
    const run = await owner.execute(grant, snapshot, controller.signal);
    await store.saveVerification(run);
    if (run.result.state !== "passed") process.exitCode = 1;
    return run;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
    try {
      await owner?.close();
    } catch {
      process.stderr.write(
        "Limpeza pendente; consulte resources e recover antes de descartar o estado.\n",
      );
      process.exitCode = 1;
    }
    try {
      journal?.close();
    } finally {
      await store.close();
    }
  }
}

export async function resourcesCli(options: ExecutionCliOptions) {
  const state = await privateState(options.stateDirectory);
  const journal = await VerificationJournal.open(
    join(state, "resources.sqlite"),
  );
  try {
    const paging = pageSchema.parse({
      limit: Number(options.limit ?? 50),
      offset: Number(options.offset ?? 0),
    });
    const records = journal.list(paging);
    return {
      offset: paging.offset,
      limit: paging.limit,
      items: records.map((record) => ({
        runId: record.runId,
        root: record.root,
        phase: record.phase,
        containerId: record.containerId,
        rootRemovedAt: record.rootRemovedAt,
        ownerStatus: "not_checked",
      })),
    };
  } finally {
    journal.close();
  }
}
export async function recoverCli(runId: string, options: ExecutionCliOptions) {
  z.string().uuid().parse(runId);
  const state = await privateState(options.stateDirectory);
  const config = join(state, "recovery-config");
  const client = selectedClient(options, config);
  await mkdir(config, { mode: 0o700 }).catch((cause) => {
    if (
      !(
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "EEXIST"
      )
    )
      throw cause;
  });
  if ((await privateState(config)) !== config)
    throw new PieError(
      "POLICY_DENIED",
      "Configuração de recuperação redirecionada por link.",
    );
  const journal = await VerificationJournal.open(
    join(state, "resources.sqlite"),
  );
  try {
    const result = await new ResourceRecovery(journal, client, runId).recover();
    if (result.state !== "complete") process.exitCode = 1;
    return result;
  } finally {
    try {
      await client.close();
    } finally {
      journal.close();
    }
  }
}
