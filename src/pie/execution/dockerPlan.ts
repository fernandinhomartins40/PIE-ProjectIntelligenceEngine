import { isAbsolute } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../../domain/result.js";
import {
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { nodeTestGrantSchema, type NodeTestGrant } from "./contracts.js";

const LABEL = "io.pie.verify.run";
export interface DockerPlan {
  readonly name: string;
  readonly runId: string;
  readonly image: string;
  readonly source: string;
  readonly reporter: string;
  readonly grant: NodeTestGrant;
  readonly arguments: readonly string[];
  readonly command: readonly string[];
  readonly tmpfs: Readonly<Record<string, string>>;
}

/** Fixed Node invocation; repository content never supplies Docker options or a shell command. */
export function buildDockerPlan(
  input: unknown,
  source: string,
  reporter: string,
  runId: string,
): Result<DockerPlan, AnalysisInputError> {
  const parsed = nodeTestGrantSchema.safeParse(input);
  const invalid = () =>
    err(
      new AnalysisInputError("pie.docker-plan", {
        userMessage: "Parâmetros do contêiner inválidos.",
      }),
    );
  if (!parsed.success || !z.string().uuid().safeParse(runId).success)
    return invalid();
  if (
    [source, reporter].some(
      (path) => !isAbsolute(path) || /[\0\r\n,]/.test(path),
    )
  )
    return invalid();
  const grant = parsed.data;
  if (
    grant.testFiles.some(
      (path) =>
        path.startsWith("-") ||
        path.startsWith("/") ||
        path.includes("\\") ||
        path
          .split("/")
          .some((part) => part === ".." || part === "." || part === ""),
    )
  )
    return invalid();
  const name = `pie-verify-${runId}`;
  const tmpfs = {
    "/tmp": `rw,noexec,nosuid,nodev,size=${grant.limits.workspaceMiB * 1024 * 1024},mode=1777`,
  };
  const command = [
    "--test",
    "--test-concurrency=1",
    "--test-reporter=/pie/reporter.mjs",
    ...(grant.schemaVersion >= 2 && grant.testFiles.length === 1
      ? ["--experimental-test-coverage"]
      : []),
    ...grant.testFiles.map((path) => `/source/${path}`),
  ];
  const args = [
    "container",
    "create",
    "--pull=never",
    "--name",
    name,
    "--label",
    `${LABEL}=${runId}`,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--user=65534:65534",
    `--memory=${grant.limits.memoryMiB}m`,
    `--memory-swap=${grant.limits.memoryMiB}m`,
    `--cpus=${grant.limits.cpus}`,
    `--pids-limit=${grant.limits.pids}`,
    "--ipc=none",
    "--cgroupns=private",
    "--log-driver=none",
    "--no-healthcheck",
    "--restart=no",
    "--workdir=/source",
    "--entrypoint=/usr/local/bin/node",
    "--env=NODE_OPTIONS=",
    "--env=NODE_PATH=",
    "--env=HOME=/tmp",
    "--mount",
    `type=bind,source=${source},target=/source,readonly,bind-recursive=disabled`,
    "--mount",
    `type=bind,source=${reporter},target=/pie/reporter.mjs,readonly,bind-recursive=disabled`,
    "--tmpfs",
    `/tmp:${tmpfs["/tmp"]}`,
    grant.image,
    ...command,
  ];
  return ok({
    name,
    runId,
    image: grant.image,
    source,
    reporter,
    grant,
    arguments: args,
    command,
    tmpfs,
  });
}

const mountSchema = z.object({
  Type: z.string(),
  Source: z.string(),
  Destination: z.string(),
  RW: z.boolean(),
});
const inspectSchema = z
  .array(
    z.object({
      Id: z.string().regex(/^[a-f0-9]{64}$/),
      Name: z.string(),
      Image: z.string(),
      State: z.object({ Status: z.string(), Running: z.boolean() }),
      Config: z.object({
        Image: z.string(),
        User: z.string(),
        WorkingDir: z.string(),
        Env: z.array(z.string()),
        Entrypoint: z.array(z.string()),
        Cmd: z.array(z.string()),
        Labels: z.record(z.string(), z.string()),
        Healthcheck: z.object({ Test: z.array(z.string()) }).optional(),
      }),
      HostConfig: z.object({
        Privileged: z.boolean(),
        ReadonlyRootfs: z.boolean(),
        NetworkMode: z.string(),
        PidMode: z.string(),
        IpcMode: z.string(),
        CgroupnsMode: z.string(),
        CapAdd: z.array(z.string()).nullable(),
        CapDrop: z.array(z.string()),
        SecurityOpt: z.array(z.string()),
        Memory: z.number(),
        MemorySwap: z.number(),
        NanoCpus: z.number(),
        PidsLimit: z.number(),
        Devices: z.array(z.unknown()).nullable(),
        DeviceRequests: z.array(z.unknown()).nullable(),
        Binds: z.array(z.string()).nullable(),
        Mounts: z.array(
          z.object({
            Type: z.literal("bind"),
            Source: z.string(),
            Target: z.string(),
            ReadOnly: z.literal(true),
            BindOptions: z.object({ NonRecursive: z.literal(true) }),
          }),
        ),
        VolumesFrom: z.array(z.string()).nullable(),
        Tmpfs: z.record(z.string(), z.string()),
        PortBindings: z.record(z.string(), z.unknown()).nullable(),
        PublishAllPorts: z.boolean(),
        RestartPolicy: z.object({ Name: z.string() }),
        LogConfig: z.object({ Type: z.string() }),
      }),
      Mounts: z.array(mountSchema),
    }),
  )
  .length(1);

/** Ownership proof is independent of sandbox validity; safe cleanup may use identity even on rejection. */
export function inspectDockerOwnership(
  input: unknown,
  plan: Pick<DockerPlan, "name" | "runId">,
): Result<string, AnalysisOutputError> {
  const identity = z
    .array(
      z.object({
        Id: z.string().regex(/^[a-f0-9]{64}$/),
        Name: z.string(),
        Config: z.object({ Labels: z.record(z.string(), z.string()) }),
      }),
    )
    .length(1)
    .safeParse(input);
  if (
    !identity.success ||
    identity.data[0]!.Name !== `/${plan.name}` ||
    identity.data[0]!.Config.Labels[LABEL] !== plan.runId
  )
    return err(
      new AnalysisOutputError(
        "pie.docker-ownership",
        "Identidade do contêiner não comprovada.",
      ),
    );
  return ok(identity.data[0]!.Id);
}

function validMounts(
  mounts: z.infer<typeof mountSchema>[],
  plan: DockerPlan,
): boolean {
  const binds = mounts.filter((mount) => mount.Type === "bind");
  return (
    binds.length === 2 &&
    mounts.every(
      (mount) =>
        mount.Type === "bind" ||
        (mount.Type === "tmpfs" && mount.Destination === "/tmp"),
    ) &&
    binds.some(
      (mount) =>
        mount.Source === plan.source &&
        mount.Destination === "/source" &&
        !mount.RW,
    ) &&
    binds.some(
      (mount) =>
        mount.Source === plan.reporter &&
        mount.Destination === "/pie/reporter.mjs" &&
        !mount.RW,
    )
  );
}
type HostConfiguration = z.infer<typeof inspectSchema>[number]["HostConfig"];
function noExtraResources(host: HostConfiguration): boolean {
  return (
    !host.Devices?.length &&
    !host.DeviceRequests?.length &&
    !host.Binds?.length &&
    !host.VolumesFrom?.length &&
    !host.PublishAllPorts &&
    !Object.keys(host.PortBindings ?? {}).length
  );
}
function validIsolation(host: HostConfiguration): boolean {
  return (
    !host.Privileged &&
    host.ReadonlyRootfs &&
    host.NetworkMode === "none" &&
    host.PidMode === "" &&
    host.IpcMode === "none" &&
    host.CgroupnsMode === "private" &&
    !host.CapAdd?.length &&
    host.CapDrop.length === 1 &&
    host.CapDrop[0] === "ALL" &&
    host.SecurityOpt.length === 1 &&
    host.SecurityOpt[0] === "no-new-privileges:true" &&
    noExtraResources(host)
  );
}
function validHost(
  host: z.infer<typeof inspectSchema>[number]["HostConfig"],
  plan: DockerPlan,
): boolean {
  const limits = plan.grant.limits;
  return (
    validIsolation(host) &&
    host.Memory === limits.memoryMiB * 1024 * 1024 &&
    host.MemorySwap === host.Memory &&
    host.NanoCpus === Math.round(limits.cpus * 1e9) &&
    host.PidsLimit === limits.pids &&
    host.Mounts.length === 2 &&
    host.Mounts.some(
      (mount) => mount.Source === plan.source && mount.Target === "/source",
    ) &&
    host.Mounts.some(
      (mount) =>
        mount.Source === plan.reporter && mount.Target === "/pie/reporter.mjs",
    ) &&
    host.RestartPolicy.Name === "no" &&
    host.LogConfig.Type === "none" &&
    JSON.stringify(host.Tmpfs) === JSON.stringify(plan.tmpfs)
  );
}
function validEnvironment(values: string[]): boolean {
  const entries = values.map(
    (value) =>
      [
        value.slice(0, value.indexOf("=")),
        value.slice(value.indexOf("=") + 1),
      ] as const,
  );
  if (new Set(entries.map(([name]) => name)).size !== entries.length)
    return false;
  const allowed = new Set([
    "PATH",
    "NODE_VERSION",
    "YARN_VERSION",
    "NODE_OPTIONS",
    "NODE_PATH",
    "HOME",
  ]);
  const env = new Map(entries);
  return (
    entries.every(([name]) => allowed.has(name)) &&
    env.get("NODE_OPTIONS") === "" &&
    env.get("NODE_PATH") === "" &&
    env.get("HOME") === "/tmp"
  );
}
export function validateDockerSandbox(
  input: unknown,
  plan: DockerPlan,
  imageId: string,
): Result<string, AnalysisOutputError> {
  const ownership = inspectDockerOwnership(input, plan);
  if (!ownership.ok) return ownership;
  const parsed = inspectSchema.safeParse(input);
  const reject = () =>
    err(
      new AnalysisOutputError(
        "pie.docker-sandbox",
        "Configuração real do contêiner diverge do isolamento autorizado.",
      ),
    );
  if (!parsed.success) return reject();
  const value = parsed.data[0]!;
  const config = value.Config;
  if (
    value.Image !== imageId ||
    config.Image !== plan.image ||
    value.State.Status !== "created" ||
    value.State.Running ||
    config.User !== "65534:65534" ||
    config.WorkingDir !== "/source" ||
    JSON.stringify(config.Entrypoint) !==
      JSON.stringify(["/usr/local/bin/node"]) ||
    JSON.stringify(config.Cmd) !== JSON.stringify(plan.command) ||
    config.Healthcheck?.Test[0] !== "NONE" ||
    !validEnvironment(config.Env) ||
    !validHost(value.HostConfig, plan) ||
    !validMounts(value.Mounts, plan)
  )
    return reject();
  return ownership;
}
