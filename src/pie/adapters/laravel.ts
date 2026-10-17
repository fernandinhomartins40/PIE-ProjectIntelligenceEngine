import PHPParser from "php-parser";
import type { AdapterRead, Declaration } from "./contracts.js";
import { AdapterParseFailure } from "./parseFailure.js";

const facadeName = "illuminate\\support\\facades\\route";
const routeMethods = new Map<string, string[]>([
  ["get", ["GET"]],
  ["head", ["HEAD"]],
  ["post", ["POST"]],
  ["put", ["PUT"]],
  ["patch", ["PATCH"]],
  ["delete", ["DELETE"]],
  ["options", ["OPTIONS"]],
  ["any", ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]],
]);

type PhpNode = {
  [key: string]: unknown;
  kind: string;
  loc?: { start?: { line?: number } } | null;
};

function phpNode(value: unknown): PhpNode | null {
  return value && typeof value === "object" && "kind" in value
    ? (value as PhpNode)
    : null;
}

function nameOf(value: unknown): string | null {
  const node = phpNode(value);
  if (!node) return null;
  if (node.kind === "name" && typeof node.name === "string")
    return node.name.replace(/^\\+/, "").toLowerCase();
  if (node.kind === "identifier" && typeof node.name === "string")
    return node.name.toLowerCase();
  return null;
}

function literalString(value: unknown): string | null {
  const node = phpNode(value);
  return node?.kind === "string" && typeof node.value === "string"
    ? node.value
    : null;
}

function literalRouteMethods(value: PhpNode | undefined): string[] | null {
  if (value?.kind !== "array" || !Array.isArray(value.items)) return null;
  const allowed = new Set([...routeMethods.values()].flat());
  const methods: string[] = [];
  for (const rawItem of value.items) {
    const item = phpNode(rawItem);
    const method = literalString(
      item?.kind === "entry" ? item.value : rawItem,
    )?.toUpperCase();
    if (!method || !allowed.has(method)) return null;
    methods.push(method);
  }
  return methods.length ? [...new Set(methods)] : null;
}

function collectFacadeAliases(children: unknown[]): Set<string> {
  const candidates = new Map<string, { count: number; facade: boolean }>();
  const add = (path: string, alias: string | null) => {
    const normalized = path.replace(/^\\+/, "").toLowerCase();
    const name = (alias ?? path.split("\\").at(-1) ?? "").toLowerCase();
    if (!name) return;
    const previous = candidates.get(name);
    candidates.set(name, {
      count: (previous?.count ?? 0) + 1,
      facade: previous?.facade === true || normalized === facadeName,
    });
  };
  for (const childValue of children) {
    const child = phpNode(childValue);
    if (!child || child.kind !== "usegroup" || !Array.isArray(child.items))
      continue;
    const base = typeof child.name === "string" ? child.name : "";
    for (const rawItem of child.items) {
      const item = phpNode(rawItem);
      if (!item || typeof item.name !== "string") continue;
      const path = base ? `${base}\\${item.name}` : item.name;
      const alias =
        typeof item.alias === "string" ? item.alias : nameOf(item.alias);
      add(path, alias);
    }
  }
  return new Set(
    [...candidates]
      .filter(([, value]) => value.count === 1 && value.facade)
      .map(([name]) => name),
  );
}

function routeCall(
  node: PhpNode,
  aliases: ReadonlySet<string>,
): { method: string; args: PhpNode[] } | null {
  if (node.kind !== "call") return null;
  const what = phpNode(node.what);
  if (what?.kind !== "staticlookup") return null;
  const receiver = phpNode(what.what);
  const method = nameOf(what.offset);
  const facade = nameOf(receiver);
  if (!method || !facade || !(facade === facadeName || aliases.has(facade)))
    return null;
  const args = Array.isArray(node.arguments)
    ? node.arguments
        .map(phpNode)
        .filter((item): item is PhpNode => item !== null)
    : [];
  return { method, args };
}

type GroupPrefix = { prefix: string; unresolved: boolean };

