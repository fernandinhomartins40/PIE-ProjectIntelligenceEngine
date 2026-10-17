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
type RouterMount = {
  receiver: string;
  prefix: string;
  router: string;
  line: number;
  imported?: ExpressRouterImport;
};
export type ExpressRouterImport = {
  specifier: string;
  importedName: string;
  localName: string;
  line: number;
  syntax?: "commonjs";
};
export type ExpressRouterExport = {
  exportName: string;
  localName: string;
  line: number;
  syntax?: "commonjs";
};
export type ExpressRouterReExport = {
  exportName: string;
  importedName: string;
  specifier: string;
  line: number;
};
export type ExpressLocalRouterMount = {
  receiver: string;
  prefix: string;
  router: string;
  line: number;
};
export type ExpressCrossFileMount = ExpressRouterImport & {
  prefix: string;
  mountLine: number;
};
export type ExpressRead = AdapterRead & {
  crossFileMounts: ExpressCrossFileMount[];
  routerMounts: ExpressLocalRouterMount[];
  routerExports: ExpressRouterExport[];
  routerReExports: ExpressRouterReExport[];
  omittedCrossFileFacts: number;
};
type RouterDerivation = {
  line: number;
  operation: "express_router_mount";
  prefix: string;
};
type RouterPrefix = { path: string; derivations: RouterDerivation[] };
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
  importedRouters: Map<string, ExpressRouterImport>,
) {
  if (statement.importKind === "type") return;
  if (statement.source.value !== "express") {
    if (!statement.source.value.startsWith(".")) return;
    for (const item of statement.specifiers) {
      if (item.type === "ImportSpecifier" && item.importKind === "type")
        continue;
      const importedName =
        item.type === "ImportDefaultSpecifier"
          ? "default"
          : item.type === "ImportSpecifier"
            ? memberName(item.imported)
            : null;
      if (!importedName) continue;
      const value = {
        specifier: statement.source.value,
        importedName,
        localName: item.local.name,
        line: statement.loc?.start.line ?? 1,
      };
      importedRouters.set(item.local.name, value);
    }
    return;
  }
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
  importedRouters: Map<string, ExpressRouterImport>,
) {
  if (statement.kind !== "const" || statement.declare) return;
  for (const variable of statement.declarations) {
    if (variable.init?.type !== "CallExpression") continue;
    const call = variable.init;
    const imported = !requireShadowed && isExpressRequire(call);
    const commonJsSpecifier =
      !requireShadowed &&
      call.callee.type === "Identifier" &&
      call.callee.name === "require" &&
      call.arguments.length === 1 &&
      call.arguments[0]?.type === "StringLiteral" &&
      call.arguments[0].value.startsWith(".")
        ? call.arguments[0].value
        : null;
    if (variable.id.type === "Identifier") {
      const kind = imported ? "factory" : constructorKind(call, bindings);
      if (kind) bindings.set(variable.id.name, kind);
      else if (commonJsSpecifier)
        importedRouters.set(variable.id.name, {
          specifier: commonJsSpecifier,
          importedName: "default",
          localName: variable.id.name,
          line: call.loc?.start.line ?? 1,
          syntax: "commonjs",
        });
    } else if (imported && variable.id.type === "ObjectPattern") {
      for (const property of variable.id.properties)
        if (
          property.type === "ObjectProperty" &&
          !property.computed &&
          memberName(property.key) === "Router" &&
          property.value.type === "Identifier"
        )
          bindings.set(property.value.name, "router-factory");
    } else if (commonJsSpecifier && variable.id.type === "ObjectPattern") {
      for (const property of variable.id.properties) {
        if (
          property.type !== "ObjectProperty" ||
          property.computed ||
          property.value.type !== "Identifier"
        )
          continue;
        const importedName = memberName(property.key);
        if (!importedName) continue;
        importedRouters.set(property.value.name, {
          specifier: commonJsSpecifier,
          importedName,
          localName: property.value.name,
          line: call.loc?.start.line ?? 1,
          syntax: "commonjs",
        });
      }
    }
  }
}

