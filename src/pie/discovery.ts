import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  PieError,
  policySchema,
  snapshotSchema,
  type GraphNode,
  type Evidence,
  type Snapshot,
} from "./contracts.js";
import { sealEvidence, sha256 } from "./evidence.js";
import { inventoryPath } from "./inventoryPath.js";
import {
  resolveImports,
  resolveRelativeTarget,
  type ImportReference,
} from "./imports.js";
import { readInventoryFile } from "./readFile.js";
import { collectDeclarations } from "./adapters/collect.js";
import { readDeclarationsResult } from "./adapters/declarations.js";
import { readCodeFactsResult } from "./codeFacts.js";
import {
  declarationEvidenceObservation,
  derivationEvidenceObservation,
  type AdapterFact,
  type DeclarationDerivation,
} from "./adapters/contracts.js";
import { declarationIdentity } from "./adapters/identity.js";
import {
  expressRouterExportObservation,
  expressRouterReExportObservation,
  expressRouterMountEdgeId,
  expressRouterMountObservation,
} from "./adapters/expressEvidence.js";
import {
  joinExpressRoute,
  type ExpressLocalRouterMount,
  type ExpressCrossFileMount,
  type ExpressRouterReExport,
  type ExpressRouterExport,
} from "./adapters/express.js";

const runFile = promisify(execFile);
function isUnbornHeadRevisionFailure(args: string[], cause: unknown): boolean {
  if (
    args.length !== 3 ||
    args[0] !== "rev-parse" ||
    args[1] !== "--verify" ||
    args[2] !== "HEAD" ||
    !(cause instanceof Error)
  )
    return false;
  const code = Reflect.get(cause, "code");
  const stderr = Reflect.get(cause, "stderr");
  const message = Buffer.isBuffer(stderr)
    ? stderr.toString("utf8").trim()
    : typeof stderr === "string"
      ? stderr.trim()
      : "";
  return code === 128 && message === "fatal: Needed a single revision";
}

// Git hooks, package scripts and project executables are never launched.
async function git(
  root: string,
  args: string[],
  timeout: () => number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const timeoutMs = timeout();
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
        timeout: timeoutMs,
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
  } catch (cause) {
    // Preserve lifecycle semantics from the process supervisor. In particular,
    // an abort must not become an inventory omission, and a bounded child
    // process must not report a timeout or output-capacity failure as I/O.
    if (signal?.aborted) throw signal.reason ?? cause;
    if (cause instanceof Error) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (
        code === "ETIMEDOUT" ||
        code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
        ((cause as NodeJS.ErrnoException & { killed?: boolean }).killed ===
          true &&
          (cause as NodeJS.ErrnoException & { signal?: string }).signal != null)
      )
        throw new PieError(
          "LIMIT_EXCEEDED",
          "Comando Git excedeu o limite de tempo ou saída da descoberta.",
        );
    }
    if (isUnbornHeadRevisionFailure(args, cause)) {
      try {
        const gitDirectory = (
          await git(root, ["rev-parse", "--absolute-git-dir"], timeout, signal)
        )
          .toString("utf8")
          .trim();
        const headContents = await readFile(
          resolve(gitDirectory, "HEAD"),
          "utf8",
        );
        const headReference = /^ref: (refs\/heads\/[^\r\n]+)\r?\n?$/.exec(
          headContents,
        )?.[1];
        if (headReference && !headReference.split("/").includes("..")) {
          await git(root, ["check-ref-format", headReference], timeout, signal);
          const referencePath = resolve(
            gitDirectory,
            ...headReference.split("/"),
          );
          const relativeReferencePath = relative(gitDirectory, referencePath);
          if (
            relativeReferencePath === "" ||
            relativeReferencePath === ".." ||
            relativeReferencePath.startsWith(`..${sep}`)
          )
            throw new PieError(
              "IO_ERROR",
              "A referência HEAD está fora do Git.",
            );
          try {
            const reference = await lstat(referencePath);
            if (reference.isFile()) {
              const objectId = (await readFile(referencePath, "utf8")).trim();
              const objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
              if (!objectIdPattern.test(objectId)) {
                throw new PieError(
                  "IO_ERROR",
                  "A referência Git simbólica possui formato inválido.",
                );
              }
            }
          } catch (referenceFailure) {
            if (
              referenceFailure instanceof Error &&
              Reflect.get(referenceFailure, "code") === "ENOENT"
            ) {
              const packedReferencesPath = resolve(gitDirectory, "packed-refs");
              try {
                const packedReferences = await readFile(
                  packedReferencesPath,
                  "utf8",
                );
                if (
                  packedReferences
                    .split(/\r?\n/)
                    .some((line) => line.split(" ").at(1) === headReference)
                )
                  throw new PieError(
                    "IO_ERROR",
                    "A referência HEAD empacotada não resolveu uma revisão.",
                  );
              } catch (packedFailure) {
                if (
                  !(packedFailure instanceof Error) ||
                  Reflect.get(packedFailure, "code") !== "ENOENT"
                )
                  throw packedFailure;
              }
              return Buffer.alloc(0);
            }
            throw referenceFailure;
          }
        }
      } catch (verificationFailure) {
        if (signal?.aborted) throw signal.reason ?? verificationFailure;
        if (verificationFailure instanceof PieError) throw verificationFailure;
      }
    }
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