function routeGroup(
  node: PhpNode,
  aliases: ReadonlySet<string>,
  current: GroupPrefix,
): { body: PhpNode; context: GroupPrefix } | null {
  if (node.kind !== "call") return null;
  const groupLookup = phpNode(node.what);
  const directGroup = routeCall(node, aliases)?.method === "group";
  const fluentGroup =
    groupLookup?.kind === "propertylookup" &&
    nameOf(groupLookup.offset) === "group";
  if (!directGroup && !fluentGroup) return null;
  const args = Array.isArray(node.arguments)
    ? node.arguments
        .map(phpNode)
        .filter((item): item is PhpNode => item !== null)
    : [];
  const callback = args.find((item) => item.kind === "closure");
  const body = phpNode(callback?.body);
  if (body?.kind !== "block") return null;

  let cursor = directGroup ? groupLookup : phpNode(groupLookup?.what);
  const prefixes: string[] = [];
  let resolvedFacade = false;
  let unresolved = current.unresolved;
  const options = args[0];
  if (options?.kind === "array" && Array.isArray(options.items))
    for (const rawEntry of options.items) {
      const entry = phpNode(rawEntry);
      if (!entry || literalString(entry.key) !== "prefix") continue;
      const value = literalString(entry.value);
      if (value === null) unresolved = true;
      else prefixes.unshift(value);
    }
  while (cursor) {
    if (cursor.kind === "staticlookup") {
      const receiver = nameOf(cursor.what);
      resolvedFacade = Boolean(
        receiver && (receiver === facadeName || aliases.has(receiver)),
      );
      break;
    }
    if (cursor.kind !== "call") break;
    const lookup = phpNode(cursor.what);
    if (lookup?.kind === "staticlookup") {
      if (nameOf(lookup.offset) === "prefix") {
        const callArgs = Array.isArray(cursor.arguments)
          ? cursor.arguments
          : [];
        const prefix = literalString(callArgs[0]);
        if (prefix === null) unresolved = true;
        else prefixes.unshift(prefix);
      }
      const receiver = nameOf(lookup.what);
      resolvedFacade = Boolean(
        receiver && (receiver === facadeName || aliases.has(receiver)),
      );
      break;
    }
    if (lookup?.kind !== "propertylookup") break;
    const method = nameOf(lookup.offset);
    if (method === "prefix") {
      const callArgs = Array.isArray(cursor.arguments) ? cursor.arguments : [];
      const prefix = literalString(callArgs[0]);
      if (prefix === null) unresolved = true;
      else prefixes.unshift(prefix);
    }
    cursor = phpNode(lookup.what);
  }
  if (!resolvedFacade) return null;
  if (prefixes.length > 1) unresolved = true;
  const prefix = prefixes[0];
  const combined =
    prefix === undefined
      ? current.prefix
      : [current.prefix, prefix].filter(Boolean).join("/").replace(/\/+/g, "/");
  return { body, context: { prefix: combined, unresolved } };
}

function routePath(prefix: string, path: string): string {
  const segments = [prefix, path]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  return `/${segments.join("/")}`;
}

