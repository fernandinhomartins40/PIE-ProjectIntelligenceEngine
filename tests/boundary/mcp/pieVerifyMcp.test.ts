import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { PieService } from "../../../src/pie/service.js";
import { openStore } from "../../../src/pie/store.js";
import { verificationRunSchema } from "../../../src/pie/execution/runContracts.js";
import { verifyRunEvidence } from "../../../src/pie/execution/runEvidence.js";

it.skipIf(process.platform !== "linux")(
  "MCP stdio habilitado exige grant e persiste execução real",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pie-verify-mcp-"));
    const repo = join(root, "repo");
    const state = join(root, "state");
    const db = join(root, "history.sqlite");
    const exec = promisify(execFile);
    await mkdir(repo);
    await mkdir(state, { mode: 0o700 });
    await exec("git", ["init", repo]);
    await writeFile(
      join(repo, "test.mjs"),
      "import {test} from 'node:test';test('fixture',async()=>{await new Promise(resolve=>setTimeout(resolve,2000));});",
    );
    await exec("git", ["-C", repo, "add", "."]);
    const store = await openStore(db, repo);
    const service = new PieService(store);
    const observed = await service.discover({
      profile: "OBSERVE",
      environment: "local",
      repositoryRoot: repo,
    });
    const snapshot = store.snapshot(observed.snapshot.id);
    const executable = process.env.PIE_TEST_DOCKER_IMAGE
      ? (await exec("which", ["docker"])).stdout.trim()
      : join(root, "missing-docker");
    const client = new Client({
      name: "pie-verify-contract",
      version: "1.0.0",
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve("scripts/pie.mjs"),
        "mcp",
        repo,
        "--db",
        db,
        "--state-dir",
        state,
        "--docker-bin",
        executable,
        "--docker-host",
        "unix:///var/run/docker.sock",
      ],
    });
    const grant = {
      schemaVersion: 1,
      profile: "VERIFY",
      allowTargetExecution: true,
      environment: "local",
      repositoryRoot: repo,
      snapshotId: snapshot.id,
      treeDigest: snapshot.treeDigest,
      image:
        process.env.PIE_TEST_DOCKER_IMAGE ?? `node@sha256:${"1".repeat(64)}`,
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
    };
    try {
      await client.connect(transport);
      const tool = (await client.listTools()).tools.find(
        (item) => item.name === "pie_test_run",
      )!;
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: false,
      });
      const ajv = new Ajv2020({ strict: false });
      const input = ajv.compile(tool.inputSchema as AnySchema);
      const output = ajv.compile(tool.outputSchema as AnySchema);
      expect(input(grant), JSON.stringify(input.errors)).toBe(true);
      const denied = await client.callTool({
        name: "pie_test_run",
        arguments: { ...grant, repositoryRoot: root },
      });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({
        error: { code: "POLICY_DENIED" },
      });
      expect(
        output(denied.structuredContent),
        JSON.stringify(output.errors),
      ).toBe(true);
      expect(store.verifications(snapshot.id).total).toBe(0);
      const responses = await Promise.all(
        (process.env.PIE_TEST_DOCKER_IMAGE ? [1, 2] : [1]).map(() =>
          client.callTool({ name: "pie_test_run", arguments: grant }),
        ),
      );
      expect(responses.filter((item) => item.isError)).toHaveLength(
        process.env.PIE_TEST_DOCKER_IMAGE ? 1 : 0,
      );
      if (responses.some((item) => item.isError))
        expect(
          responses.find((item) => item.isError)!.structuredContent,
        ).toMatchObject({ error: { code: "BUSY" } });
      const response = responses.find((item) => !item.isError)!;
      expect(
        output(response.structuredContent),
        JSON.stringify(output.errors),
      ).toBe(true);
      const run = verifyRunEvidence(
        verificationRunSchema.parse(response.structuredContent),
      );
      expect(run).toMatchObject({
        schemaVersion: 2,
        authorization: grant,
        result: {
          state: process.env.PIE_TEST_DOCKER_IMAGE ? "passed" : "blocked",
        },
      });
      expect(store.verification(run.id)).toEqual(run);
      const read = await client.callTool({
        name: "pie_verification_get",
        arguments: { id: run.id },
      });
      expect(read.structuredContent).toEqual(run);
    } finally {
      await client.close();
      await transport.close();
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
