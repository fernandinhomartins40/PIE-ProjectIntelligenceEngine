import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { ProviderProcessSupervisor } from "./ProviderProcess.js";
import { redactCapturedTransportCredential } from "./ProviderDiagnosticRedaction.js";

it("retains final stderr until owned output pipes close", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  let cleanupStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    cleanupStarted = resolve;
  });
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => {
      producer.emit("exit", 2, null);
      cleanupStarted();
      return { cleaned: true, signaled: false };
    },
  });
  const stopped = owner.stop();
  expect(owner.stop()).toBe(stopped);
  await started;
  await new Promise<void>((resolve) => setImmediate(resolve));
  producer.stderr.end("final launcher diagnostic");
  producer.stdout.end();
  producer.emit("close", 2, null);
  await expect(stopped).resolves.toEqual({ status: "verified-cleanup" });
  expect(owner.snapshot()).toMatchObject({
    stderr: { text: "final launcher diagnostic" },
    exitCode: 2,
  });
  expect(owner.observedOutputClose()).toBe(true);
});

it("bounds late output retention and marks an undrained tail incomplete", async () => {
  vi.useFakeTimers();
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: Object.assign(new PassThrough(), { unref: vi.fn() }),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => {
      producer.emit("exit", 0, null);
      return { cleaned: true, signaled: false };
    },
  });
  const checkpoint = owner.checkpointOutput();
  try {
    const stopped = owner.stop();
    await vi.advanceTimersByTimeAsync(0);
    producer.stderr.write("x".repeat(65537));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(stopped).resolves.toEqual({ status: "verified-cleanup" });
    expect(owner.snapshot()).toMatchObject({
      stderr: { bytes: 65536, observedBytes: 65537 },
      outputIncomplete: true,
      diagnosticTruncated: true,
    });
    expect(owner.snapshotOutputSince(checkpoint).complete).toBe(false);
    expect(producer.stderr.destroyed).toBe(false);
    expect(producer.stderr.unref).toHaveBeenCalledOnce();
  } finally {
    owner.dispose();
    producer.stdout.destroy();
    producer.stderr.destroy();
    vi.useRealTimers();
  }
});

it("keeps capture ownership through a failed cleanup and retry", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => false),
  });
  let fails = true;
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => {
      if (fails) return { cleaned: false, reason: "identity unavailable" };
      producer.emit("exit", 0, null);
      return { cleaned: true, signaled: false };
    },
  });
  await expect(owner.stop()).resolves.toMatchObject({ status: "incomplete" });
  producer.stderr.write("retained during retry");
  fails = false;
  const retried = owner.stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  producer.stderr.end(" and final tail");
  producer.stdout.end();
  producer.emit("close", 0, null);
  await expect(retried).resolves.toEqual({ status: "verified-cleanup" });
  expect(owner.snapshot().stderr.text).toBe(
    "retained during retry and final tail",
  );
  expect(owner.snapshot().outputIncomplete).toBeUndefined();
});

it("waits without a deadline until output closes or the caller aborts", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  const controller = new AbortController();
  let settled = false;
  const pending = owner
    .waitForOutputClose(undefined, controller.signal)
    .then((result) => {
      settled = true;
      return result;
    });
  try {
    await Promise.resolve();
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).resolves.toBe(false);
  } finally {
    owner.dispose();
    producer.stdout.destroy();
    producer.stderr.destroy();
  }
});

it("keeps a stream read error visible after the process closes", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const owner = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    producer.stderr.emit("error", new Error("read failure"));
    producer.stdout.end();
    producer.stderr.end();
    producer.emit("close", 1, null);
    expect(await owner.waitForOutputClose(0)).toBe(true);
    expect(owner.snapshot()).toMatchObject({
      outputIncomplete: true,
      diagnosticTruncated: true,
    });
  } finally {
    owner.dispose();
    producer.stdout.destroy();
    producer.stderr.destroy();
  }
});

it("exit does not establish complete output when a producer closes its streams later", async () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    producer.stdout.write("first");
    producer.emit("exit", 0, null);
    expect(await supervisor.waitForExit(0)).toBe(true);
    expect(await supervisor.waitForOutputClose(0)).toBe(false);
    producer.stdout.end("last");
    producer.stderr.end("diagnostic");
    producer.emit("close", 0, null);
    expect(await supervisor.waitForOutputClose(0)).toBe(true);
    expect(supervisor.snapshot()).toMatchObject({
      stdout: { text: "firstlast" },
      stderr: { text: "diagnostic" },
      exitCode: 0,
    });
  } finally {
    supervisor.dispose();
  }
});

it("reads an observed exit without materializing stream diagnostics", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    producer.stdout.write("retained-diagnostic");
    const snapshot = vi.spyOn(supervisor, "snapshot");
    expect(supervisor.observedExit()).toBeUndefined();
    producer.emit("exit", null, "SIGKILL");
    expect(supervisor.observedExit()).toEqual({
      code: null,
      signal: "SIGKILL",
    });
    expect(snapshot).not.toHaveBeenCalled();
    expect(supervisor.snapshot()).toMatchObject({
      stdout: { text: "retained-diagnostic" },
      exitCode: null,
      signal: "SIGKILL",
    });
  } finally {
    supervisor.dispose();
  }
});