/** Static Laravel route declarations only; target PHP is parsed, never executed. */
export function readLaravelDeclarations(
  path: string,
  source: string,
  limit: number,
): AdapterRead {
  const parser = new PHPParser.Engine({
    parser: { suppressErrors: false, version: "8.4" },
    ast: { withPositions: true },
    lexer: { short_tags: false, asp_tags: false },
  });
  let program: ReturnType<typeof parser.parseCode>;
  try {
    program = parser.parseCode(source, path);
  } catch (cause) {
    if (
      cause instanceof SyntaxError &&
      cause.message.startsWith("Parse Error : syntax error")
    )
      throw new AdapterParseFailure("invalid_syntax");
    throw cause;
  }
  if (program.errors.length) throw new AdapterParseFailure("invalid_syntax");

  const rootAliases = collectFacadeAliases(program.children);
  const declarations: Declaration[] = [];
  const limitations = [
    "Laravel: parser configurado para a gramática PHP 8.4; somente chamadas AST estáticas Route::get/head/post/put/patch/delete/options/any e match com métodos literais, caminho literal e facade importada ou explicitamente qualificada são declaradas. Não comprova Laravel ativo, registro, middleware/autorização, handler ou resposta HTTP.",
    "Grupos com closure e prefixo literal são compostos; resource/apiResource, match com métodos dinâmicos, aliases ambíguos, prefixos dinâmicos, providers/includes e registro em runtime não são resolvidos.",
    "Rotas declaradas dentro de funções/classes não são contadas; branches condicionais, loops, modificadores fluentes fora de groups e seus efeitos não são avaliados.",
    "Sintaxe rejeitada pela gramática configurada não estabelece invalidade em outra versão do PHP; nenhum fato é inferido quando o parser não produz AST válido.",
  ];
  let omitted = 0;
  let unresolved = 0;
  let visited = 0;
  let bounded = false;
  const pending: Array<{
    node: PhpNode;
    aliases: ReadonlySet<string>;
    context: GroupPrefix;
    depth: number;
  }> = program.children
    .map(phpNode)
    .filter((item): item is PhpNode => item !== null)
    .map((node) => ({
      node,
      aliases:
        node.kind === "namespace" && Array.isArray(node.children)
          ? collectFacadeAliases(node.children)
          : rootAliases,
      context: { prefix: "", unresolved: false },
      depth: 0,
    }));

  while (pending.length) {
    const current = pending.pop()!;
    if (++visited > 50_000 || current.depth > 256) {
      bounded = true;
      break;
    }
    const group = routeGroup(current.node, current.aliases, current.context);
    if (group) {
      pending.push({
        node: group.body,
        aliases: current.aliases,
        context: group.context,
        depth: current.depth + 1,
      });
      continue;
    }
    const call = routeCall(current.node, current.aliases);
    if (call) {
      const matchMethods =
        call.method === "match" ? literalRouteMethods(call.args[0]) : null;
      const methods =
        call.method === "match"
          ? (matchMethods ?? undefined)
          : routeMethods.get(call.method);
      if (methods) {
        const route = literalString(call.args[call.method === "match" ? 1 : 0]);
        if (!route || current.context.unresolved) unresolved++;
        else
          for (const method of methods) {
            const name = `${method} ${routePath(current.context.prefix, route)}`;
            if (name.length > 1000 || declarations.length >= limit) omitted++;
            else
              declarations.push({
                adapter: "laravel-php",
                kind: "endpoint",
                name,
                parent: null,
                line: current.node.loc?.start?.line ?? 1,
              });
          }
      } else if (
        call.method === "match" ||
        call.method === "resource" ||
        call.method === "apiresource"
      ) {
        unresolved++;
      }
      continue;
    }
    if (
      ["function", "method", "class", "closure", "arrowfunc"].includes(
        current.node.kind,
      )
    )
      continue;
    for (const [key, value] of Object.entries(current.node)) {
      if (["loc", "leadingComments", "trailingComments", "kind"].includes(key))
        continue;
      const values = Array.isArray(value) ? value : [value];
      for (const child of values) {
        const parsed = phpNode(child);
        if (parsed) {
          const aliases =
            parsed.kind === "namespace" && Array.isArray(parsed.children)
              ? collectFacadeAliases(parsed.children)
              : current.aliases;
          pending.push({
            node: parsed,
            aliases,
            context: current.context,
            depth: current.depth + 1,
          });
        }
      }
    }
  }
  return {
    declarations,
    limitations: [
      ...limitations,
      ...(unresolved
        ? [
            `${unresolved} rotas Laravel estáticas ou recursos não foram compostos por caminho/grupo não literal ou forma não suportada.`,
          ]
        : []),
      ...(omitted
        ? [
            `${omitted} declarações Laravel omitidas por limite de recursos/identificador.`,
          ]
        : []),
      ...(bounded
        ? [
            "Traversal AST PHP interrompido pelo limite de 50.000 nós/256 níveis; cobertura parcial.",
          ]
        : []),
    ],
  };
}
