import { useEffect, useState } from "react";
import { api, type ProductReview as Review } from "./api.js";
import { message } from "./components.js";

export function useProductReview(snapshotId: string) {
  const [modulePath, setModulePath] = useState("");
  const [request, setRequest] = useState<{
    modulePath: string;
    offset: number;
    revision: number;
  }>();
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setReview(undefined);
    void api<Review>("product", {
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

  return { modulePath, setModulePath, setRequest, review, error, loading };
}