function expectedInventoryFailure(cause: unknown): string | null {
  if (cause instanceof PieError) {
    if (cause.code === "POLICY_DENIED") return "policy_denied";
    if (cause.code === "IO_ERROR") return "io_error";
    return null;
  }
  if (!(cause instanceof Error)) return null;
  const code = (cause as NodeJS.ErrnoException).code;
  return code &&
    ["EACCES", "EIO", "ELOOP", "ENOENT", "ENOTDIR", "EPERM"].includes(code)
    ? "io_error"
    : null;
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
    await git(root, ["rev-parse", "--show-toplevel"], remaining, signal)
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
      remaining,
      signal,
    )
  ).toString("utf8");
  const revisionValue = (
    await git(root, ["rev-parse", "--verify", "HEAD"], remaining, signal)
  )
    .toString("utf8")
    .trim();
  const revision: string | null = revisionValue || null;
  const paths = [
    ...new Set(
      (await git(root, ["ls-files", "-z", "--cached"], remaining, signal))
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
  const expressModules: Array<{
    path: string;
    mounts: ExpressCrossFileMount[];
    routerMounts: ExpressLocalRouterMount[];
    exports: ExpressRouterExport[];
    reExports: ExpressRouterReExport[];
  }> = [];
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
        const parsed = readCodeFactsResult(
          path,
          buffer.toString("utf8"),
          Math.max(0, policy.maxGraphEdges - imports.length),
          declarationLimit,
        );
        if (!parsed.ok) {
          limitations.push(
            `AST não analisada: ${path}. O arquivo permanece no inventário, sem relações inferidas.`,
          );
          continue;
        }
        imports.push(...parsed.value.references);
        expressModules.push({
          path,
          mounts: parsed.value.express.crossFileMounts,
          routerMounts: parsed.value.express.routerMounts,
          exports: parsed.value.express.routerExports,
          reExports: parsed.value.express.routerReExports,
        });
        if (parsed.value.express.omittedCrossFileFacts > 0)
          limitations.push(
            `${parsed.value.express.omittedCrossFileFacts} fatos de mount/export/re-export Express usados na resolução cross-file omitidos pelo limite de análise em ${path}.`,
          );
        const declared = collectDeclarations(item, parsed.value.declarations);
        evidence.push(...declared.evidence);
        declarations.push(...declared.declarations);
        limitations.push(...declared.limitations);
        if (parsed.value.omitted > 0)
          limitations.push(
            `${parsed.value.omitted} declarações AST omitidas por orçamento de grafo em ${path}.`,
          );
      } else {
        const parsed = readDeclarationsResult(
          path,
          buffer.toString("utf8"),
          declarationLimit,
        );
        if (!parsed.ok) {
          limitations.push(
            `${path}: formato declarativo não analisado (${parsed.error.kind}); nenhum fato inferido a partir da falha.`,
          );
          continue;
        }
        const declared = collectDeclarations(item, parsed.value);
        evidence.push(...declared.evidence);
        declarations.push(...declared.declarations);
        limitations.push(...declared.limitations);
      }
    } catch (cause) {
      if (cause instanceof PieError && cause.code === "LIMIT_EXCEEDED")
        throw cause;
      const failure = expectedInventoryFailure(cause);
      if (!failure) throw cause;
      omitted++;
      limitations.push(
        `${path}: entrada omitida por falha esperada de inventário (${failure}); conteúdo e fatos não retidos.`,
      );
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
      remaining,
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
  const fileNodesByPath = new Map(nodes.map((node) => [node.path, node]));
  const relativeNodeIndex = fileNodesByPath;
  const moduleByPath = new Map(
    expressModules.map((module) => [module.path, module]),
  );
  type ResolvedRouterExport = {
    terminalPath: string;
    terminalExport: ExpressRouterExport;
    first:
      | { kind: "local"; export: ExpressRouterExport }
      | { kind: "re-export"; export: ExpressRouterReExport };
  };
  const resolveRouterExport = (
    path: string,
    exportName: string,
    visiting: ReadonlySet<string> = new Set(),
  ): ResolvedRouterExport | null => {
    const identity = JSON.stringify([path, exportName]);
    if (visiting.has(identity)) return null;
    const module = moduleByPath.get(path);
    if (!module) return null;
    const direct = module.exports.filter(
      (item) => item.exportName === exportName,
    );
    const reExports = module.reExports.filter(
      (item) => item.exportName === exportName,
    );
    if (direct.length + reExports.length !== 1) return null;
    const nextVisiting = new Set(visiting).add(identity);
    const local = direct[0];
    if (local)
      return {
        terminalPath: path,
        terminalExport: local,
        first: { kind: "local", export: local },
      };
    const reExport = reExports[0]!;
    const target = resolveRelativeTarget(
      relativeNodeIndex,
      path,
      reExport.specifier,
    );
    if (!target) return null;
    const nested = resolveRouterExport(
      target.path,
      reExport.importedName,
      nextVisiting,
    );
    return nested
      ? { ...nested, first: { kind: "re-export", export: reExport } }
      : null;
  };
  const importProofsByTuple = new Map<string, Evidence>();
  for (const item of evidence) {
    if (!item.observation.startsWith("Import AST ")) continue;
    const match =
      /^Import AST (.+); não comprova carregamento em runtime\.$/.exec(
        item.observation,
      );
    if (!match) continue;
    try {
      const tuple: unknown = JSON.parse(match[1]!);
      if (
        Array.isArray(tuple) &&
        tuple.length === 3 &&
        tuple[1] === "relative-file" &&
        typeof tuple[0] === "string" &&
        typeof tuple[2] === "string"
      )
        importProofsByTuple.set(
          JSON.stringify([item.source.path, item.source.line, ...tuple]),
          item,
        );
    } catch {
      // Only sealed import observations emitted above are considered.
    }
  }
  const expressEdges: Snapshot["edges"] = [];
  const resolvedExpressMounts: Array<{
    sourcePath: string;
    targetPath: string;
    mountLine: number;
    prefix: string;
    exported: ExpressRouterExport;
  }> = [];
  let unresolvedExpressMounts = 0;
  let omittedExpressMounts = 0;
  const maxExpressEdges = Math.max(
    0,
    policy.maxGraphEdges - resolved.edges.length,
  );
  const makeDerivedEvidence = (
    original: Evidence,
    line: number,
    observation: string,
  ) => {
    const { sha256: _previousDigest, ...fields } = original;
    return sealEvidence({
      ...fields,
      id: randomUUID(),
      source: { ...original.source, line },
      confidence: "derived",
      observation,
    });
  };
  for (const module of expressModules) {
    for (const mount of module.mounts) {
      remaining();
      const targetPath = resolveRelativeTarget(
        relativeNodeIndex,
        module.path,
        mount.specifier,
      );
      const targetModule = targetPath
        ? moduleByPath.get(targetPath.path)
        : undefined;
      const resolvedExport = targetPath
        ? resolveRouterExport(targetPath.path, mount.importedName)
        : null;
      const sourceNode = fileNodesByPath.get(module.path);
      const sourceEvidence = evidenceByPath.get(module.path);
      if (
        !targetPath ||
        !targetModule ||
        !resolvedExport ||
        !sourceNode ||
        !sourceEvidence
      ) {
        unresolvedExpressMounts++;
        continue;
      }
      if (expressEdges.length >= maxExpressEdges) {
        omittedExpressMounts++;
        continue;
      }
      const targetNode = fileNodesByPath.get(targetPath.path);
      const targetEvidence = evidenceByPath.get(targetPath.path);
      const exported = resolvedExport.terminalExport;
      if (!targetNode || !targetEvidence) {
        unresolvedExpressMounts++;
        continue;
      }
      const importProof = importProofsByTuple.get(
        JSON.stringify([
          module.path,
          mount.line,
          mount.specifier,
          "relative-file",
          targetPath.path,
        ]),
      );
      if (!importProof) {
        unresolvedExpressMounts++;
        continue;
      }
      const mountFact = {
        specifier: mount.specifier,
        importedName: mount.importedName,
        localName: mount.localName,
        importLine: mount.line,
        prefix: mount.prefix,
        targetPath: targetPath.path,
      };
      const mountProof = makeDerivedEvidence(
        sourceEvidence,
        mount.mountLine,
        expressRouterMountObservation(mountFact),
      );
      const exportLine = resolvedExport.first.export.line;
      const exportObservation =
        resolvedExport.first.kind === "local"
          ? expressRouterExportObservation(
              exported.exportName,
              exported.localName,
            )
          : expressRouterReExportObservation(
              resolvedExport.first.export.exportName,
              resolvedExport.first.export.importedName,
              resolvedExport.first.export.specifier,
            );
      const exportProof = makeDerivedEvidence(
        targetEvidence,
        exportLine,
        exportObservation,
      );
      evidence.push(mountProof, exportProof);
      resolvedExpressMounts.push({
        sourcePath: module.path,
        targetPath: resolvedExport.terminalPath,
        mountLine: mount.mountLine,
        prefix: mount.prefix,
        exported,
      });
      expressEdges.push({
        id: expressRouterMountEdgeId(
          sourceNode.id,
          targetNode.id,
          mountFact,
          mount.mountLine,
          exportLine,
        ),
        from: sourceNode.id,
        to: targetNode.id,
        kind: "calls",
        evidenceIds: [mountProof.id, importProof.id, exportProof.id],
        confidence: "derived",
      });
    }
  }
  if (unresolvedExpressMounts > 0)
    limitations.push(
      `${unresolvedExpressMounts} mounts Express importados não foram resolvidos para um export de router único; prefixos e tipo de runtime permanecem desconhecidos.`,
    );
  if (omittedExpressMounts > 0)
    limitations.push(
      `${omittedExpressMounts} relações de mount Express omitidas pelo limite global de arestas.`,
    );
  const routeFacts = new Map<string, AdapterFact[]>();
  for (const fact of declarations) {
    if (fact.adapter !== "express-ast" || fact.kind !== "endpoint") continue;
    const key = JSON.stringify([fact.source.path, fact.parent]);
    const group = routeFacts.get(key) ?? [];
    group.push(fact);
    routeFacts.set(key, group);
  }
  const mountsByFact = new Map<string, typeof resolvedExpressMounts>();
  const routerClosures = new Map<string, Set<string>>();
  const unresolvedNestedExpressRoutes = new Set<string>();
  const cyclicRouterClosures = new Set<string>();
  for (const mount of resolvedExpressMounts) {
    const module = moduleByPath.get(mount.targetPath);
    if (!module) continue;
    const closureKey = JSON.stringify([
      mount.targetPath,
      mount.exported.localName,
    ]);
    let closure = routerClosures.get(closureKey);
    if (!closure) {
      closure = new Set([mount.exported.localName]);
      const byReceiver = new Map<string, ExpressLocalRouterMount[]>();
      for (const localMount of module.routerMounts) {
        const group = byReceiver.get(localMount.receiver) ?? [];
        group.push(localMount);
        byReceiver.set(localMount.receiver, group);
      }
      const queue = [mount.exported.localName];
      for (let index = 0; index < queue.length; index++)
        for (const localMount of byReceiver.get(queue[index]!) ?? [])
          if (!closure.has(localMount.router)) {
            closure.add(localMount.router);
            queue.push(localMount.router);
          }
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const hasCycle = (router: string): boolean => {
        if (visiting.has(router)) return true;
        if (visited.has(router)) return false;
        visiting.add(router);
        for (const localMount of byReceiver.get(router) ?? [])
          if (closure!.has(localMount.router) && hasCycle(localMount.router))
            return true;
        visiting.delete(router);
        visited.add(router);
        return false;
      };
      if (hasCycle(mount.exported.localName))
        cyclicRouterClosures.add(closureKey);
      routerClosures.set(closureKey, closure);
    }
    if (cyclicRouterClosures.has(closureKey)) continue;
    for (const router of closure) {
      for (const fact of routeFacts.get(
        JSON.stringify([mount.targetPath, router]),
      ) ?? []) {
        if (
          router !== mount.exported.localName &&
          fact.derivations.length === 0
        ) {
          unresolvedNestedExpressRoutes.add(fact.id);
          continue;
        }
        const group = mountsByFact.get(fact.id) ?? [];
        group.push(mount);
        mountsByFact.set(fact.id, group);
      }
    }
  }
  const composedDeclarations: AdapterFact[] = [];
  const composedById = new Map<string, AdapterFact>();
  let extraDeclarationBudget = Math.max(
    0,
    policy.maxGraphEdges - declarations.length,
  );
  let derivationBudget = Math.max(
    0,
    policy.maxGraphEdges - resolved.edges.length - expressEdges.length,
  );
  let omittedComposedRoutes = 0;
  let unresolvedComposedRoutes = 0;
  const generatedDeclarationEvidence = new Set<string>();
  const addRouteDerivation = (
    fact: AdapterFact,
    mount: (typeof resolvedExpressMounts)[number],
  ) => {
    const derivation = {
      line: mount.mountLine,
      operation: "express_router_mount" as const,
      prefix: mount.prefix,
      sourcePath: mount.sourcePath,
    };
    const key = JSON.stringify([
      derivation.line,
      derivation.operation,
      derivation.prefix,
      derivation.sourcePath,
    ]);
    if (
      fact.derivations.some(
        (item) =>
          JSON.stringify([
            item.line,
            item.operation,
            item.prefix,
            item.sourcePath ?? null,
          ]) === key,
      )
    )
      return true;
    if (derivationBudget <= 0) return false;
    const sourceEvidence = evidenceByPath.get(mount.sourcePath);
    if (!sourceEvidence) return false;
    const proof = makeDerivedEvidence(
      sourceEvidence,
      derivation.line,
      derivationEvidenceObservation(derivation),
    );
    evidence.push(proof);
    fact.derivations.push({ ...derivation, evidenceId: proof.id });
    fact.provenanceVersion = 3;
    derivationBudget--;
    return true;
  };
  for (const original of declarations) {
    const mounts = mountsByFact.get(original.id);
    if (!mounts?.length) {
      composedDeclarations.push(original);
      composedById.set(original.id, original);
      continue;
    }
    const separator = original.name.indexOf(" ");
    const method = original.name.slice(0, separator);
    const localPath = original.name.slice(separator + 1);
    const candidates = new Map<
      string,
      { name: string; mounts: Array<(typeof resolvedExpressMounts)[number]> }
    >();
    for (const mount of mounts) {
      const path = joinExpressRoute(mount.prefix, localPath);
      if (path === null) {
        unresolvedComposedRoutes++;
        continue;
      }
      const name = `${method} ${path}`;
      const group = candidates.get(name) ?? { name, mounts: [] };
      group.mounts.push(mount);
      candidates.set(name, group);
    }
    if (candidates.size === 0) {
      composedDeclarations.push(original);
      composedById.set(original.id, original);
      continue;
    }
    let emittedForOriginal = 0;
    for (const candidate of candidates.values()) {
      if (
        candidate.name.length > 1000 ||
        (emittedForOriginal > 0 && extraDeclarationBudget <= 0)
      ) {
        omittedComposedRoutes++;
        continue;
      }
      const id = declarationIdentity({
        ...original,
        name: candidate.name,
        source: original.source,
      });
      const existingFact = composedById.get(id);
      let fact = existingFact;
      const existingDerivations = new Set(
        (fact?.derivations ?? original.derivations).map((item) =>
          JSON.stringify([
            item.line,
            item.operation,
            item.prefix,
            item.sourcePath ?? null,
          ]),
        ),
      );
      const pendingMounts = candidate.mounts.filter(
        (mount) =>
          !existingDerivations.has(
            JSON.stringify([
              mount.mountLine,
              "express_router_mount",
              mount.prefix,
              mount.sourcePath,
            ]),
          ),
      );
      if (!fact && pendingMounts.length === 0) {
        unresolvedComposedRoutes++;
        continue;
      }
      if (pendingMounts.length > 0 && derivationBudget <= 0) {
        omittedComposedRoutes += pendingMounts.length;
        continue;
      }
      if (!fact) {
        if (candidate.name === original.name)
          fact = {
            ...original,
            provenanceVersion: 3,
            derivations: [...original.derivations],
          };
        else {
          const originalFile = evidenceByPath.get(original.source.path);
          if (!originalFile || original.source.line === null) {
            unresolvedComposedRoutes++;
            continue;
          }
          const proof = makeDerivedEvidence(
            originalFile,
            original.source.line,
            declarationEvidenceObservation({
              adapter: original.adapter,
              kind: original.kind,
              name: candidate.name,
              parent: original.parent,
            }),
          );
          evidence.push(proof);
          generatedDeclarationEvidence.add(proof.id);
          fact = {
            ...original,
            id,
            name: candidate.name,
            evidenceId: proof.id,
            provenanceVersion: 3,
            derivations: [...original.derivations],
          };
        }
        composedById.set(id, fact);
        composedDeclarations.push(fact);
      }
      let evidencedMounts = 0;
      for (const mount of candidate.mounts) {
        if (!addRouteDerivation(fact, mount)) {
          omittedComposedRoutes++;
          continue;
        }
        evidencedMounts++;
      }
      if (evidencedMounts === 0 && !existingFact) {
        composedById.delete(id);
        const index = composedDeclarations.indexOf(fact);
        if (index >= 0) composedDeclarations.splice(index, 1);
        continue;
      }
      if (emittedForOriginal > 0 && !existingFact) extraDeclarationBudget--;
      emittedForOriginal++;
    }
    if (emittedForOriginal === 0) {
      composedDeclarations.push(original);
      composedById.set(original.id, original);
    }
  }
  if (unresolvedComposedRoutes > 0)
    limitations.push(
      `${unresolvedComposedRoutes} caminhos de endpoint não foram compostos por prefixo Express literal; o caminho local permanece como evidência estática.`,
    );
  if (unresolvedNestedExpressRoutes.size > 0)
    limitations.push(
      `${unresolvedNestedExpressRoutes.size} endpoints em routers Express aninhados não foram compostos cross-file porque a origem do prefixo interno não ficou provada.`,
    );
  if (cyclicRouterClosures.size > 0)
    limitations.push(
      `${cyclicRouterClosures.size} closures de routers Express com mounts cíclicos não foram compostos cross-file.`,
    );
  if (omittedComposedRoutes > 0) {
    omitted += omittedComposedRoutes;
    limitations.push(
      `${omittedComposedRoutes} variantes de endpoint Express cross-file foram omitidas pelos limites de declarações/proveniência.`,
    );
  }
  const usedDeclarationEvidence = new Set(
    composedDeclarations.flatMap((fact) => [
      fact.evidenceId,
      ...fact.derivations.map((item) => item.evidenceId),
    ]),
  );
  const supersededDeclarationEvidence = new Set(
    declarations.flatMap((fact) => [
      fact.evidenceId,
      ...fact.derivations.map((item) => item.evidenceId),
    ]),
  );
  const finalEvidence = evidence.filter(
    (item) =>
      (!supersededDeclarationEvidence.has(item.id) &&
        !generatedDeclarationEvidence.has(item.id)) ||
      usedDeclarationEvidence.has(item.id),
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
    edges: [...resolved.edges, ...expressEdges],
    evidence: finalEvidence,
    declarations: composedDeclarations,
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