function commonJsRouterExports(
  statement: Node,
  moduleShadowed: boolean,
  exportsShadowed: boolean,
): ExpressRouterExport[] {
  if (
    moduleShadowed ||
    exportsShadowed ||
    statement.type !== "ExpressionStatement" ||
    statement.expression.type !== "AssignmentExpression" ||
    statement.expression.operator !== "="
  )
    return [];
  const { left, right } = statement.expression;
  if (right.type === "Identifier") {
    if (
      left.type === "MemberExpression" &&
      !left.computed &&
      left.object.type === "Identifier" &&
      left.object.name === "module" &&
      left.property.type === "Identifier" &&
      left.property.name === "exports"
    )
      return [
        {
          exportName: "default",
          localName: right.name,
          line: statement.loc?.start.line ?? 1,
          syntax: "commonjs",
        },
      ];
    const commonJsObject =
      left.type === "Identifier" && left.name === "exports"
        ? true
        : left.type === "MemberExpression" &&
          left.object.type === "MemberExpression" &&
          !left.object.computed &&
          left.object.object.type === "Identifier" &&
          left.object.object.name === "module" &&
          left.object.property.type === "Identifier" &&
          left.object.property.name === "exports";
    if (commonJsObject && left.type === "MemberExpression") {
      const exportName = memberName(left.property);
      return exportName
        ? [
            {
              exportName,
              localName: right.name,
              line: statement.loc?.start.line ?? 1,
              syntax: "commonjs",
            },
          ]
        : [];
    }
  }
  if (
    left.type === "MemberExpression" &&
    !left.computed &&
    left.object.type === "Identifier" &&
    left.object.name === "module" &&
    left.property.type === "Identifier" &&
    left.property.name === "exports" &&
    right.type === "ObjectExpression"
  )
    return right.properties.flatMap((property) => {
      if (
        property.type !== "ObjectProperty" ||
        property.computed ||
        property.value.type !== "Identifier"
      )
        return [];
      const exportName = memberName(property.key);
      return exportName
        ? [
            {
              exportName,
              localName: property.value.name,
              line: property.loc?.start.line ?? 1,
              syntax: "commonjs" as const,
            },
          ]
        : [];
    });
  return [];
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

function mountedRouter(
  call: CallExpression,
  bindings: Map<string, Binding>,
  importedRouters: Map<string, ExpressRouterImport>,
): RouterMount[] {
  const callee = call.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    (callee.computed && callee.property.type !== "StringLiteral") ||
    memberName(callee.property) !== "use"
  )
    return [];
  const receiver = callee.object.name;
  const kind = bindings.get(receiver);
  if (kind !== "app" && kind !== "router") return [];
  let prefix = "";
  let firstRouterArgument = 0;
  const first = call.arguments[0];
  if (first?.type === "StringLiteral") {
    if (!first.value.startsWith("/") && first.value !== "*") return [];
    prefix = first.value;
    firstRouterArgument = 1;
  }
  return call.arguments.slice(firstRouterArgument).flatMap((argument) => {
    if (argument.type !== "Identifier") return [];
    const binding = bindings.get(argument.name);
    const imported = importedRouters.get(argument.name);
    if (binding !== "router" && !imported) return [];
    return [
      {
        receiver,
        prefix,
        router: argument.name,
        line: call.loc?.start.line ?? 1,
        ...(binding !== "router" && imported ? { imported } : {}),
      },
    ];
  });
}

export function joinExpressRoute(prefix: string, route: string): string | null {
  if (prefix === "*") return null;
  if (route === "*") return prefix ? null : "*";
  if (prefix === "" || prefix === "/") return route;
  return `${prefix.replace(/\/$/, "")}/${route.replace(/^\//, "")}`;
}

function routerPrefixes(
  mounts: readonly RouterMount[],
  exportedRouters: ReadonlySet<string>,
) {
  type Resolution = { prefixes: RouterPrefix[]; cyclic: boolean };
  const parents = new Map<string, RouterMount[]>();
  for (const mount of mounts) {
    const items = parents.get(mount.router) ?? [];
    items.push(mount);
    parents.set(mount.router, items);
  }
  const cache = new Map<string, Resolution>();
  const resolve: (router: string, visiting: Set<string>) => Resolution = (
    router,
    visiting,
  ) => {
    if (exportedRouters.has(router))
      return {
        prefixes: [{ path: "", derivations: [] }],
        cyclic: false,
      };
    const known = cache.get(router);
    if (known) return known;
    if (visiting.has(router)) return { prefixes: [], cyclic: true };
    const nextVisiting = new Set(visiting).add(router);
    const prefixes: RouterPrefix[] = [];
    let cyclic = false;
    for (const mount of parents.get(router) ?? []) {
      const derivation: RouterDerivation = {
        line: mount.line,
        operation: "express_router_mount",
        prefix: mount.prefix,
      };
      if (mount.receiver === "app")
        prefixes.push({ path: mount.prefix, derivations: [derivation] });
      else {
        const ancestor = resolve(mount.receiver, nextVisiting);
        cyclic ||= ancestor.cyclic;
        for (const prefix of ancestor.prefixes) {
          const joined = joinExpressRoute(prefix.path, mount.prefix);
          if (joined === null) cyclic = true;
          else
            prefixes.push({
              path: joined,
              derivations: [...prefix.derivations, derivation],
            });
        }
      }
    }
    const byPath = new Map<string, RouterPrefix>();
    for (const item of prefixes) {
      const known = byPath.get(item.path);
      if (!known) {
        byPath.set(item.path, {
          path: item.path,
          derivations: [...item.derivations],
        });
        continue;
      }
      const knownDerivations = new Set(
        known.derivations.map((entry) =>
          JSON.stringify([entry.line, entry.operation, entry.prefix]),
        ),
      );
      for (const derivation of item.derivations) {
        const key = JSON.stringify([
          derivation.line,
          derivation.operation,
          derivation.prefix,
        ]);
        if (!knownDerivations.has(key)) {
          known.derivations.push(derivation);
          knownDerivations.add(key);
        }
      }
    }
    const result = { prefixes: [...byPath.values()], cyclic };
    cache.set(router, result);
    return result;
  };
  return resolve;
}

