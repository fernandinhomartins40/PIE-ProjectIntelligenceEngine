import type { AdapterRead, Declaration } from "./contracts.js";
import { AdapterParseFailure } from "./parseFailure.js";

type Token = { value: string; line: number; quoted?: boolean };

function keyword(token: Token | undefined, value: string): boolean {
  return token?.quoted !== true && token?.value === value;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    const current = source[index]!;
    if (/\s/.test(current)) {
      if (current === "\n") line++;
      index++;
      continue;
    }
    if (source.startsWith("--", index)) {
      while (index < source.length && source[index] !== "\n") index++;
      if (source[index] === "\n") {
        line++;
        index++;
      }
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth++;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth--;
          index += 2;
        } else {
          if (source[index] === "\n") line++;
          index++;
        }
      }
      if (depth !== 0) throw new AdapterParseFailure("invalid_syntax");
      continue;
    }
    if (current === "'") {
      index++;
      let closed = false;
      while (index < source.length) {
        if (source[index] === "\n") line++;
        if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (source[index] === "'") {
          index++;
          closed = true;
          break;
        }
        if (source[index] === "\\") index++;
        index++;
      }
      if (!closed) throw new AdapterParseFailure("invalid_syntax");
      continue;
    }
    const dollarTag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
      source.slice(index),
    )?.[0];
    if (dollarTag) {
      const end = source.indexOf(dollarTag, index + dollarTag.length);
      if (end < 0) throw new AdapterParseFailure("invalid_syntax");
      line += (source.slice(index, end + dollarTag.length).match(/\n/g) ?? [])
        .length;
      index = end + dollarTag.length;
      continue;
    }
    if (current === '"') {
      const tokenLine = line;
      let value = "";
      index++;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        if (source[index] === '"') {
          index++;
          closed = true;
          break;
        }
        if (source[index] === "\n") line++;
        value += source[index]!;
        index++;
      }
      if (!closed) throw new AdapterParseFailure("invalid_syntax");
      tokens.push({ value, line: tokenLine, quoted: true });
      continue;
    }
    const tokenLine = line;
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(index))?.[0];
    if (word) {
      tokens.push({ value: word.toLowerCase(), line: tokenLine });
      index += word.length;
      continue;
    }
    if ("(),.;".includes(current)) tokens.push({ value: current, line });
    index++;
  }
  return tokens;
}

function identifier(tokens: Token[], index: number): string | null {
  const token = tokens[index];
  if (token?.quoted) return token.value.length > 0 ? token.value : null;
  const value = token?.value;
  return value && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(value) ? value : null;
}

function qualifiedName(tokens: Token[], start: number) {
  const first = identifier(tokens, start);
  if (!first) return null;
  if (!keyword(tokens[start + 1], ".")) return { name: first, next: start + 1 };
  const second = identifier(tokens, start + 2);
  return second ? { name: second, next: start + 3 } : null;
}

function literalColumnList(tokens: Token[], open: number): string[] | null {
  if (!keyword(tokens[open], "(")) return null;
  const columns: string[] = [];
  let expectColumn = true;
  for (let index = open + 1; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (keyword(token, ")"))
      return !expectColumn && columns.length > 0 ? columns : null;
    if (keyword(token, ",")) {
      if (expectColumn) return null;
      expectColumn = true;
      continue;
    }
    if (!expectColumn) return null;
    const column = identifier(tokens, index);
    if (!column) return null;
    columns.push(column);
    expectColumn = false;
  }
  return null;
}

function statements(tokens: Token[]): Token[][] {
  const result: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (keyword(token, "(") || keyword(token, "[")) depth++;
    if (keyword(token, ")") || keyword(token, "]")) depth--;
    if (keyword(token, ";") && depth === 0) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(token);
  }
  if (current.length) result.push(current);
  return result;
}

function hasPair(tokens: Token[], first: string, second: string): boolean {
  return tokens.some(
    (token, index) =>
      keyword(token, first) && keyword(tokens[index + 1], second),
  );
}

