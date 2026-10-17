import type {
  File,
  Node,
  VariableDeclaration,
  CallExpression,
  ImportDeclaration,
} from "@babel/types";
import { getBindingIdentifiers } from "@babel/types";
import type { AdapterRead, Declaration } from "./contracts.js";

type Binding = "factory" | "router-factory" | "app" | "router";
const methods = new Set([
  "get",
  "head",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "trace",
  "connect",
  "all",
]);
const memberName = (node: Node) =>
  node.type === "Identifier"
    ? node.name
    : node.type === "StringLiteral"
      ? node.value
      : null;

function isExpressRequire(call: CallExpression) {
  return (
    call.callee.type === "Identifier" &&
    call.callee.name === "require" &&
    call.arguments.length === 1 &&
    call.arguments[0]?.type === "StringLiteral" &&
    call.arguments[0].value === "express"
  );
}

function bindImport(
  statement: ImportDeclaration,
  bindings: Map<string, Binding>,
) {
  if (statement.source.value !== "express" || statement.importKind === "type")
    return;
  for (const item of statement.specifiers) {
    if (item.type === "ImportDefaultSpecifier")
      bindings.set(item.local.name, "factory");
    else if (
      item.type === "ImportSpecifier" &&
      item.importKind !== "type" &&
      memberName(item.imported) === "Router"
    )
      bindings.set(item.local.name, "router-factory");
  }
}

function constructorKind(
  call: CallExpression,
  bindings: Map<string, Binding>,
): Binding | null {
  const callee = call.callee;
  if (callee.type === "Identifier") {
    const kind = bindings.get(callee.name);
    return kind === "factory"
      ? "app"
      : kind === "router-factory"
        ? "router"
        : null;
  }
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    memberName(callee.property) === "Router" &&
    (!callee.computed || callee.property.type === "StringLiteral") &&
    bindings.get(callee.object.name) === "factory"
  )
    return "router";
  return null;
}

function bindVariables(
  statement: VariableDeclaration,
  bindings: Map<string, Binding>,
  requireShadowed: boolean,
) {
  if (statement.kind !== "const" || statement.declare) return;
  for (const variable of statement.declarations) {
    if (variable.init?.type !== "CallExpression") continue;
    const call = variable.init;
    const imported = !requireShadowed && isExpressRequire(call);
    if (variable.id.type === "Identifier") {
      const kind = imported ? "factory" : constructorKind(call, bindings);
      if (kind) bindings.set(variable.id.name, kind);
    } else if (imported && variable.id.type === "ObjectPattern") {
      for (const property of variable.id.properties)
        if (
          property.type === "ObjectProperty" &&
          !property.computed &&
          memberName(property.key) === "Router" &&
          property.value.type === "Identifier"
        )
          bindings.set(property.value.name, "router-factory");
    }
  }
}

function endpoint(
  call: CallExpression,
  bindings: Map<string, Binding>,
): Declaration | null {
  const callee = call.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    (callee.computed && callee.property.type !== "StringLiteral")
  )
    return null;
  const receiver = bindings.get(callee.object.name);
  const method = memberName(callee.property);
  if (
    (receiver !== "app" && receiver !== "router") ||
    !method ||
    !methods.has(method) ||
    call.arguments.length < 2
  )
    return null;
  const path = call.arguments[0];
  if (
    path?.type !== "StringLiteral" ||
    (!path.value.startsWith("/") && path.value !== "*")
  )
    return null;
  const name = `${method === "all" ? "ALL" : method.toUpperCase()} ${path.value}`;
  return {
    adapter: "express-ast",
    kind: "endpoint",
    name,
    parent: callee.object.name,
    line: call.loc?.start.line ?? 1,
  };
}

/** Top-level bindings only: nested/shadowed scopes are deliberately not interpreted. */
export function readExpressDeclarations(
  tree: File,
  limit: number,
): AdapterRead {
  const bindings = new Map<string, Binding>();
  const body = tree.program.body.map((statement) =>
    statement.type === "ExportNamedDeclaration" && statement.declaration
      ? statement.declaration
      : statement,
  );
  const requireShadowed = body.some((statement) =>
    Object.hasOwn(getBindingIdentifiers(statement, false, true), "require"),
  );
  const declarations: Declaration[] = [];
  let omitted = 0;
  for (const statement of body) {
    if (statement.type === "ImportDeclaration") bindImport(statement, bindings);
    if (statement.type === "VariableDeclaration")
      bindVariables(statement, bindings, requireShadowed);
    if (statement.type !== "ExpressionStatement") continue;
    if (statement.expression.type === "AssignmentExpression") {
      const left = statement.expression.left;
      if (left.type === "Identifier") bindings.delete(left.name);
      else if (
        left.type === "MemberExpression" &&
        left.object.type === "Identifier"
      )
        bindings.delete(left.object.name);
    }
    if (statement.expression.type !== "CallExpression") continue;
    const fact = endpoint(statement.expression, bindings);
    if (!fact) continue;
    if (
      declarations.length >= limit ||
      fact.name.length > 1000 ||
      (fact.parent?.length ?? 0) > 1000
    )
      omitted++;
    else declarations.push(fact);
  }
  return {
    declarations,
    limitations:
      bindings.size || declarations.length
        ? [
            "Express AST: somente bindings const/import e chamadas diretas no escopo superior com caminho literal. Parent identifica receptor local; prefixos de montagem de routers não resolvidos. Não comprova instalação, handler válido, autorização, listen ou disponibilidade HTTP.",
            "Escopos aninhados, aliases mutáveis, factories, cadeias route(), caminhos dinâmicos/arrays/regex e efeitos de código chamado não examinados; ausência de fato não prova ausência de endpoint.",
            ...(omitted
              ? [
                  `${omitted} declarações Express omitidas por limite de recursos/identificador.`,
                ]
              : []),
          ]
        : [],
  };
}
