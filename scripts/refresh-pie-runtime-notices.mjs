import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

// Read release archives as data only; never extract files or run package scripts.
const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(resolve(root, "package-lock.json"), "utf8"),
);
const noticePath = resolve(root, "licenses/npm-runtime-notices.txt");
let notices = await readFile(noticePath, "utf8");
const entries = Object.entries(lock.packages)
  .filter(([path]) => path !== "")
  .map(([path, record]) => ({
    path,
    name: record.name ?? path.slice(path.lastIndexOf("node_modules/") + 13),
    version: record.version,
    license: record.license ?? "UNDECLARED",
    resolved: record.resolved,
    integrity: record.integrity,
    dev: record.dev === true,
    optional: record.optional === true,
  }))
  .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const runtime = entries.filter((entry) => !entry.dev);
const fingerprint = createHash("sha256")
  .update(JSON.stringify(runtime))
  .digest("hex");
const seen = new Set(
  [...notices.matchAll(/^===== (.+) =====$/gmu)].map((match) => match[1]),
);
const additions = [];
const noticeGaps = [];

function archiveFiles(bytes) {
  const archive = gunzipSync(bytes, { maxOutputLength: 100_000_000 });
  const files = new Map();
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const str = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const name = [str(345, 155), str(0, 100)].filter(Boolean).join("/");
    const size = Number.parseInt(str(124, 12).trim(), 8);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > archive.length
    )
      throw new Error("Invalid bounded tar entry");
    const type = str(156, 1);
    if (
      (type === "0" || type === "") &&
      (/^[^/]+\/package\.json$/.test(name) ||
        /(?:^|\/)(?:licen[cs]e|copying|copyright|notice)(?:[._-][^/]*)?$/i.test(
          name,
        ))
    )
      files.set(
        name,
        archive.subarray(offset + 512, offset + 512 + size).toString("utf8"),
      );
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

for (const entry of runtime) {
  const identity = `${entry.name}@${entry.version}`;
  if (seen.has(identity)) continue;
  const url = new URL(entry.resolved);
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org")
    throw new Error(`Unreviewed package origin: ${identity}`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Archive unavailable: ${identity}`);
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > 50_000_000)
      throw new Error(`Archive limit exceeded: ${identity}`);
    parts.push(part);
  }
  const bytes = Buffer.concat(parts);
  const [algorithm, expected] = entry.integrity.split("-");
  if (
    !["sha512", "sha256"].includes(algorithm) ||
    createHash(algorithm).update(bytes).digest("base64") !== expected
  )
    throw new Error(`Archive integrity mismatch: ${identity}`);
  const files = archiveFiles(bytes);
  const metadataPath = [...files.keys()].find((path) =>
    /^[^/]+\/package\.json$/.test(path),
  );
  const metadata = JSON.parse(files.get(metadataPath) ?? "{}");
  if (metadata.name !== entry.name || metadata.version !== entry.version)
    throw new Error(`Archive identity mismatch: ${identity}`);
  files.delete(metadataPath);
  if (files.size === 0) {
    noticeGaps.push(identity);
    files.set(
      "UPSTREAM_NOTICE_GAP",
      `The integrity-verified published archive contains no standalone LICENSE, COPYING, COPYRIGHT or NOTICE document recognized by this collector. Its package metadata declares license ${JSON.stringify(metadata.license ?? "UNDECLARED")}. This is an unresolved upstream notice gap, not recovered attribution or permission to omit applicable notices. Review the actual upstream source before redistributing this component. PIE remains a private package pending release review.`,
    );
  }
  additions.push(
    `===== ${identity} =====\nDeclared license: ${entry.license}\nArchive: ${entry.resolved}\nIntegrity: ${entry.integrity}\nScope: npm runtime dependency, including optional platform packages.\n\n${[...files].map(([path, content]) => `--- ${path} ---\n\n${content}`).join("\n\n")}\n`,
  );
  seen.add(identity);
}
notices = notices.replace(
  /Runtime dependency fingerprint \(SHA-256\): [a-f0-9]+/,
  `Runtime dependency fingerprint (SHA-256): ${fingerprint}`,
);
await writeFile(
  noticePath,
  `${notices.trimEnd()}\n\n${additions.join("\n")}`,
  "utf8",
);
console.log(
  JSON.stringify({
    appendedEntries: additions.length,
    noticeGaps,
    runtimeFingerprint: fingerprint,
  }),
);
