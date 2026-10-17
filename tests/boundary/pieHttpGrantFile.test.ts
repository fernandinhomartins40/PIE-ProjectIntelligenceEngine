import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readHttpProbeGrant } from "../../src/pie/execution/httpGrantFile.js";

const grant = {
  schemaVersion: 1,
  profile: "VERIFY",
  allowLocalHttpRequests: true,
  environment: "local",
  repositoryRoot: "C:/fixture/repository",
  snapshotId: "d6c7e539-e1a5-4fc7-a726-f68bb1b20bd5",
  treeDigest: "a".repeat(64),
  expiresAt: "2026-10-17T12:00:00.000Z",
  evidenceTtlMs: 1000,
  request: {
    address: "127.0.0.1",
    port: 3000,
    path: "/health",
    method: "GET",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
  },
  expectedStatus: 200,
  expectedBodySha256: null,
};

it("parses a bounded strict HTTP grant and rejects oversized or non-file inputs", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "pie-http-grant-file-"));
  const path = join(temporary, "grant.json");
  const directory = join(temporary, "directory");
  await mkdir(directory);
  try {
    await writeFile(path, JSON.stringify(grant));
    expect(await readHttpProbeGrant(path)).toMatchObject({
      snapshotId: grant.snapshotId,
      request: { address: "127.0.0.1", port: 3000 },
    });
    await writeFile(path, " ".repeat(1_000_001));
    await expect(readHttpProbeGrant(path)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(readHttpProbeGrant(directory)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
