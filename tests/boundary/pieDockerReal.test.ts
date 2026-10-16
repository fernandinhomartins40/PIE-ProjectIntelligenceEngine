import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  buildDockerPlan,
  inspectDockerOwnership,
  validateDockerSandbox,
} from "../../src/pie/execution/dockerPlan.js";
import { NODE_REPORTER_SOURCE } from "../../src/pie/execution/nodeReporter.js";
import { normalizeNodeResult } from "../../src/pie/execution/nodeResults.js";
import { DockerCommand } from "../../src/pie/execution/dockerCommand.js";
import { DockerExecution } from "../../src/pie/execution/dockerExecution.js";

const image = process.env.PIE_TEST_DOCKER_IMAGE;
const docker = (args: readonly string[]) =>
  promisify(execFile)("docker", [...args], {
    timeout: 20_000,
    maxBuffer: 1_000_000,
    windowsHide: true,
  });

it.skipIf(!image)(
  "Docker real confirma isolamento criado antes de executar fixture Node",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-docker-real-"));
    const source = join(root, "source");
    const reporter = join(root, "reporter.mjs");
    const runId = randomUUID();
    let ownedId: string | undefined;
    try {
      await mkdir(source);
      await chmod(source, 0o755);
      await writeFile(reporter, NODE_REPORTER_SOURCE, { mode: 0o444 });
      await writeFile(
        join(source, "test.mjs"),
        `import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
test('isolamento real', () => {
  assert.notEqual(process.getuid(), 0);
  assert.throws(() => writeFileSync('/source/modified', 'bad'));
  assert.throws(() => writeFileSync('/etc/pie-write', 'bad'));
  assert.deepEqual(Object.keys(networkInterfaces()).filter(name => name !== 'lo'), []);
  assert.equal(existsSync('/var/run/docker.sock'), false);
  writeFileSync('/tmp/allowed', 'ok');
});`,
        { mode: 0o444 },
      );
      const grant = {
        schemaVersion: 1,
        profile: "VERIFY",
        allowTargetExecution: true,
        environment: "local",
        repositoryRoot: root,
        snapshotId: randomUUID(),
        treeDigest: "1".repeat(64),
        image,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        testFiles: ["test.mjs"],
        limits: {
          timeoutMs: 10000,
          memoryMiB: 256,
          cpus: 1,
          pids: 32,
          workspaceMiB: 64,
          outputBytes: 65536,
          sourceBytes: 100000,
        },
      };
      const result = buildDockerPlan(grant, source, reporter, runId);
      if (!result.ok) throw result.error;
      const plan = result.value;
      const imageInspect = JSON.parse(
        (await docker(["image", "inspect", image!])).stdout,
      ) as Array<{ Id: string }>;
      await docker(plan.arguments);
      const inspect = JSON.parse(
        (await docker(["container", "inspect", plan.name])).stdout,
      ) as unknown;
      const ownership = inspectDockerOwnership(inspect, plan);
      if (!ownership.ok) throw ownership.error;
      ownedId = ownership.value;
      const admitted = validateDockerSandbox(
        inspect,
        plan,
        imageInspect[0]!.Id,
      );
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) throw admitted.error;
      const output = await docker(["container", "start", "--attach", ownedId]);
      const final = JSON.parse(
        (await docker(["container", "inspect", ownedId])).stdout,
      ) as Array<{ State: { ExitCode: number; Running: boolean } }>;
      expect(final[0]!.State.Running).toBe(false);
      expect(
        normalizeNodeResult(
          Buffer.from(output.stdout),
          {
            started: true,
            completed: true,
            exitCode: final[0]!.State.ExitCode,
            signal: null,
            truncated: false,
          },
          { bytes: 65536, records: 1000 },
        ).state,
      ).toBe("passed");
    } finally {
      // This test only cleans an exact ID after label/name ownership was observed.
      if (ownedId) await docker(["container", "rm", "--force", ownedId]);
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);

it.skipIf(!image || process.platform !== "linux")(
  "supervisor real preserva falha e cancela contêiner sem deixar recurso",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-docker-owned-"));
    const source = join(root, "source");
    const config = join(root, "docker-config");
    const reporter = join(root, "reporter.mjs");
    const executable = (
      await promisify(execFile)("which", ["docker"])
    ).stdout.trim();
    try {
      await mkdir(source);
      await chmod(source, 0o755);
      await mkdir(config);
      await writeFile(reporter, NODE_REPORTER_SOURCE, { mode: 0o444 });
      for (const [body, expected] of [
        ["test('works', () => {});", "passed"],
        [
          "test('fails', () => { throw new Error('fixture failure'); });",
          "failed",
        ],
        [
          "test('waits', async () => { await new Promise(resolve => setTimeout(resolve, 30000)); });",
          "inconclusive",
        ],
      ] as const) {
        await rm(join(source, "test.mjs"), { force: true });
        await writeFile(
          join(source, "test.mjs"),
          `import {test} from 'node:test'; ${body}`,
          { mode: 0o444 },
        );
        const runId = randomUUID();
        const plan = buildDockerPlan(
          {
            schemaVersion: 1,
            profile: "VERIFY",
            allowTargetExecution: true,
            environment: "local",
            repositoryRoot: root,
            snapshotId: randomUUID(),
            treeDigest: "1".repeat(64),
            image,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            testFiles: ["test.mjs"],
            limits: {
              timeoutMs: 15000,
              memoryMiB: 256,
              cpus: 1,
              pids: 32,
              workspaceMiB: 64,
              outputBytes: 65536,
              sourceBytes: 100000,
            },
          },
          source,
          reporter,
          runId,
        );
        if (!plan.ok) throw plan.error;
        const owner = new DockerExecution(
          plan.value,
          new DockerCommand(executable, "unix:///var/run/docker.sock", config),
        );
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        if (expected === "inconclusive")
          timer = setTimeout(() => controller.abort(), 5000);
        let result: Awaited<ReturnType<DockerExecution["execute"]>>;
        try {
          result = await owner.execute(controller.signal);
        } finally {
          if (timer) clearTimeout(timer);
          await owner.close();
        }
        expect(result.cleanup).toBe("complete");
        expect(result.result.state).toBe(expected);
        const remaining = await docker([
          "container",
          "ls",
          "--all",
          "--filter",
          `label=io.pie.verify.run=${runId}`,
          "--format",
          "{{.ID}}",
        ]);
        expect(remaining.stdout.trim()).toBe("");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
