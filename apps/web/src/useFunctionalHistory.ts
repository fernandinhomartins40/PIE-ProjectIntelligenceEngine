import { useEffect, useState } from "react";
import {
  api,
  type FunctionalHistory,
  type FunctionalRecord,
  type FunctionalReview,
} from "./api.js";
import { message } from "./components.js";

export function useFunctionalHistory(
  snapshotId: string,
  review: FunctionalReview | undefined,
) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<FunctionalHistory>();
  const [selected, setSelected] = useState("");
  const [record, setRecord] = useState<FunctionalRecord>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setHistory(undefined);
    void api<FunctionalHistory>(
      `functional-records?snapshotId=${snapshotId}&limit=10&offset=${offset}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setHistory(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [snapshotId, offset, revision]);
  useEffect(() => {
    setRecord(undefined);
    if (!selected) return;
    const controller = new AbortController();
    void api<FunctionalRecord>(`functional-records/${selected}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setRecord(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [selected]);
  async function save() {
    if (!review || saving) return;
    setSaving(true);
    setError("");
    try {
      const value = await api<FunctionalRecord>("functional-records", {
        method: "POST",
        body: {
          snapshotId,
          modulePath: review.scope.modulePath,
          offset: review.findings.offset,
          limit: 10,
        },
      });
      setSelected(value.id);
      setRevision((previous) => previous + 1);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }
  return {
    offset,
    setOffset,
    history,
    selected,
    setSelected,
    record,
    saving,
    error,
    save,
    refresh: () => {
      setError("");
      setRevision((value) => value + 1);
    },
  };
}
