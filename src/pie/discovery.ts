import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import {
  PieError,
  policySchema,
  snapshotSchema,
  type GraphNode,
  type Snapshot,
} from "./contracts.js";
import { sealEvidence, sha256 } from "./evidence.js";
import { inventoryPath } from "./inventoryPath.js";
import { resolveImports, type ImportReference } from "./imports.js";
import { readInventoryFile } from "./readFile.js";
import { collectDeclarations } from "./adapters/collect.js";
import { readDeclarations } from "./adapters/declarations.js";
import { readCodeFacts } from "./codeFacts.js";
import type { AdapterFact } from "./adapters/contracts.js";

const runFile = promisify(execFile);
// Git hooks, package scripts and project executables are never launched.
async function git(
  root: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal,
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
        ...(signal ? { signal } : {}),
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
  const top = (
    await git(root, ["rev-parse", "--show-toplevel"], remaining(), signal)
  )
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
      signal,
    )
  ).toString("utf8");
  let revision: string | null = null;
  try {
    revision = (
      await git(root, ["rev-parse", "--verify", "HEAD"], remaining(), signal)
    )
      .toString("utf8")
      .trim();
  } catch {
    /* An unborn repository has no revision, not an invented SHA. */
  }
  const paths = [
    ...new Set(
      (await git(root, ["ls-files", "-z", "--cached"], remaining(), signal))
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
  const declarations: AdapterFact[] = [];
  const limitations = [
    "Somente arquivos rastreados pelo Git; arquivos novos não rastreados não foram examinados.",
    "Inventário Git e imports estáticos TS/JS; relação de pacote significa somente declaração no manifest observado, sem comprovar instalação, subpath resolvido ou carregamento.",
    "Imports dinâmicos, require, aliases, exports condicionais, pacotes não declarados e manifests fora do inventário observado permanecem desconhecidos.",
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
      const candidate = await inventoryPath(root, path);
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
      const declarationLimit = Math.max(
        0,
        policy.maxGraphEdges - declarations.length,
      );
      if (/\.[cm]?[jt]sx?$/.test(path)) {
        try {
          const parsed = readCodeFacts(
            path,
            buffer.toString("utf8"),
            Math.max(0, policy.maxGraphEdges - imports.length),
            declarationLimit,
          );
          imports.push(...parsed.references);
          const declared = collectDeclarations(item, parsed.declarations);
          evidence.push(...declared.evidence);
          declarations.push(...declared.declarations);
          limitations.push(...declared.limitations);
          if (parsed.omitted > 0)
            limitations.push(
              `${parsed.omitted} declarações AST omitidas por orçamento de grafo em ${path}.`,
            );
        } catch {
          limitations.push(
            `AST não analisada: ${path}. O arquivo permanece no inventário, sem relações inferidas.`,
          );
        }
      } else {
        try {
          const declared = collectDeclarations(
            item,
            readDeclarations(path, buffer.toString("utf8"), declarationLimit),
          );
          evidence.push(...declared.evidence);
          declarations.push(...declared.declarations);
          limitations.push(...declared.limitations);
        } catch {
          limitations.push(
            `${path}: formato declarativo não analisado; nenhuma declaração inferida a partir da falha.`,
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
      signal,
    )
  ).toString("utf8");
  const changed = before !== after;
  if (changed)
    limitations.push(
      "Estado Git mudou durante a descoberta; repetir em snapshot quiescente.",
    );
  const evidenceByPath = new Map(
    evidence
      .filter((item) => item.source.line === null)
      .map((item) => [item.source.path, item]),
  );
  const manifestNodes = new Map(
    nodes
      .filter((node) => node.kind === "manifest")
      .map((node) => [node.path, node]),
  );
  const packages = declarations.flatMap((declaration) => {
    if (
      declaration.kind !== "dependency" ||
      declaration.adapter !== "node-manifest"
    )
      return [];
    const manifestNode = manifestNodes.get(declaration.source.path);
    return manifestNode
      ? [
          {
            name: declaration.name,
            evidenceId: declaration.evidenceId,
            manifestNodeId: manifestNode.id,
          },
        ]
      : [];
  });
  const resolved = resolveImports(
    nodes,
    imports,
    (reference, resolution) => {
      const original = evidenceByPath.get(reference.sourcePath)!;
      const { sha256: previousDigest, ...fields } = original;
      void previousDigest;
      const item = sealEvidence({
        ...fields,
        id: randomUUID(),
        source: { ...original.source, line: reference.line },
        confidence: "derived",
        observation: `Import AST ${JSON.stringify([
          reference.specifier,
          resolution.kind,
          resolution.kind === "relative-file"
            ? resolution.targetPath
            : resolution.manifestPath,
        ])}; não comprova carregamento em runtime.`,
      });
      evidence.push(item);
      return item.id;
    },
    packages,
  );
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
    declarations,
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
