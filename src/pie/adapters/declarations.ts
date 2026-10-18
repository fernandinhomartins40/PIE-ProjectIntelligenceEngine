import { parseDocument, LineCounter, isMap, isScalar } from "yaml";
import { posix } from "node:path";
import { parseTree, findNodeAtLocation } from "jsonc-parser";
import type { AdapterRead, Declaration } from "./contracts.js";
import { readNginx } from "./nginx.js";
import { readLaravelDeclarations } from "./laravel.js";
import { readSqlMigration } from "./sqlMigration.js";
import { cachedAnalysis } from "../analysisCache.js";
import { sha256 } from "../evidence.js";
import { err, ok, type Result } from "../../domain/result.js";
import {
  AdapterParseFailure,
  type AdapterParseFailureKind,
} from "./parseFailure.js";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function manifest(path: string, source: string): AdapterRead {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    if (cause instanceof SyntaxError)
      throw new AdapterParseFailure("invalid_syntax");
    throw cause;
  }
  const parsed = object(value);
  if (!parsed) throw new AdapterParseFailure("invalid_structure");
  const tree = parseTree(source);
  if (!tree) throw new Error("Missing JSON syntax tree");
  const fieldLine = (group: string, name: string) => {
    const node = findNodeAtLocation(tree, [group, name]);
    return source
      .slice(0, node?.parent?.offset ?? node?.offset ?? 0)
      .split("\n").length;
  };
  const node = posix.basename(path) === "package.json";
  const adapter = node ? "node-manifest" : "composer-manifest";
  const declarations: Declaration[] = [];
  for (const group of node
    ? [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]
    : ["require", "require-dev"]) {
    for (const [name, specification] of Object.entries(
      object(parsed[group]) ?? {},
    )) {
      declarations.push({
        adapter,
        kind: "dependency",
        name,
        parent: group,
        line: fieldLine(group, name),
      });
      if (
        node &&
        typeof specification === "string" &&
        isMutableGitDependency(specification)
      )
        declarations.push({
          adapter,
          kind: "config_directive",
          name: `dependency.git_reference_unpinned:${sha256(specification)}`,
          parent: `${group}:${name}`,
          line: fieldLine(group, name),
        });
    }
  }
  // Persist script names, never their shell bodies or embedded credential values.
  for (const name of Object.keys(object(parsed.scripts) ?? {}))
    declarations.push({
      adapter,
      kind: "script",
      name,
      parent: null,
      line: fieldLine("scripts", name),
    });
  return {
    declarations,
    limitations: [
      "Dependências e scripts declarados não comprovam instalação, uso ou execução. Linhas JSON vêm da árvore sintática da propriedade.",
      "Referências Git são classificadas somente para dependências diretas do package.json e sem hash completo literal; o manifesto isolado não comprova a resolução final do gerenciador.",
    ],
  };
}

function isMutableGitDependency(specification: string): boolean {
  if (!isGitDependency(specification)) return false;
  const fragment = specification.split("#", 2)[1];
  return !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(fragment ?? "");
}

function isGitDependency(specification: string): boolean {
  return /^(?:git\+|git:|github:|gitlab:|bitbucket:|gist:)/iu.test(
    specification,
  );
}

function npmLockfile(source: string): AdapterRead {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(source);
  } catch (cause) {
    if (cause instanceof SyntaxError)
      throw new AdapterParseFailure("invalid_syntax");
    throw cause;
  }
  const parsed = object(parsedValue);
  if (!parsed) throw new AdapterParseFailure("invalid_structure");
  if (parsed.lockfileVersion !== 2 && parsed.lockfileVersion !== 3)
    return {
      declarations: [],
      limitations: [
        "Somente package-lock npm v2/v3 é analisado para resolução Git; versões diferentes permanecem desconhecidas.",
      ],
    };
  const packages = object(parsed.packages);
  const root = object(packages?.[""]);
  const tree = parseTree(source);
  if (!tree) throw new Error("Missing JSON syntax tree");
  const fieldLine = (segments: string[]) => {
    const node = findNodeAtLocation(tree, segments);
    return source
      .slice(0, node?.parent?.offset ?? node?.offset ?? 0)
      .split("\n").length;
  };
  const declarations: Declaration[] = [];
  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = object(root?.[group]);
    if (!dependencies) continue;
    for (const [name, specification] of Object.entries(dependencies)) {
      if (
        typeof specification !== "string" ||
        !isMutableGitDependency(specification)
      )
        continue;
      const packagePath = `node_modules/${name}`;
      const resolved = object(packages?.[packagePath])?.resolved;
      if (typeof resolved !== "string" || !isGitDependency(resolved)) continue;
      const commit = resolved.split("#", 2)[1] ?? "";
      if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(commit)) continue;
      declarations.push({
        adapter: "npm-lockfile",
        kind: "config_directive",
        name: `dependency.git_reference_locked:${sha256(specification)}`,
        parent: `${group}:${name}`,
        line: fieldLine(["packages", "", packagePath, "resolved"]),
      });
    }
  }
  return {
    declarations,
    limitations: [
      "Somente package-lock npm v2/v3 com spec raiz idêntica e resolução direta Git em SHA completo pode confirmar pinning; aliases, workspaces e resolução final não são analisados.",
    ],
  };
}

