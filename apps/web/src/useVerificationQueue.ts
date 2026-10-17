import { useEffect, useState } from "react";
import type { Job } from "../../../src/pie/jobs/contracts.js";
import { api, type Context } from "./api.js";
import { message } from "./components.js";

export function useVerificationQueue(snapshotId: string) {
  const [enabled, setEnabled] = useState(false);
  const [authorization, setAuthorization] = useState("");
  const [key, setKey] = useState("");
  const [lookup, setLookup] = useState("");
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<Context>("context", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted)
          setEnabled(value.verificationQueueEnabled);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, []);
  async function request(action: "enqueue" | "read" | "cancel") {
    setError("");
    setBusy(true);
    try {
      let value: Job;
      if (action === "enqueue") {
        let grant: unknown;
        try {
          grant = JSON.parse(authorization);
        } catch {
          throw new Error("A autorização precisa ser um JSON válido.");
        }
        if (
          !grant ||
          typeof grant !== "object" ||
          !("snapshotId" in grant) ||
          grant.snapshotId !== snapshotId
        )
          throw new Error("A autorização deve indicar o snapshot selecionado.");
        value = await api<Job>("jobs/verification", {
          method: "POST",
          body: { idempotencyKey: key, authorization: grant },
        });
      } else {
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            lookup,
          )
        )
          throw new Error("Informe o UUID do job.");
        if (action === "cancel") {
          const current = await api<Job>(`jobs/${lookup}`);
          if (
            current.kind !== "verification" ||
            current.payload.snapshotId !== snapshotId
          )
            throw new Error("Job não pertence a este snapshot VERIFY.");
        }
        value = await api<Job>(
          `jobs/${lookup}${action === "cancel" ? "/cancel" : ""}`,
          action === "cancel" ? { method: "POST" } : {},
        );
      }
      if (
        value.kind !== "verification" ||
        value.payload.snapshotId !== snapshotId
      )
        throw new Error("Job não pertence a este snapshot VERIFY.");
      setJob(value);
      setLookup(value.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  return {
    enabled,
    authorization,
    setAuthorization,
    key,
    setKey,
    lookup,
    setLookup,
    job,
    error,
    busy,
    request,
  };
}
