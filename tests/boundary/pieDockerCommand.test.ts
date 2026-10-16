import { resolve } from "node:path";
import { expect, it } from "vitest";
import { DockerCommand } from "../../src/pie/execution/dockerCommand.js";

it("admite somente cliente absoluto, diretório explícito e daemon local", async () => {
  for (const endpoint of [
    "tcp://127.0.0.1:2375",
    "ssh://host",
    "unix:///socket\nextra",
    "npipe://remote/pipe/docker_engine",
  ])
    expect(
      () => new DockerCommand(resolve("docker"), endpoint, resolve("config")),
    ).toThrow();
  expect(
    () =>
      new DockerCommand(
        "docker",
        "unix:///var/run/docker.sock",
        resolve("config"),
      ),
  ).toThrow();
  const client = new DockerCommand(
    resolve("docker"),
    "unix:///var/run/docker.sock",
    resolve("config"),
  );
  await client.close();
  await client.close();
});
