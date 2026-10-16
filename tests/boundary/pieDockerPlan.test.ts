import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  buildDockerPlan,
  inspectDockerOwnership,
  validateDockerSandbox,
} from "../../src/pie/execution/dockerPlan.js";

function fixture() {
  const grant = {
    schemaVersion: 1,
    profile: "VERIFY",
    allowTargetExecution: true,
    environment: "local",
    repositoryRoot: resolve("fixture"),
    snapshotId: randomUUID(),
    treeDigest: "1".repeat(64),
    image: `node@sha256:${"2".repeat(64)}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    testFiles: ["test/real.test.mjs"],
    limits: {
      timeoutMs: 5000,
      memoryMiB: 256,
      cpus: 1,
      pids: 32,
      workspaceMiB: 64,
      outputBytes: 65536,
      sourceBytes: 100000,
    },
  };
  const result = buildDockerPlan(
    grant,
    resolve("private-source"),
    resolve("private-reporter.mjs"),
    randomUUID(),
  );
  if (!result.ok) throw result.error;
  const plan = result.value;
  const imageId = `sha256:${"3".repeat(64)}`;
  const container = {
    Id: "4".repeat(64),
    Name: `/${plan.name}`,
    Image: imageId,
    State: { Status: "created", Running: false },
    Config: {
      Image: plan.image,
      User: "65534:65534",
      WorkingDir: "/source",
      Entrypoint: ["/usr/local/bin/node"],
      Cmd: [...plan.command],
      Env: [
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "NODE_VERSION=24.18.0",
        "NODE_OPTIONS=",
        "NODE_PATH=",
        "HOME=/tmp",
      ],
      Labels: { "io.pie.verify.run": plan.runId },
      Healthcheck: { Test: ["NONE"] },
    },
    HostConfig: {
      Privileged: false,
      ReadonlyRootfs: true,
      NetworkMode: "none",
      PidMode: "",
      IpcMode: "none",
      CgroupnsMode: "private",
      CapAdd: null,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Memory: 268435456,
      MemorySwap: 268435456,
      NanoCpus: 1e9,
      PidsLimit: 32,
      Devices: [],
      DeviceRequests: null,
      Binds: null,
      Mounts: [
        {
          Type: "bind",
          Source: plan.source,
          Target: "/source",
          ReadOnly: true,
          BindOptions: { NonRecursive: true },
        },
        {
          Type: "bind",
          Source: plan.reporter,
          Target: "/pie/reporter.mjs",
          ReadOnly: true,
          BindOptions: { NonRecursive: true },
        },
      ],
      VolumesFrom: null,
      Tmpfs: { ...plan.tmpfs },
      PortBindings: {},
      PublishAllPorts: false,
      RestartPolicy: { Name: "no" },
      LogConfig: { Type: "none" },
    },
    Mounts: [
      { Type: "bind", Source: plan.source, Destination: "/source", RW: false },
      {
        Type: "bind",
        Source: plan.reporter,
        Destination: "/pie/reporter.mjs",
        RW: false,
      },
    ],
  };
  return { grant, plan, imageId, container };
}
it("gera somente comando Node fixo, sem pull, shell, rede ou montagem do projeto original", () => {
  const { plan, grant } = fixture();
  expect(plan.arguments).toContain("--pull=never");
  expect(plan.arguments).toContain("--network=none");
  expect(plan.arguments).not.toContain(grant.repositoryRoot);
  expect(plan.command).toContain("/source/test/real.test.mjs");
  for (const path of ["../bad.mjs", "-e", "a/../bad.mjs", "a\\bad.mjs"])
    expect(
      buildDockerPlan(
        { ...grant, testFiles: [path] },
        plan.source,
        plan.reporter,
        plan.runId,
      ).ok,
    ).toBe(false);
  expect(
    buildDockerPlan(
      grant,
      `${plan.source},target=/etc`,
      plan.reporter,
      plan.runId,
    ).ok,
  ).toBe(false);
});
it("separa prova de ownership da validade do isolamento e recusa deriva de configuração", () => {
  const { plan, imageId, container } = fixture();
  expect(validateDockerSandbox([container], plan, imageId)).toEqual({
    ok: true,
    value: container.Id,
  });
  for (const host of [
    { Privileged: true },
    { ReadonlyRootfs: false },
    { NetworkMode: "host" },
    { PidMode: "host" },
    { IpcMode: "host" },
    { Memory: 0 },
    { MemorySwap: -1 },
    { NanoCpus: 0 },
    { PidsLimit: -1 },
    { CapAdd: ["SYS_ADMIN"] },
    { SecurityOpt: ["no-new-privileges:true", "seccomp=unconfined"] },
    { Devices: [{}] },
    { DeviceRequests: [{}] },
    { Binds: ["/var/run/docker.sock:/socket"] },
    {
      Mounts: container.HostConfig.Mounts.map((mount) => ({
        ...mount,
        BindOptions: { NonRecursive: false },
      })),
    },
    { VolumesFrom: ["other"] },
    { PublishAllPorts: true },
    { PortBindings: { "80/tcp": [] } },
    { Tmpfs: {} },
    { RestartPolicy: { Name: "always" } },
  ]) {
    const value = [
      { ...container, HostConfig: { ...container.HostConfig, ...host } },
    ];
    expect(inspectDockerOwnership(value, plan).ok).toBe(true);
    expect(validateDockerSandbox(value, plan, imageId).ok).toBe(false);
  }
  for (const change of [
    { Image: "foreign" },
    { State: { Status: "running", Running: true } },
    {
      Config: {
        ...container.Config,
        Env: [...container.Config.Env, "LD_PRELOAD=/source/evil.so"],
      },
    },
    { Config: { ...container.Config, Cmd: ["-e", "bad"] } },
    {
      Mounts: [
        ...container.Mounts,
        { Type: "volume", Source: "secret", Destination: "/extra", RW: true },
      ],
    },
    { Mounts: container.Mounts.map((mount) => ({ ...mount, RW: true })) },
  ])
    expect(
      validateDockerSandbox([{ ...container, ...change }], plan, imageId).ok,
    ).toBe(false);
  expect(
    inspectDockerOwnership([{ ...container, Name: "/foreign" }], plan).ok,
  ).toBe(false);
  expect(
    inspectDockerOwnership([{ ...container, Config: { Labels: {} } }], plan).ok,
  ).toBe(false);
  expect(validateDockerSandbox({}, plan, imageId).ok).toBe(false);
});