function structured(path: string, source: string): AdapterRead {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter, uniqueKeys: true });
  if (document.errors.length) throw new AdapterParseFailure("invalid_syntax");
  const parsed = object(document.toJS({ maxAliasCount: 50 }));
  if (!parsed) throw new AdapterParseFailure("invalid_structure");
  const lineAt = (segments: string[]): number => {
    const parent = document.getIn(segments.slice(0, -1), true);
    if (!isMap(parent)) return 1;
    const key = parent.items.find(
      (pair) => isScalar(pair.key) && pair.key.value === segments.at(-1),
    )?.key;
    return isScalar(key) && key.range
      ? lineCounter.linePos(key.range[0]).line
      : 1;
  };
  const declarations: Declaration[] = [];
  const isCompose = /(?:^|\/)(?:docker-)?compose[^/]*\.ya?ml$/i.test(path);
  if (isCompose) {
    const services = object(parsed.services);
    if (!services) throw new AdapterParseFailure("invalid_structure");
    for (const [name, raw] of Object.entries(services)) {
      const service = object(raw);
      if (!service) continue;
      const line = lineAt(["services", name]);
      declarations.push({
        adapter: "compose",
        kind: "service",
        name,
        parent: null,
        line,
      });
      const depends = Array.isArray(service.depends_on)
        ? service.depends_on.filter(
            (item): item is string => typeof item === "string",
          )
        : Object.keys(object(service.depends_on) ?? {});
      for (const dependency of depends)
        declarations.push({
          adapter: "compose",
          kind: "service_dependency",
          name: dependency,
          parent: name,
          line,
        });
    }
    return {
      declarations,
      limitations: [
        "Compose declarado; interpolação, include, extends, profiles e comportamento de containers não resolvidos. Nenhum valor de environment, build ou secrets é retido.",
      ],
    };
  }
  if (typeof parsed.openapi !== "string" || !/^3\.[01]\./.test(parsed.openapi))
    throw new AdapterParseFailure("unsupported_format");
  for (const [route, raw] of Object.entries(object(parsed.paths) ?? {})) {
    if (!route.startsWith("/")) continue;
    for (const method of [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "options",
      "head",
      "trace",
    ]) {
      if (!object(object(raw)?.[method])) continue;
      const line = lineAt(["paths", route, method]);
      declarations.push({
        adapter: "openapi",
        kind: "endpoint",
        name: `${method.toUpperCase()} ${route}`,
        parent: null,
        line,
      });
    }
  }
  return {
    declarations,
    limitations: [
      "Operações OpenAPI literais declaradas; $ref, servidores, autenticação efetiva, resposta e persistência não verificados. URLs e exemplos não são retidos nem acessados.",
    ],
  };
}

function githubActionsWorkflow(source: string): AdapterRead {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter, uniqueKeys: true });
  if (document.errors.length) throw new AdapterParseFailure("invalid_syntax");
  const parsed = object(document.toJS({ maxAliasCount: 50 }));
  if (!parsed) throw new AdapterParseFailure("invalid_structure");
  const lineAt = (segments: string[]) => {
    const parent = document.getIn(segments.slice(0, -1), true);
    if (!isMap(parent)) return 1;
    const key = parent.items.find(
      (pair) => isScalar(pair.key) && pair.key.value === segments.at(-1),
    )?.key;
    return isScalar(key) && key.range
      ? lineCounter.linePos(key.range[0]).line
      : 1;
  };
  const declarations: Declaration[] = [];
  const addWriteAll = () => {
    const segments = ["permissions"];
    const node = document.getIn(segments, true);
    if (!isScalar(node) || node.value !== "write-all") return;
    declarations.push({
      adapter: "github-actions",
      kind: "config_directive",
      name: "workflow.permissions.write-all",
      parent: null,
      line: lineAt(segments),
    });
  };
  addWriteAll();
  const jobs = document.getIn(["jobs"], true);
  if (isMap(jobs)) {
    for (const job of jobs.items) {
      if (!isScalar(job.key) || typeof job.key.value !== "string") continue;
      const jobName = job.key.value;
      const segments = ["jobs", jobName, "permissions"];
      const permissions = document.getIn(segments, true);
      if (!isScalar(permissions) || permissions.value !== "write-all") continue;
      declarations.push({
        adapter: "github-actions",
        kind: "config_directive",
        name: "job.permissions.write-all",
        parent: jobName,
        line: lineAt(segments),
      });
    }
  }
  return {
    declarations,
    limitations: [
      "GitHub Actions: declara write-all literal no workflow ou job; permissões granulares, eventos, expressões e execução efetiva não são avaliados.",
    ],
  };
}

