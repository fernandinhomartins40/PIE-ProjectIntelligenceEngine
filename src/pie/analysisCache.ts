import { sha256 } from "./evidence.js";

const MAX_ENTRIES = 8_192;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;

type Entry = { value: unknown; bytes: number };
const entries = new Map<string, Entry>();
let retainedBytes = 0;
let hits = 0;
let misses = 0;
let evictions = 0;

/**
 * Process-local LRU for bounded parser outputs only. Source bodies, Evidence,
 * project state and runtime observations are never retained here.
 */
export function cachedAnalysis<T>(
  keyParts: readonly (string | number)[],
  parse: () => T,
): T {
  const key = sha256(JSON.stringify(keyParts));
  const existing = entries.get(key);
  if (existing) {
    entries.delete(key);
    entries.set(key, existing);
    hits++;
    return structuredClone(existing.value) as T;
  }
  misses++;
  const value = parse();
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return value;
  const bytes = Buffer.byteLength(serialized);
  if (bytes > MAX_ENTRY_BYTES) return value;
  while (entries.size >= MAX_ENTRIES || retainedBytes + bytes > MAX_BYTES) {
    const oldest = entries.entries().next().value as
      | [string, Entry]
      | undefined;
    if (!oldest) break;
    entries.delete(oldest[0]);
    retainedBytes -= oldest[1].bytes;
    evictions++;
  }
  entries.set(key, { value: structuredClone(value), bytes });
  retainedBytes += bytes;
  return value;
}

export function analysisCacheStats() {
  return {
    entries: entries.size,
    retainedBytes,
    hits,
    misses,
    evictions,
    maxEntries: MAX_ENTRIES,
    maxBytes: MAX_BYTES,
    maxEntryBytes: MAX_ENTRY_BYTES,
  };
}

/** Test-only reset; production callers must rely on content-addressed keys. */
export function clearAnalysisCache() {
  entries.clear();
  retainedBytes = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
}
