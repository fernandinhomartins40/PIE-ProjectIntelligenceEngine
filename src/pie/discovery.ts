import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  PieError,
  policySchema,
  snapshotSchema,
  type GraphNode,
  type Snapshot,
} from "./contracts.js";
import { sealEvidence, sha256 } from "./evidence.js";
import { containedPath } from "./policy.js";
import {
  readImports,
  resolveImports,
  type ImportReference,
} from "./imports.js";
import { readInventoryFile } from "./readFile.js";

const runFile = promisify(execFile);
// Git hooks, package scripts and project executables are never launched.
async function git(
  root: string,
  args: string[],
  timeout: number,
): Promise<Buffer> {
  try {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith("GIT_"),
      ),
    );
    const result = await runFile(
      "git",
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=",
        "-C",
        root,
        ...args,
      ],
      {
        encoding: "buffer",
        timeout,
        maxBuffer: 16_000_000,
        windowsHide: true,
        env: {
          ...environment,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        },
      },
    );
    return result.stdout;
  } catch {
    throw new PieError(
      "IO_ERROR",
      "Não foi possível ler os metadados Git dentro dos limites.",
    );
  }
}

function classify(path: string): GraphNode["kind"] {
  if (
    /(^|\/)(package.json|composer.json|pyproject.toml|pom.xml|Cargo.toml|go.mod)$/.test(
      path,
    )
  )
    return "manifest";
  if (
    /(^|\/)(Dockerfile[^/]*|compose[^/]*\.ya?ml|docker-compose[^/]*\.ya?ml)$/.test(
      path,
    )
  )
    return "container";
  if (/(\.prisma|\.sql)$/.test(path)) return "schema";
  if (
    /(^|\/)(__tests__|tests?|specs?)(\/|\.)|\.(test|spec)\.[cm]?[jt]sx?$/.test(
      path,
    )
  )
    return "test";
  return "file";
}

/** Reject symlinks/junctions along the whole path, including intermediate parents. */
async function checkPath(root: string, path: string): Promise<string> {
  const candidate = containedPath(root, path);
  let cursor = candidate;
  while (cursor !== root) {
    if ((await lstat(cursor)).isSymbolicLink())
      throw new PieError("POLICY_DENIED", "Link simbólico não inspecionado.");
    const parent = dirname(cursor);
    if (parent === cursor)
      throw new PieError("POLICY_DENIED", "Caminho não contido.");
    cursor = parent;
  }
  const actual = await realpath(candidate);
  const delta = relative(root, actual);
  if (delta === ".." || delta.startsWith(`..${sep}`))
    throw new PieError("POLICY_DENIED", "Destino fora do escopo.");
  return candidate;
}

