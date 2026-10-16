import { dockerFixture as fixture } from "./pieDockerFixture.js";
import { expect, it } from "vitest";
import {
  buildDockerPlan,
  inspectDockerOwnership,
  validateDockerSandbox,
} from "../../src/pie/execution/dockerPlan.js";

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