/** Top-level bindings only: nested/shadowed scopes are deliberately not interpreted. */
export function readExpressDeclarations(
  tree: File,
  limit: number,
): ExpressRead {
  const bindings = new Map<string, Binding>();
  const importedRouters = new Map<string, ExpressRouterImport>();
  const exportCandidates: ExpressRouterExport[] = [];
  const reExportCandidates: ExpressRouterReExport[] = [];
  for (const statement of tree.program.body) {
    if (statement.type === "ExportNamedDeclaration") {
      if (
        statement.source &&
        statement.source.value.startsWith(".") &&
        statement.exportKind !== "type"
      )
        for (const specifier of statement.specifiers)
          if (
            specifier.type === "ExportSpecifier" &&
            specifier.exportKind !== "type"
          ) {
            const importedName = memberName(specifier.local);
            const exportName = memberName(specifier.exported);
            if (importedName && exportName)
              reExportCandidates.push({
                exportName,
                importedName,
                specifier: statement.source.value,
                line:
                  specifier.loc?.start.line ?? statement.loc?.start.line ?? 1,
              });
          }
      const declaration = statement.declaration;
      if (declaration?.type === "VariableDeclaration")
        for (const variable of declaration.declarations)
          if (variable.id.type === "Identifier")
            exportCandidates.push({
              exportName: variable.id.name,
              localName: variable.id.name,
              line: variable.loc?.start.line ?? statement.loc?.start.line ?? 1,
            });
      for (const specifier of statement.specifiers)
        if (specifier.type === "ExportSpecifier" && !statement.source) {
          const localName = memberName(specifier.local);
          const exportName = memberName(specifier.exported);
          if (localName && exportName)
            exportCandidates.push({
              exportName,
              localName,
              line: statement.loc?.start.line ?? specifier.loc?.start.line ?? 1,
            });
        }
    } else if (
      statement.type === "ExportDefaultDeclaration" &&
      statement.declaration.type === "Identifier"
    )
      exportCandidates.push({
        exportName: "default",
        localName: statement.declaration.name,
        line: statement.loc?.start.line ?? 1,
      });
  }
  const body = tree.program.body.map((statement) =>
    statement.type === "ExportNamedDeclaration" && statement.declaration
      ? statement.declaration
      : statement,
  );
  const requireShadowed = body.some((statement) =>
    Object.hasOwn(getBindingIdentifiers(statement, false, true), "require"),
  );
  const moduleShadowed = body.some((statement) =>
    Object.hasOwn(getBindingIdentifiers(statement, false, true), "module"),
  );
  const exportsShadowed = body.some((statement) =>
    Object.hasOwn(getBindingIdentifiers(statement, false, true), "exports"),
  );
  for (const statement of body)
    exportCandidates.push(
      ...commonJsRouterExports(statement, moduleShadowed, exportsShadowed),
    );
  const declarations: Declaration[] = [];
  const routes: Declaration[] = [];
  const mounts: RouterMount[] = [];
  let omitted = 0;
  for (const statement of body) {
    if (statement.type === "ImportDeclaration")
      bindImport(statement, bindings, importedRouters);
    if (statement.type === "VariableDeclaration")
      bindVariables(statement, bindings, requireShadowed, importedRouters);
    if (statement.type !== "ExpressionStatement") continue;
    if (statement.expression.type === "AssignmentExpression") {
      const left = statement.expression.left;
      if (left.type === "Identifier") {
        bindings.delete(left.name);
        importedRouters.delete(left.name);
      } else if (
        left.type === "MemberExpression" &&
        left.object.type === "Identifier"
      ) {
        bindings.delete(left.object.name);
        importedRouters.delete(left.object.name);
      }
    }
    if (statement.expression.type !== "CallExpression") continue;
    mounts.push(
      ...mountedRouter(statement.expression, bindings, importedRouters),
    );
    const route = endpoint(statement.expression, bindings);
    if (route) routes.push(route);
  }
  const routerExports = exportCandidates.filter(
    (item) => bindings.get(item.localName) === "router",
  );
  const resolvePrefixes = routerPrefixes(
    mounts,
    new Set(routerExports.map((item) => item.localName)),
  );
  const crossFileMounts = mounts.flatMap((mount) =>
    mount.imported
      ? [{ ...mount.imported, prefix: mount.prefix, mountLine: mount.line }]
      : [],
  );
  const boundedCrossFileMounts = crossFileMounts.slice(0, limit);
  const localMounts = mounts.filter((mount) => !mount.imported);
  const routerMounts = localMounts.slice(0, limit).map((mount) => ({
    receiver: mount.receiver,
    prefix: mount.prefix,
    router: mount.router,
    line: mount.line,
  }));
  const boundedRouterExports = routerExports.slice(0, limit);
  const routerReExports = reExportCandidates.slice(0, limit);
  const omittedCrossFileFacts =
    crossFileMounts.length -
    boundedCrossFileMounts.length +
    localMounts.length -
    routerMounts.length +
    routerExports.length -
    boundedRouterExports.length +
    reExportCandidates.length -
    routerReExports.length;
  let unresolvedMounts = 0;
  for (const route of routes) {
    const resolved =
      route.parent === "app"
        ? {
            prefixes: [{ path: "", derivations: [] as RouterDerivation[] }],
            cyclic: false,
          }
        : resolvePrefixes(route.parent!, new Set());
    const separator = route.name.indexOf(" ");
    const method = route.name.slice(0, separator);
    const localPath = route.name.slice(separator + 1);
    const resolvedPaths =
      route.parent === "app"
        ? [{ path: localPath, derivations: [] as RouterDerivation[] }]
        : resolved.cyclic
          ? []
          : resolved.prefixes.flatMap((prefix) => {
              const path = joinExpressRoute(prefix.path, localPath);
              return path === null
                ? []
                : [{ path, derivations: prefix.derivations }];
            });
    if (
      route.parent !== "app" &&
      (resolved.cyclic ||
        !resolved.prefixes.length ||
        resolvedPaths.length < resolved.prefixes.length)
    )
      unresolvedMounts++;
    const paths = resolvedPaths.length
      ? resolvedPaths
      : [{ path: localPath, derivations: [] as RouterDerivation[] }];
    for (const path of paths) {
      const fact = {
        ...route,
        name: `${method} ${path.path}`,
        ...(path.derivations.length ? { derivedFrom: path.derivations } : {}),
      };
      if (
        declarations.length >= limit ||
        fact.name.length > 1000 ||
        (fact.parent?.length ?? 0) > 1000
      )
        omitted++;
      else declarations.push(fact);
    }
  }
  return {
    declarations,
    crossFileMounts: boundedCrossFileMounts,
    routerMounts,
    routerExports: boundedRouterExports,
    routerReExports,
    omittedCrossFileFacts,
    limitations:
      bindings.size || declarations.length
        ? [
            "Express AST: somente bindings const/import e chamadas diretas no escopo superior com caminho literal; prefixos literais de app.use/router.use são compostos quando o router é alcançável por montagens estáticas. Isso não comprova instalação, handler válido, autorização, listen ou disponibilidade HTTP.",
            "Mounts por import relativo default/named e require CommonJS literal compõem prefixos quando a análise chega a um export local único de router (ESM ou module.exports direto). Reexports ESM são seguidos com dependências e Evidence por arquivo; ciclos, ambiguidades e destinos não observados permanecem sem resolução. Reexports CommonJS, namespaces, require sombreado/calculado, escopos aninhados, aliases mutáveis, factories, cadeias route(), caminhos dinâmicos/arrays/regex e efeitos de código chamado continuam não examinados; ausência de fato não prova ausência de endpoint.",
            ...(unresolvedMounts
              ? [
                  `${unresolvedMounts} rotas pertencem a routers sem montagem literal resolvida, wildcard ou em ciclo; seus caminhos podem permanecer locais ao router.`,
                ]
              : []),
            ...(omitted
              ? [
                  `${omitted} declarações Express omitidas por limite de recursos/identificador.`,
                ]
              : []),
          ]
        : [],
  };
}
