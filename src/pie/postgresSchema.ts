import { compositeKey } from "../domain/unicodeCodePointOrder.js";

export type PostgresColumn = { table: string; column: string };

export function comparePostgresColumns(
  expected: readonly PostgresColumn[],
  actual: readonly PostgresColumn[],
  existingTables: ReadonlySet<string>,
) {
  const key = ({ table, column }: PostgresColumn) =>
    compositeKey([table, column]);
  const ownedTables = new Set(expected.map(({ table }) => table));
  const expectedKeys = new Set(
    expected
      .filter(
        ({ table }) => ownedTables.has(table) && existingTables.has(table),
      )
      .map(key),
  );
  const actualKeys = new Set(
    actual
      .filter(
        ({ table }) => ownedTables.has(table) && existingTables.has(table),
      )
      .map(key),
  );
  const label = ({ table, column }: PostgresColumn) => `${table}.${column}`;
  return {
    missingColumns: expected
      .filter(
        (item) =>
          ownedTables.has(item.table) &&
          existingTables.has(item.table) &&
          !actualKeys.has(key(item)),
      )
      .map(label)
      .sort(),
    unexpectedColumns: actual
      .filter(
        (item) =>
          ownedTables.has(item.table) &&
          existingTables.has(item.table) &&
          !expectedKeys.has(key(item)),
      )
      .map(label)
      .sort(),
  };
}
