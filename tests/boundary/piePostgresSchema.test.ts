import { Prisma } from "@prisma/client";
import { expect, it } from "vitest";
import { comparePostgresColumns } from "../../src/pie/postgresSchema.js";

it("deriva as colunas esperadas do DMMF Prisma e compara apenas tabelas PIE existentes", () => {
  const expected = Prisma.dmmf.datamodel.models.flatMap((model) =>
    model.fields
      .filter((field) => field.kind !== "object")
      .map((field) => ({
        table: model.dbName ?? model.name,
        column: field.dbName ?? field.name,
      })),
  );
  const tables = new Set(expected.map(({ table }) => table));
  expect(comparePostgresColumns(expected, expected, tables)).toEqual({
    missingColumns: [],
    unexpectedColumns: [],
  });
});

it("localiza colunas faltantes e extras sem atribuir tabelas de terceiros ao PIE", () => {
  expect(
    comparePostgresColumns(
      [
        { table: "pie_projects", column: "id" },
        { table: "pie_projects", column: "created_at" },
      ],
      [
        { table: "pie_projects", column: "id" },
        { table: "pie_projects", column: "legacy_flag" },
        { table: "unrelated", column: "other" },
      ],
      new Set(["pie_projects", "unrelated"]),
    ),
  ).toEqual({
    missingColumns: ["pie_projects.created_at"],
    unexpectedColumns: ["pie_projects.legacy_flag"],
  });
});

it("não duplica missing columns quando a tabela inteira está ausente", () => {
  expect(
    comparePostgresColumns(
      [{ table: "pie_projects", column: "id" }],
      [],
      new Set(),
    ),
  ).toEqual({ missingColumns: [], unexpectedColumns: [] });
});
