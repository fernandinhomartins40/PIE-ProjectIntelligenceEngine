import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { validateRetestAuthorization } from "../../src/pie/execution/coordinator.js";
import { nodeTestGrantSchema } from "../../src/pie/execution/contracts.js";
import { openStore } from "../../src/pie/store.js";
import { PieService } from "../../src/pie/service.js";

const exec = promisify(execFile);

it("revalida plano, digest e seleção de arquivos antes de admitir VERIFY", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-retest-admission-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  await exec("git", ["init", repo]);
  await writeFile(join(repo, "service.ts"), "export const value=1;\n");
  await writeFile(
    join(repo, "linked.test.ts"),
    "import {value} from './service'; export {value};\n",
  );
  await writeFile(
    join(repo, "other.test.ts"),
    "export const unrelated = true;\n",
  );
  await exec("git", ["-C", repo, "add", "."]);
  const store = await openStore(join(root, "history.sqlite"), repo);
  const service = new PieService(store);
  try {
    const policy = {
      repositoryRoot: repo,
      profile: "OBSERVE",
      environment: "local",
    };
    const before = await service.discover(policy);
    await writeFile(join(repo, "service.ts"), "export const value=2;\n");
    const after = await service.discover(policy);
    const beforeSnapshot = store.snapshot(before.snapshot.id);
    const afterSnapshot = store.snapshot(after.snapshot.id);
    const plan = await service.retestPlan({
      beforeId: before.snapshot.id,
      afterId: after.snapshot.id,
      mode: "affected",
    });
    expect(plan).toMatchObject({
      schemaVersion: 2,
      planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      candidates: { items: [{ path: "linked.test.ts" }] },
    });
    const authorization = nodeTestGrantSchema.parse({
      schemaVersion: 1,
      profile: "VERIFY",
      allowTargetExecution: true,
      environment: "local",
      repositoryRoot: repo,
      snapshotId: after.snapshot.id,
      treeDigest: after.snapshot.treeDigest,
      image: `node@sha256:${"a".repeat(64)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      testFiles: ["linked.test.ts"],
      retestPlan: {
        beforeSnapshotId: before.snapshot.id,
        mode: "affected" as const,
        planDigest: plan.planDigest,
      },
      limits: {
        timeoutMs: 15_000,
        memoryMiB: 256,
        cpus: 1,
        pids: 32,
        workspaceMiB: 64,
        outputBytes: 65_536,
        sourceBytes: 100_000,
      },
    });
    expect(() =>
      validateRetestAuthorization(authorization, beforeSnapshot, afterSnapshot),
    ).not.toThrow();
    expect(() =>
      validateRetestAuthorization(
        { ...authorization, testFiles: ["other.test.ts"] },
        beforeSnapshot,
        afterSnapshot,
      ),
    ).toThrow("não pertence à seleção recalculada");
    expect(() =>
      validateRetestAuthorization(
        {
          ...authorization,
          retestPlan: {
            beforeSnapshotId: before.snapshot.id,
            mode: "affected",
            planDigest: "0".repeat(64),
          },
        },
        beforeSnapshot,
        afterSnapshot,
      ),
    ).toThrow("Plano mudou");
    expect(() =>
      validateRetestAuthorization(
        {
          ...authorization,
          retestPlan: {
            beforeSnapshotId: randomUUID(),
            mode: "affected",
            planDigest: plan.planDigest,
          },
        },
        beforeSnapshot,
        afterSnapshot,
      ),
    ).toThrow("fora do escopo");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
