import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { ProviderProcessSnapshot } from "../../src/process/ProviderProcess.js";
import { DockerCommand } from "../../src/pie/execution/dockerCommand.js";
import { DockerExecution } from "../../src/pie/execution/dockerExecution.js";
import { dockerFixture } from "./pieDockerFixture.js";

const output = (text: string): ProviderProcessSnapshot => ({
  stdout: {
    text,
    bytes: Buffer.byteLength(text),
    observedBytes: Buffer.byteLength(text),
  },
  stderr: { text: "", bytes: 0, observedBytes: 0 },
  exitCode: 0,
  signal: null,
});
const response = (value: unknown) => output(JSON.stringify(value));
const report =
  [
    {
      protocolVersion: 1,
      kind: "case",
      name: "fixture",
      file: "/source/test.mjs",
      line: 1,
      nesting: 0,
      category: "test",
      outcome: "passed",
    },
    {
      protocolVersion: 1,
      kind: "summary",
      counts: {
        cancelled: 0,
        failed: 0,
        passed: 1,
        skipped: 0,
        suites: 0,
        tests: 1,
        todo: 0,
        topLevel: 1,
      },
      durationMs: 1,
      success: true,
    },
  ]
    .map((value) => JSON.stringify(value))
    .join("\n") + "\n";

it("retém criação incerta ausente e recupera handshake tardio antes de remover", async () => {
  const { plan, imageId, container } = dockerFixture();
  const client = new DockerCommand(
    resolve("docker"),
    "unix:///var/run/docker.sock",
    resolve("config"),
  );
  const calls = vi
    .spyOn(client, "run")
    .mockResolvedValueOnce(
      response([{ Id: imageId, Os: "linux", Config: { Volumes: null } }]),
    )
    .mockRejectedValueOnce(new Error("fixture: lost create handshake"))
    .mockResolvedValueOnce(output(""));
  const owner = new DockerExecution(plan, client);
  const result = await owner.execute();
  expect(result).toMatchObject({
    cleanup: "incomplete",
    result: { state: "blocked" },
    cleanupOwner: owner,
  });
  calls
    .mockResolvedValueOnce(output(container.Id))
    .mockResolvedValueOnce(response([container]))
    .mockResolvedValueOnce(output(container.Id));
  await result.cleanupOwner!.close();
  expect(calls.mock.calls.at(-1)![0]).toEqual([
    "container",
    "rm",
    "--force",
    container.Id,
  ]);
  await owner.close();
});

it("preserva cancelamento durante cleanup final e permite retry de remoção", async () => {
  const { plan, imageId, container } = dockerFixture();
  const client = new DockerCommand(
    resolve("docker"),
    "unix:///var/run/docker.sock",
    resolve("config"),
  );
  const controller = new AbortController();
  const calls = vi
    .spyOn(client, "run")
    .mockResolvedValueOnce(
      response([{ Id: imageId, Os: "linux", Config: { Volumes: null } }]),
    )
    .mockResolvedValueOnce(output(container.Id))
    .mockResolvedValueOnce(response([container]))
    .mockResolvedValueOnce(output(report))
    .mockResolvedValueOnce(
      response([
        {
          Id: container.Id,
          State: {
            Status: "exited",
            Running: false,
            ExitCode: 0,
            OOMKilled: false,
            Error: "",
          },
        },
      ]),
    )
    .mockResolvedValueOnce(output(container.Id))
    .mockResolvedValueOnce(response([container]))
    .mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("fixture: removal unavailable");
    });
  const owner = new DockerExecution(plan, client);
  const result = await owner.execute(controller.signal);
  expect(result).toMatchObject({
    cleanup: "incomplete",
    result: { state: "inconclusive", counts: { passed: 1 } },
    cleanupOwner: owner,
  });
  calls
    .mockResolvedValueOnce(output(container.Id))
    .mockResolvedValueOnce(response([container]))
    .mockResolvedValueOnce(output(container.Id));
  await result.cleanupOwner!.close();
  expect(calls.mock.calls.at(-1)![0]).toEqual([
    "container",
    "rm",
    "--force",
    container.Id,
  ]);
});

it("não inicia configuração inválida e não remove identidade estrangeira", async () => {
  const { plan, imageId, container } = dockerFixture();
  const client = new DockerCommand(
    resolve("docker"),
    "unix:///var/run/docker.sock",
    resolve("config"),
  );
  const calls = vi
    .spyOn(client, "run")
    .mockResolvedValueOnce(
      response([{ Id: imageId, Os: "linux", Config: { Volumes: null } }]),
    )
    .mockResolvedValueOnce(output(container.Id))
    .mockResolvedValueOnce(
      response([
        {
          ...container,
          HostConfig: { ...container.HostConfig, Privileged: true },
        },
      ]),
    )
    .mockResolvedValueOnce(output(container.Id))
    .mockResolvedValueOnce(response([{ ...container, Name: "/foreign" }]));
  const owner = new DockerExecution(plan, client);
  expect(await owner.execute()).toMatchObject({
    cleanup: "incomplete",
    result: { state: "blocked" },
  });
  expect(
    calls.mock.calls.some(
      ([args]) => args.includes("start") || args.includes("rm"),
    ),
  ).toBe(false);
  expect(calls.mock.calls[3]![0]).toContain(`id=${container.Id}`);
  calls
    .mockResolvedValueOnce(output(container.Id))
    .mockResolvedValueOnce(response([container]))
    .mockResolvedValueOnce(output(container.Id));
  await owner.close();
});