/** Lexer recognizes declarations while ignoring quoted literals and comments. */
function prismaTokens(source: string) {
  const tokens: Array<{ value: string; line: number; literal?: boolean }> = [];
  let line = 1;
  const pattern =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_]*|[{}\n]|[^\s]/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[0];
    if (
      value === '"' ||
      (source.startsWith("/*", match.index) && !value.startsWith("/*"))
    )
      throw new AdapterParseFailure("invalid_syntax");
    if (!value.startsWith("//") && !value.startsWith("/*")) {
      if (value.startsWith('"')) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(value);
        } catch {
          throw new AdapterParseFailure("invalid_syntax");
        }
        if (typeof decoded === "string")
          tokens.push({ value: decoded, line, literal: true });
      } else {
        tokens.push({ value, line });
      }
    }
    line += (value.match(/\n/g) ?? []).length;
  }
  return tokens;
}

function prismaRelationColumns(
  tokens: Array<{ value: string; line: number; literal?: boolean }>,
  line: number,
) {
  const attribute = tokens.findIndex(
    (token, index) =>
      !token.literal &&
      token.value === "@" &&
      token.line === line &&
      !tokens[index + 1]?.literal &&
      tokens[index + 1]?.value === "relation",
  );
  const open = tokens.findIndex(
    (token, index) =>
      index > attribute + 1 && token.line === line && token.value === "(",
  );
  if (attribute < 0 || open < 0)
    return { sourceFields: null, targetFields: null };
  const readList = (key: string): string[] | null => {
    for (let index = open + 1; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (token.value === ")") break;
      if (
        token.literal ||
        token.value !== key ||
        tokens[index + 1]?.value !== ":"
      )
        continue;
      let cursor = index + 2;
      while (tokens[cursor]?.value === "\n") cursor++;
      if (tokens[cursor]?.value !== "[") return null;
      const names: string[] = [];
      for (cursor++; cursor < tokens.length; cursor++) {
        const item = tokens[cursor]!;
        if (item.value === "]") return names;
        if (item.value === "," || item.value === "\n") continue;
        if (item.literal || !/^[A-Za-z_]\w*$/.test(item.value)) return null;
        names.push(item.value);
      }
      return null;
    }
    return null;
  };
  return {
    sourceFields: readList("fields"),
    targetFields: readList("references"),
  };
}

function prismaFieldList(
  tokens: Array<{ value: string; line: number; literal?: boolean }>,
  open: number,
): string[] | null {
  if (tokens[open]?.value !== "(") return null;
  let cursor = open + 1;
  while (tokens[cursor]?.value === "\n") cursor++;
  if (tokens[cursor]?.value !== "[") return null;
  const fields: string[] = [];
  let expectField = true;
  for (cursor++; cursor < tokens.length; cursor++) {
    const token = tokens[cursor]!;
    if (token.value === "\n") continue;
    if (token.value === "]")
      return !expectField && fields.length > 0 ? fields : null;
    if (token.value === ",") {
      if (expectField) return null;
      expectField = true;
      continue;
    }
    if (
      token.literal ||
      expectField === false ||
      !/^[A-Za-z_]\w*$/.test(token.value)
    )
      return null;
    fields.push(token.value);
    expectField = false;
  }
  return null;
}

