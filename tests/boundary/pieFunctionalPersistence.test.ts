import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { openStore } from "../../src/pie/store.js";
import { PieService } from "../../src/pie/service.js";
import { validateFunctional } from "../../src/pie/functionalRecord.js";
import { sha256 } from "../../src/pie/evidence.js";
import canonicalize from "canonicalize";

it("registro funcional real é imutável, íntegro, limitado à página e reabre sem recalcular", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-functional-record-"));
  const repo = join(root, "repo");
  await mkdir(join(repo, "app", "api"), { recursive: true });
  await promisify(execFile)("git", ["init", repo]);
  await writeFile(
    join(repo, "app", "api", "route.ts"),
    "export function GET(){};export function POST(){}",
  );
  await promisify(execFile)("git", ["-C", repo, "add", "."]);
  const dbPath = join(root, "history.sqlite");
  const store = await openStore(dbPath, repo);
  const service = new PieService(store);
  try {
    const observed = await service.discover({
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    });
    const request = {
      snapshotId: observed.snapshot.id,
      modulePath: "app/api",
      limit: 1,
      offset: 1,
    };
    const review = await service.functional(request);
    const record = await service.retainFunctional(request);
    expect(record.result).toEqual(review);
    expect(record.result.findings).toMatchObject({
      total: 2,
      offset: 1,
      items: [expect.any(Object)],
    });
    expect(await service.functionalRecord(record.id)).toEqual(record);
    expect(store.saveFunctional(record)).toEqual(record);
    const second = await service.retainFunctional({ ...request, offset: 0 });
    const history = await service.functionalRecords(record.snapshotId, {
      limit: 1,
    });
    expect(history).toMatchObject({
      total: 2,
      offset: 0,
      nextOffset: 1,
      items: [{ id: record.id, count: 1, total: 2, state: "unverified" }],
    });
    expect(
      (
        await service.functionalRecords(record.snapshotId, {
          limit: 1,
          offset: 1,
        })
      ).items[0]!.id,
    ).toBe(second.id);
    expect(
      (await service.functionalRecords(record.snapshotId, { offset: 2 })).items,
    ).toEqual([]);
    await expect(
      service.functionalRecords(record.snapshotId, { limit: 0 }),
    ).rejects.toThrow();
    const changedPayload = {
      ...record,
      createdAt: new Date(Date.parse(record.createdAt) + 1).toISOString(),
    };
    const { sha256: previous, ...body } = changedPayload;
    void previous;
    expect(() =>
      store.saveFunctional({ ...body, sha256: sha256(canonicalize(body)!) }),
    ).toThrow("substituída");
    const alteredResult = {
      ...body,
      result: {
        ...body.result,
        findings: { ...body.result.findings, total: 999 },
      },
    };
    expect(() =>
      validateFunctional(
        { ...alteredResult, sha256: sha256(canonicalize(alteredResult)!) },
        store.snapshot(record.snapshotId),
      ),
    ).toThrow("Cobertura");
    expect(() =>
      validateFunctional(
        { ...record, sha256: "0".repeat(64) },
        store.snapshot(record.snapshotId),
      ),
    ).toThrow("integridade");
    const database = new DatabaseSync(dbPath);
    try {
      expect(() =>
        database
          .prepare(
            "UPDATE pie_functional_records SET created_at='other' WHERE id=?",
          )
          .run(record.id),
      ).toThrow("immutable");
      expect(() =>
        database
          .prepare("DELETE FROM pie_functional_records WHERE id=?")
          .run(record.id),
      ).toThrow("immutable");
    } finally {
      database.close();
    }
    await service.close();
    const reopened = await openStore(dbPath, repo);
    try {
      expect(reopened.functionalRecord(record.id)).toEqual(record);
    } finally {
      reopened.close();
    }
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