it("scopes output checkpoints to raw bytes on one supervisor and epoch", () => {
  const first = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const second = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  const owner = new ProviderProcessSupervisor(
    { process: first, ownsProcessLifetime: false },
    { maxDiagnosticBytes: 128 },
  );
  const other = new ProviderProcessSupervisor({
    process: second,
    ownsProcessLifetime: false,
  });
  try {
    first.stdout.write(Buffer.from("prior: 🧭\n", "utf8"));
    const checkpoint = owner.checkpointOutput();
    first.stdout.write(Buffer.from("current: é\n", "utf8"));
    first.stderr.write(Buffer.from([0xff, 0x61]));
    const scoped = owner.snapshotOutputSince(checkpoint);
    expect(scoped.complete).toBe(true);
    expect(scoped.snapshot.stdout.text).toBe("current: é\n");
    expect(scoped.snapshot.stdout.bytes).toBe(
      Buffer.byteLength("current: é\n"),
    );
    expect(scoped.snapshot.stderr).toEqual({
      text: "\ufffda",
      bytes: 2,
      observedBytes: 2,
      invalidUtf8: true,
    });
    expect(other.snapshotOutputSince(checkpoint).complete).toBe(false);
    owner.resetOutput();
    expect(owner.snapshotOutputSince(checkpoint).complete).toBe(false);
  } finally {
    owner.dispose();
    other.dispose();
    first.stdout.destroy();
    first.stderr.destroy();
    second.stdout.destroy();
    second.stderr.destroy();
  }
});

it.each(["stdout", "stderr"] as const)(
  "redacts a budget-cut credential in scoped %s after prior output",
  (stream) => {
    const producer = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
    const supervisor = new ProviderProcessSupervisor(
      { process: producer, ownsProcessLifetime: false },
      { maxDiagnosticBytes: 40 },
    );
    try {
      producer.stdout.write("p".repeat(32));
      const checkpoint = supervisor.checkpointOutput();
      const token = "private-transport-token";
      producer[stream].write(token);
      const scoped = supervisor.snapshotOutputSince(checkpoint);
      expect(scoped.complete).toBe(false);
      expect(scoped.snapshot.outputIncomplete).toBe(true);
      expect(scoped.snapshot[stream]).toMatchObject({
        bytes: 8,
        observedBytes: Buffer.byteLength(token),
        text: token.slice(0, 8),
      });
      expect(
        redactCapturedTransportCredential(
          scoped.snapshot[stream],
          token,
          "[REDACTED]",
        ),
      ).toBe("[REDACTED]");
    } finally {
      supervisor.dispose();
      producer.stdout.destroy();
      producer.stderr.destroy();
    }
  },
);

it("observes an exit that completed before supervision", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: 2,
    signalCode: null,
    kill: () => false,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    expect(supervisor.observedExit()).toEqual({ code: 2, signal: null });
  } finally {
    supervisor.dispose();
  }
});

it("reports a reached process memory limit only when the handle observed one", () => {
  let reached = false;
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  // A live accessor, as on the owned Windows process handle.
  Object.defineProperty(producer, "memoryLimitReached", { get: () => reached });
  const exitSnapshots: unknown[] = [];
  const supervisor = new ProviderProcessSupervisor(
    { process: producer, ownsProcessLifetime: false },
    {
      onDiagnostic: (event) => {
        if (event.type === "exit") exitSnapshots.push(event.snapshot);
      },
    },
  );
  try {
    expect(supervisor.snapshot()).not.toHaveProperty("memoryLimitReached");
    // Owned launchers record the job notification before emitting exit.
    reached = true;
    producer.emit("exit", 3, null);
    expect(supervisor.snapshot()).toMatchObject({
      exitCode: 3,
      memoryLimitReached: true,
    });
    expect(exitSnapshots).toEqual([
      expect.objectContaining({ memoryLimitReached: true }),
    ]);
  } finally {
    supervisor.dispose();
  }
});

it("projects provider output loss as truncated diagnostics without inventing a byte count", () => {
  const producer = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => false,
  });
  Object.defineProperty(producer, "outputIncomplete", { value: true });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: false,
  });
  try {
    expect(supervisor.snapshot()).toMatchObject({
      diagnosticTruncated: true,
      outputIncomplete: true,
    });
    expect(supervisor.snapshot()).not.toHaveProperty("discardedOutputBytes");
  } finally {
    supervisor.dispose();
  }
});

it("unreferences process and stream handles when stop reports incomplete cleanup", async () => {
  const unrefProcess = vi.fn();
  const unrefStdin = vi.fn();
  const unrefStdout = vi.fn();
  const unrefStderr = vi.fn();
  const producer = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new PassThrough(), { unref: unrefStdout }),
    stdin: Object.assign(new PassThrough(), { unref: unrefStdin }),
    stderr: Object.assign(new PassThrough(), { unref: unrefStderr }),
    exitCode: null,
    signalCode: null,
    kill: () => false,
    unref: unrefProcess,
  });
  const supervisor = new ProviderProcessSupervisor({
    process: producer,
    ownsProcessLifetime: true,
    cleanup: async () => ({
      cleaned: false,
      reason: "process table could not be inspected: spawn EPERM",
    }),
  });
  try {
    const result = await supervisor.stop();
    expect(result).toMatchObject({
      status: "incomplete",
      reason: "process table could not be inspected: spawn EPERM",
    });
    expect(unrefProcess).toHaveBeenCalledTimes(1);
    expect(unrefStdin).toHaveBeenCalledTimes(1);
    expect(unrefStdout).toHaveBeenCalledTimes(1);
    expect(unrefStderr).toHaveBeenCalledTimes(1);
  } finally {
    supervisor.dispose();
  }
});