function identifierList(tokens: Token[], start: number): string[] | null {
  if (!keyword(tokens[start], "(")) return null;
  const values: string[] = [];
  for (let index = start + 1; index < tokens.length; index++) {
    if (keyword(tokens[index], ")")) return values;
    if (keyword(tokens[index], ",")) continue;
    const value = identifier(tokens, index);
    if (!value) return null;
    values.push(value);
  }
  return null;
}

function referencedTables(tokens: Token[]) {
  return tokens.flatMap((token, index) => {
    if (!keyword(token, "references")) return [];
    const target = qualifiedName(tokens, index + 1);
    if (!target) return [];
    const foreignKey = tokens.findIndex(
      (item, keyIndex) =>
        keyIndex < index &&
        keyword(item, "foreign") &&
        keyword(tokens[keyIndex + 1], "key"),
    );
    const sourceColumns =
      foreignKey >= 0
        ? identifierList(tokens, foreignKey + 2)
        : (() => {
            const column = identifier(tokens, 0);
            return column ? [column] : null;
          })();
    return [
      {
        target: target.name,
        sourceFields: sourceColumns,
        targetFields: identifierList(tokens, target.next),
      },
    ];
  });
}

/** Reads a bounded PostgreSQL migration subset; unsupported SQL stays unknown. */
export function readSqlMigration(source: string): AdapterRead {
  const declarations: Declaration[] = [];
  const limitations: string[] = [];
  const markUnsupportedDdl = (statement: Token[]) =>
    limitations.push(
      `Migration SQL DDL fora do subconjunto suportado na linha ${statement[0]?.line ?? 1}; estado final permanece inconclusivo.`,
    );
  const add = (
    kind: Declaration["kind"],
    name: string,
    parent: string,
    line: number,
    relation?: Declaration["relation"],
  ) =>
    declarations.push({
      adapter: "sql-migration",
      kind,
      name,
      parent,
      line,
      ...(relation ? { relation } : {}),
    });
  for (const statement of statements(tokenize(source))) {
    let table: string | null = null;
    let bodyStart = -1;
    if (keyword(statement[0], "create")) {
      let index = 1;
      if (
        ["temporary", "temp", "unlogged"].includes(
          statement[index]?.quoted ? "" : (statement[index]?.value ?? ""),
        )
      )
        index++;
      if (!keyword(statement[index], "table")) {
        if (
          keyword(statement[index], "unique") &&
          keyword(statement[index + 1], "index")
        ) {
          const on = statement.findIndex((token) => keyword(token, "on"));
          const target = qualifiedName(statement, on + 1);
          if (target && hasPair(statement, "unique", "index")) {
            const open = statement.findIndex(
              (token, tokenIndex) =>
                tokenIndex >= target.next && keyword(token, "("),
            );
            const columns = literalColumnList(statement, open);
            add(
              "config_directive",
              "unique",
              target.name,
              statement[0]!.line,
              columns
                ? { field: null, sourceFields: columns, targetFields: null }
                : undefined,
            );
          } else markUnsupportedDdl(statement);
        }
        continue;
      }
      index++;
      if (keyword(statement[index], "if")) index += 3;
      const target = qualifiedName(statement, index);
      if (!target) {
        markUnsupportedDdl(statement);
        continue;
      }
      table = target.name;
      bodyStart = statement.findIndex(
        (token, tokenIndex) => keyword(token, "(") && tokenIndex >= target.next,
      );
      if (bodyStart < 0) {
        markUnsupportedDdl(statement);
        continue;
      }
      add("model", table, table, statement[0]!.line);
    } else if (
      keyword(statement[0], "alter") &&
      keyword(statement[1], "table")
    ) {
      let index = keyword(statement[2], "only") ? 3 : 2;
      const target = qualifiedName(statement, index);
      if (!target) {
        markUnsupportedDdl(statement);
        continue;
      }
      table = target.name;
      index = target.next;
      let understood = false;
      if (keyword(statement[index], "add")) {
        index++;
        if (keyword(statement[index], "constraint")) index += 2;
        const kind = statement[index]?.quoted ? "" : statement[index]?.value;
        if (kind === "primary" && keyword(statement[index + 1], "key")) {
          const open = statement.findIndex(
            (token, tokenIndex) =>
              tokenIndex > index + 1 && keyword(token, "("),
          );
          const columns = literalColumnList(statement, open);
          add(
            "config_directive",
            "primary_key",
            table,
            statement[0]!.line,
            columns
              ? { field: null, sourceFields: columns, targetFields: null }
              : undefined,
          );
          understood = true;
        } else if (kind === "unique") {
          const open = statement.findIndex(
            (token, tokenIndex) =>
              tokenIndex >= index + 1 && keyword(token, "("),
          );
          const columns = literalColumnList(statement, open);
          add(
            "config_directive",
            "unique",
            table,
            statement[0]!.line,
            columns
              ? { field: null, sourceFields: columns, targetFields: null }
              : undefined,
          );
          understood = true;
        } else if (kind === "foreign" && keyword(statement[index + 1], "key")) {
          const references = referencedTables(statement);
          for (const reference of references)
            add(
              "schema_relation",
              reference.target,
              table,
              statement[0]!.line,
              {
                field: null,
                sourceFields: reference.sourceFields,
                targetFields: reference.targetFields,
              },
            );
          understood = references.length > 0;
        }
      }
      if (!understood) markUnsupportedDdl(statement);
      continue;
    } else if (
      ["drop", "truncate", "rename"].includes(statement[0]?.value ?? "")
    ) {
      markUnsupportedDdl(statement);
      continue;
    } else continue;

    if (table === null || bodyStart < 0) continue;
    let depth = 0;
    let segment: Token[] = [];
    const definitions: Token[][] = [];
    for (let index = bodyStart; index < statement.length; index++) {
      const token = statement[index]!;
      if (keyword(token, "(") || keyword(token, "[")) depth++;
      if (keyword(token, ")") || keyword(token, "]")) {
        depth--;
        if (depth === 0) {
          if (segment.length) definitions.push(segment);
          break;
        }
      }
      if (keyword(token, ",") && depth === 1) {
        if (segment.length) definitions.push(segment);
        segment = [];
      } else segment.push(token);
    }
    for (const definition of definitions) {
      const line = definition[0]!.line;
      if (hasPair(definition, "primary", "key")) {
        const primaryIndex = definition.findIndex((token, tokenIndex) =>
          keyword(token, "primary"),
        );
        const open = definition.findIndex(
          (token, tokenIndex) =>
            tokenIndex > primaryIndex + 1 && keyword(token, "("),
        );
        const columns =
          open >= 0
            ? literalColumnList(definition, open)
            : identifier(definition, 0)
              ? [identifier(definition, 0)!]
              : null;
        add(
          "config_directive",
          "primary_key",
          table,
          line,
          columns
            ? { field: null, sourceFields: columns, targetFields: null }
            : undefined,
        );
      } else if (definition.some((token) => keyword(token, "unique"))) {
        const uniqueIndex = definition.findIndex((token) =>
          keyword(token, "unique"),
        );
        const open = definition.findIndex(
          (token, tokenIndex) =>
            tokenIndex > uniqueIndex && keyword(token, "("),
        );
        const columns =
          open >= 0
            ? literalColumnList(definition, open)
            : identifier(definition, 0)
              ? [identifier(definition, 0)!]
              : null;
        add(
          "config_directive",
          "unique",
          table,
          line,
          columns
            ? { field: null, sourceFields: columns, targetFields: null }
            : undefined,
        );
      }
      for (const reference of referencedTables(definition))
        add("schema_relation", reference.target, table, line, {
          field: null,
          sourceFields: reference.sourceFields,
          targetFields: reference.targetFields,
        });
    }
  }
  return {
    declarations,
    limitations: [
      ...limitations,
      "PostgreSQL migration: reconhece CREATE TABLE, PRIMARY KEY, UNIQUE, REFERENCES com colunas literais, CREATE UNIQUE INDEX e ALTER TABLE ADD destas formas estaticas; nao calcula estado final, nao interpreta SQL dinamico e nao comprova migrations aplicadas ao banco.",
    ],
  };
}
