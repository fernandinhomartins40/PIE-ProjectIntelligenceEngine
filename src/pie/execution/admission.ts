import { isAbsolute, posix } from "node:path";
import { realpath } from "node:fs/promises";
import { err, ok, type Result } from "../../domain/result.js";
import {
  AnalysisInputError,
  AnalysisArtifactChangedError,
} from "../../domain/analysisErrorCore.js";
import type { Snapshot } from "../contracts.js";
import { validateSnapshot } from "../snapshotIntegrity.js";
import { nodeTestGrantSchema, type NodeTestGrant } from "./contracts.js";

export type AdmissionError = AnalysisInputError | AnalysisArtifactChangedError;
export interface AdmittedNodeTests {
  grant: NodeTestGrant;
  snapshot: Snapshot;
}

function invalidExecutionPath(path: string): boolean {
  return (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes(":") ||
    posix.normalize(path) !== path ||
    path === "." ||
    path.startsWith("../")
  );
}

/** Parse authority once, then bind it to an exact immutable observed tree. */
export async function admitNodeTests(
  input: unknown,
  observation: unknown,
  now = Date.now(),
): Promise<Result<AdmittedNodeTests, AdmissionError>> {
  const parsed = nodeTestGrantSchema.safeParse(input);
  if (!parsed.success)
    return err(
      new AnalysisInputError("pie.verify", {
        userMessage: "Autorização VERIFY inválida.",
      }),
    );
  const grant = parsed.data;
  let snapshot: Snapshot;
  try {
    snapshot = validateSnapshot(observation);
  } catch {
    return err(
      new AnalysisInputError("pie.verify", {
        userMessage: "Snapshot inválido.",
      }),
    );
  }
  if (
    grant.snapshotId !== snapshot.id ||
    grant.treeDigest !== snapshot.treeDigest
  )
    return err(
      new AnalysisArtifactChangedError(
        "pie.verify",
        snapshot.root,
        "Autorização pertence a outro snapshot ou conteúdo.",
      ),
    );
  if (
    Date.parse(grant.expiresAt) <= now ||
    snapshot.coverage.status !== "complete"
  )
    return err(
      new AnalysisInputError("pie.verify", {
        userMessage: "Autorização expirada ou descoberta parcial.",
      }),
    );
  try {
    if (
      (await realpath(grant.repositoryRoot)) !== (await realpath(snapshot.root))
    )
      return err(
        new AnalysisInputError("pie.verify", {
          userMessage: "Raiz não autorizada.",
        }),
      );
  } catch {
    return err(
      new AnalysisInputError("pie.verify", {
        userMessage: "Raiz indisponível.",
      }),
    );
  }
  const paths = new Set(snapshot.nodes.map((node) => node.path));
  if (
    paths.size !== snapshot.nodes.length ||
    new Set(grant.testFiles).size !== grant.testFiles.length
  )
    return err(
      new AnalysisInputError("pie.verify", {
        userMessage: "Caminhos duplicados.",
      }),
    );
  for (const path of [...paths, ...grant.testFiles]) {
    if (invalidExecutionPath(path))
      return err(
        new AnalysisInputError("pie.verify", {
          userMessage: "Caminho de execução inválido.",
        }),
      );
  }
  if (
    grant.testFiles.some(
      (path) => !paths.has(path) || !/\.(?:[cm]?js|[cm]?ts)$/.test(path),
    )
  )
    return err(
      new AnalysisInputError("pie.verify", {
        userMessage:
          "Teste deve ser um arquivo JavaScript/TypeScript observado.",
      }),
    );
  return ok({ grant, snapshot });
}
