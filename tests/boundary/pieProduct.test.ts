import { expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverProject } from "../../src/pie/discovery.js";
import {
  assessProduct,
  assessProductResult,
} from "../../src/pie/functional.js";
import { PieError } from "../../src/pie/contracts.js";
const exec = promisify(execFile);

it("reports product evidence gaps without inventing journeys or UX opportunities", async () => {
  const root = await mkdtemp(join(tmpdir(), "pie-product-"));
  try {
    await exec("git", ["init", root]);
    await writeFile(join(root, "README.md"), "Inert product fixture.\n");
    await exec("git", ["-C", root, "add", "."]);
    const snapshot = await discoverProject(
      {
        repositoryRoot: root,
        profile: "OBSERVE",
        environment: "local",
      },
      randomUUID(),
    );
    const result = assessProduct(snapshot, {
      snapshotId: snapshot.id,
      limit: 1,
    });
    expect(assessProductResult(snapshot, { snapshotId: "invalid" })).toEqual({
      ok: false,
      error: { kind: "invalid_input", reason: "schema" },
    });
    expect(assessProductResult({}, { snapshotId: snapshot.id })).toEqual({
      ok: false,
      error: { kind: "invalid_snapshot" },
    });
    expect(assessProductResult(snapshot, { snapshotId: randomUUID() })).toEqual(
      {
        ok: false,
        error: { kind: "policy_denied", reason: "snapshot_mismatch" },
      },
    );
    expect(result).toMatchObject({
      engine: "product",
      state: "insufficient_evidence",
      scope: { declaredTargets: 0, examinedTargets: 0 },
      opportunities: { total: 0, nextOffset: null, items: [] },
      coverage: { observedJourneys: false, runtime: false },
    });
    try {
      assessProduct(snapshot, { snapshotId: randomUUID() });
      expect.fail("snapshot divergence must be rejected");
    } catch (cause) {
      expect(cause).toBeInstanceOf(PieError);
      expect((cause as PieError).code).toBe("POLICY_DENIED");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