function prisma(source: string): AdapterRead {
  const tokens = prismaTokens(source);
  const declarations: Declaration[] = [];
  const modelNames = new Set(
    tokens.flatMap((token, index) =>
      !token.literal &&
      token.value === "model" &&
      !tokens[index + 1]?.literal &&
      tokens[index + 2]?.value === "{"
        ? [tokens[index + 1]!.value]
        : [],
    ),
  );
  const fieldAttributes = new Set([
    "@id",
    "@unique",
    "@relation",
    "@default",
    "@map",
  ]);
  const modelAttributes = new Set(["@@id", "@@unique", "@@map"]);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (
      token.literal ||
      token.value !== "model" ||
      !tokens[i + 1] ||
      tokens[i + 1]?.literal ||
      tokens[i + 2]?.value !== "{"
    )
      continue;
    const model = tokens[i + 1]!.value;
    declarations.push({
      adapter: "prisma-schema",
      kind: "model",
      name: model,
      parent: null,
      line: token.line,
    });
    i += 3;
    let depth = 1;
    let previousLine = -1;
    const fieldsByLine = new Map<number, string>();
    const relationFieldsByLine = new Map<
      number,
      { field: string; target: string }
    >();
    const modelTokens: typeof tokens = [];
    for (; i < tokens.length && depth > 0; i++) {
      const field = tokens[i]!;
      modelTokens.push(field);
      if (field.value === "{") depth++;
      if (field.value === "}") {
        depth--;
        continue;
      }
      if (
        depth === 1 &&
        !field.literal &&
        field.line !== previousLine &&
        /^[A-Za-z_]\w*$/.test(field.value) &&
        !tokens[i + 1]?.literal &&
        /^[A-Za-z_]\w*$/.test(tokens[i + 1]?.value ?? "") &&
        tokens[i + 1]?.line === field.line
      ) {
        fieldsByLine.set(field.line, field.value);
        declarations.push({
          adapter: "prisma-schema",
          kind: "field",
          name: field.value,
          parent: model,
          line: field.line,
        });
        const targetModel = tokens[i + 1]!.value;
        if (modelNames.has(targetModel))
          relationFieldsByLine.set(field.line, {
            field: field.value,
            target: targetModel,
          });
      }
      if (field.value !== "\n") previousLine = field.line;
    }
    for (let tokenIndex = 0; tokenIndex < modelTokens.length; tokenIndex++) {
      const attribute = modelTokens[tokenIndex]!;
      if (attribute.literal || attribute.value !== "@") continue;
      const next = modelTokens[tokenIndex + 1];
      if (
        !next ||
        next.literal ||
        next.line !== attribute.line ||
        !/^[A-Za-z_]\w*$/.test(next.value)
      )
        continue;
      const doubled =
        modelTokens[tokenIndex - 1]?.value === "@" &&
        modelTokens[tokenIndex - 1]?.line === attribute.line;
      if (doubled) continue;
      const name = `@${next.value}`;
      if (!fieldAttributes.has(name)) continue;
      const fieldName = fieldsByLine.get(attribute.line);
      if (name === "@map" && fieldName) {
        let targetIndex = tokenIndex + 3;
        while (modelTokens[targetIndex]?.value === "\n") targetIndex++;
        const target = modelTokens[targetIndex];
        let closeIndex = targetIndex + 1;
        while (modelTokens[closeIndex]?.value === "\n") closeIndex++;
        const close = modelTokens[closeIndex];
        const mappedColumn =
          modelTokens[tokenIndex + 2]?.value === "(" &&
          target?.literal &&
          target.value.length > 0 &&
          close?.value === ")"
            ? `${model}.${fieldName}.${target.value}`
            : `${model}.${fieldName}`;
        declarations.push({
          adapter: "prisma-schema",
          kind: "config_directive",
          name,
          parent:
            mappedColumn.length <= 1000
              ? mappedColumn
              : `${model}.${fieldName}`,
          line: attribute.line,
        });
        continue;
      }
      declarations.push({
        adapter: "prisma-schema",
        kind: "config_directive",
        name,
        parent: fieldName ? `${model}.${fieldName}` : model,
        ...(["@id", "@unique"].includes(name) && fieldName
          ? {
              relation: {
                field: null,
                sourceFields: [fieldName],
                targetFields: null,
              },
            }
          : {}),
        line: attribute.line,
      });
    }
    for (const [line, relation] of relationFieldsByLine) {
      declarations.push({
        adapter: "prisma-schema",
        kind: "schema_relation",
        name: relation.target,
        parent: model,
        relation: {
          field: relation.field,
          ...prismaRelationColumns(modelTokens, line),
        },
        line,
      });
    }
    for (let tokenIndex = 0; tokenIndex < modelTokens.length; tokenIndex++) {
      const attribute = modelTokens[tokenIndex]!;
      if (
        attribute.literal ||
        attribute.value !== "@" ||
        modelTokens[tokenIndex + 1]?.literal ||
        modelTokens[tokenIndex + 1]?.value !== "@" ||
        modelTokens[tokenIndex + 1]?.line !== attribute.line
      )
        continue;
      const nameToken = modelTokens[tokenIndex + 2];
      if (!nameToken || nameToken.literal || nameToken.line !== attribute.line)
        continue;
      const name = `@@${nameToken.value}`;
      if (!modelAttributes.has(name)) continue;
      if (name === "@@map") {
        const open = modelTokens[tokenIndex + 3];
        let targetIndex = tokenIndex + 4;
        while (modelTokens[targetIndex]?.value === "\n") targetIndex++;
        const target = modelTokens[targetIndex];
        let closeIndex = targetIndex + 1;
        while (modelTokens[closeIndex]?.value === "\n") closeIndex++;
        const close = modelTokens[closeIndex];
        const mappedTable =
          open?.value === "(" &&
          target?.literal &&
          target.value.length > 0 &&
          close?.value === ")"
            ? `${model}.${target.value}`
            : model;
        declarations.push({
          adapter: "prisma-schema",
          kind: "config_directive",
          name,
          parent: mappedTable.length <= 1000 ? mappedTable : model,
          line: attribute.line,
        });
        continue;
      }
      declarations.push({
        adapter: "prisma-schema",
        kind: "config_directive",
        name,
        parent: model,
        ...(["@@id", "@@unique"].includes(name)
          ? {
              relation: {
                field: null,
                sourceFields: prismaFieldList(modelTokens, tokenIndex + 3),
                targetFields: null,
              },
            }
          : {}),
        line: attribute.line,
      });
    }
    i--;
  }
  return {
    declarations,
    limitations: [
      "Lexer Prisma registra modelos, campos, seletores e @@map; outras strings nao geram declaracoes. Nao valida semantica, migrations, constraints efetivas ou banco. Campos devem estar em linhas proprias.",
    ],
  };
}

