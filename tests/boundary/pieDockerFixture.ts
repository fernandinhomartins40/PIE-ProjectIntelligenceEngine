import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { buildDockerPlan } from "../../src/pie/execution/dockerPlan.js";
export function dockerFixture() {
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