export async function discoverProject(
  input: unknown,
  projectId: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const policy = policySchema.parse(input);
  const root = await realpath(resolve(policy.repositoryRoot));
  const started = Date.now();
  const remaining = (): number => {
    signal?.throwIfAborted();
    const value = policy.timeoutMs - (Date.now() - started);
    if (value <= 0)
      throw new PieError(
        "LIMIT_EXCEEDED",
        "Tempo limite da descoberta atingido.",
      );
    return value;
  };
  const top = (await git(root, ["rev-parse", "--show-toplevel"], remaining()))
    .toString("utf8")
    .trim();
  if ((await realpath(top)) !== root)
    throw new PieError(
      "POLICY_DENIED",
      "Selecione a raiz exata do repositório Git.",
    );
  const before = (
    await git(
      root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
      remaining(),
    )
  ).toString("utf8");
  let revision: string | null = null;
  try {
    revision = (await git(root, ["rev-parse", "--verify", "HEAD"], remaining()))
      .toString("utf8")
      .trim();
  } catch {
    /* An unborn repository has no revision, not an invented SHA. */
  }
  const paths = [
    ...new Set(
      (await git(root, ["ls-files", "-z", "--cached"], remaining()))
        .toString("utf8")
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const nodes: Snapshot["nodes"] = [];
  const evidence: Snapshot["evidence"] = [];
  const imports: ImportReference[] = [];
  const limitations = [
    "Somente arquivos rastreados pelo Git; arquivos novos não rastreados não foram examinados.",
    "Inventário e imports estáticos relativos TS/JS; não comprova rotas, serviços, permissões ou funcionamento.",
    "Imports dinâmicos, require, aliases, resolução de pacotes e exports condicionais não são rastreados nesta versão.",
    "Conteúdo de arquivos não é retido. Não há execução do projeto auditado.",
    "A leitura não é atômica em relação a alterações concorrentes do sistema de arquivos.",
  ];
  let bytesRead = 0;
  let omitted = 0;
  for (const path of paths.slice(0, policy.maxFiles)) {
    remaining();
    // Exclude credential carriers even when accidentally tracked. Bodies are never logged.
    if (
      /(^|\/)(\.env(?:\..*)?|\.npmrc|\.netrc|credentials[^/]*|id_rsa|id_ed25519)$|\.(pem|key|p12|pfx)$/i.test(
        path,
      )
    ) {
      omitted++;
      continue;
    }
    try {
      const candidate = await checkPath(root, path);
      const buffer = await readInventoryFile(
        candidate,
        Math.min(policy.maxFileBytes, policy.maxTotalBytes - bytesRead),
        remaining,
      );
      if (buffer === null) {
        omitted++;
        continue;
      }
      const count = buffer.length;
      bytesRead += count;
      const hash = sha256(buffer.subarray(0, count));
      const item = sealEvidence({
        schemaVersion: 1,
        id: randomUUID(),
        projectId,
        snapshotId: id,
        auditRunId: null,
        revision,
        environment: policy.environment,
        method: "static",
        confidence: "observed",
        state: "unverified",
        createdAt,
        source: { path, line: null, sha256: hash },
        sensitivity: "internal",
        redactionStatus: "not_collected",
        expiresAt: null,
        limitations: [
          "Hash de bytes lidos, sem execução; classificação por nome de arquivo é inferência.",
        ],
        observation:
          "Arquivo rastreado lido para inventário e identidade de conteúdo.",
      });
      evidence.push(item);
      nodes.push({
        id: sha256(path),
        path,
        kind: classify(path),
        evidenceIds: [item.id],
      });
      if (/\.[cm]?[jt]sx?$/.test(path)) {
        try {
          const parsed = readImports(
            path,
            buffer.toString("utf8"),
            Math.max(0, policy.maxGraphEdges - imports.length),
          );
          imports.push(...parsed.references);
          if (parsed.omitted > 0)
            limitations.push(
              `${parsed.omitted} declarações AST omitidas por orçamento de grafo em ${path}.`,
            );
        } catch {
          limitations.push(
            `AST não analisada: ${path}. O arquivo permanece no inventário, sem relações inferidas.`,
          );
        }
      }
    } catch (cause) {
      if (cause instanceof PieError && cause.code === "LIMIT_EXCEEDED")
        throw cause;
      omitted++;
    }
  }
  if (paths.length > policy.maxFiles) omitted += paths.length - policy.maxFiles;
  if (omitted > 0)
    limitations.push(
      `${omitted} entradas não examinadas por limite, sensibilidade, tipo, link ou falha de leitura.`,
    );
  const after = (
    await git(
      root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
      remaining(),
    )
  ).toString("utf8");
  const changed = before !== after;
  if (changed)
    limitations.push(
      "Estado Git mudou durante a descoberta; repetir em snapshot quiescente.",
    );
  const evidenceByPath = new Map(
    evidence.map((item) => [item.source.path, item]),
  );
  const resolved = resolveImports(nodes, imports, (path, line) => {
    const original = evidenceByPath.get(path)!;
    const { sha256: previousDigest, ...fields } = original;
    void previousDigest;
    const item = sealEvidence({
      ...fields,
      id: randomUUID(),
      source: { ...original.source, line },
      confidence: "derived",
      observation:
        "Declaração AST de importação ou reexportação com destino relativo resolvido convencionalmente; não comprova carregamento em runtime.",
    });
    evidence.push(item);
    return item.id;
  });
  if (resolved.unresolved > 0)
    limitations.push(
      `${resolved.unresolved} declarações de importação não resolvidas; ausência de aresta não prova ausência de dependência.`,
    );
  remaining();
  return snapshotSchema.parse({
    schemaVersion: 1,
    id,
    projectId,
    root,
    revision,
    dirty: before.length > 0 || after.length > 0,
    createdAt,
    treeDigest: sha256(
      JSON.stringify(
        [...evidenceByPath.values()].map((item) => [
          item.source.path,
          item.source.sha256,
        ]),
      ),
    ),
    nodes,
    edges: resolved.edges,
    evidence,
    coverage: {
      scope: "git-tracked-files",
      status: omitted > 0 || changed ? "partial" : "complete",
      enumeratedFiles: paths.length,
      examinedFiles: nodes.length,
      bytesRead,
      runtime: false,
      limitations,
    },
  });
}

export const projectName = (root: string): string => basename(root);