export function readDeclarations(
  path: string,
  source: string,
  limit: number,
): AdapterRead | null {
  return cachedAnalysis(
    ["pie-declarations-v11", path, sha256(source), limit],
    () => readDeclarationsUncached(path, source, limit),
  );
}

/** Typed expected source failures; programming and I/O errors are not swallowed. */
export function readDeclarationsResult(
  path: string,
  source: string,
  limit: number,
): Result<AdapterRead | null, { kind: AdapterParseFailureKind; path: string }> {
  try {
    return ok(readDeclarations(path, source, limit));
  } catch (cause) {
    if (cause instanceof AdapterParseFailure)
      return err({ kind: cause.kind, path });
    throw cause;
  }
}

function readDeclarationsUncached(
  path: string,
  source: string,
  limit: number,
): AdapterRead | null {
  let parsed: AdapterRead;
  if (/(?:^|\/)nginx(?:\.[^/]*)?\.conf$|(?:^|\/)nginx\/.*\.conf$/.test(path))
    return readNginx(source, limit);
  if (/(?:^|\/)routes\/.+\.php$/i.test(path))
    parsed = readLaravelDeclarations(path, source, limit);
  else if (/(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(path))
    parsed = githubActionsWorkflow(source);
  else if (/(?:^|\/)(package|composer)\.json$/.test(path))
    parsed = manifest(path, source);
  else if (/(?:^|\/)package-lock\.json$/.test(path))
    parsed = npmLockfile(source);
  else if (
    /(?:^|\/)(?:(?:docker-)?compose[^/]*\.ya?ml|(?:openapi|swagger)[^/]*\.(?:json|ya?ml))$/i.test(
      path,
    )
  )
    parsed = structured(path, source);
  else if (path.endsWith(".prisma")) parsed = prisma(source);
  else if (/(?:^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/i.test(path))
    parsed = readSqlMigration(source);
  else return null;
  const omitted = Math.max(0, parsed.declarations.length - limit);
  const selected = parsed.declarations.slice(0, limit);
  const declarations = selected.filter(
    (item) =>
      item.name.length > 0 &&
      item.name.length <= 1000 &&
      (item.parent?.length ?? 0) <= 1000,
  );
  const invalid = selected.length - declarations.length;
  return {
    declarations,
    limitations: [
      ...parsed.limitations,
      ...(omitted
        ? [`${omitted} declarações omitidas por limite de recursos.`]
        : []),
      ...(invalid
        ? [
            `${invalid} identificadores vazios ou acima do limite não foram retidos.`,
          ]
        : []),
    ],
  };
}
