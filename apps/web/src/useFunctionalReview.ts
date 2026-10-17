import { useEffect, useState } from "react";
import { api, type FunctionalReview as Review, type Evidence } from "./api.js";
import { message } from "./components.js";
export function useFunctionalReview(snapshotId: string) {
  const [modulePath, setModulePath] = useState("");
  const [request, setRequest] = useState<{
    modulePath: string;
    offset: number;
    revision: number;
  }>();
  const [review, setReview] = useState<Review>();
  const [proofId, setProofId] = useState("");
  const [proof, setProof] = useState<Evidence>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setProofId("");
    setProof(undefined);
    setReview(undefined);
    void api<Review>("functional", {
      method: "POST",
      body: {
        snapshotId,
        modulePath: request.modulePath,
        offset: request.offset,
        limit: 10,
      },
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setReview(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [snapshotId, request]);
  useEffect(() => {
    if (!proofId) return;
    const controller = new AbortController();
    setProof(undefined);
    void api<Evidence>(`evidence/${proofId}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setProof(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(message(cause));
      });
    return () => controller.abort();
  }, [proofId]);
  return {
    modulePath,
    setModulePath,
    request,
    setRequest,
    review,
    proof,
    setProofId,
    error,
    loading,
  };
}
