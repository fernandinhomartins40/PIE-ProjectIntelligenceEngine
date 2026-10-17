/** Trusted reporter copied outside target sources and selected explicitly by the sandbox. */
export function nodeReporterSource(
  input: {
    coverageFocus: Array<{ sourcePath: string; line: number }>;
  } = { coverageFocus: [] },
): string {
  const coverageFocus = JSON.stringify(input.coverageFocus);
  return String.raw`
const coverageFocus = ${coverageFocus};
export default async function* report(source) {
  let coverageReported = false;
  for await (const { type, data } of source) {
    if (type === 'test:pass' || type === 'test:fail') {
      yield JSON.stringify({ protocolVersion: 1, kind: 'case', name: data.name,
        file: data.file ?? null, line: data.line ?? null, nesting: data.nesting,
        category: data.details?.type === 'suite' ? 'suite' : 'test',
        outcome: data.skip !== undefined && data.skip !== false ? 'skipped' : data.todo !== undefined && data.todo !== false ? 'todo' : type === 'test:pass' ? 'passed' : 'failed'
      }) + '\n';
    }
    if (type === 'test:summary' && data.file === undefined) {
      yield JSON.stringify({ protocolVersion: 1, kind: 'summary', counts: data.counts,
        durationMs: data.duration_ms, success: data.success }) + '\n';
    }
    if (type === 'test:coverage') {
      coverageReported = true;
      const files = Array.isArray(data.summary?.files) ? data.summary.files : [];
      const fileByPath = new Map(files.map((file) => [file.path.replaceAll('\\', '/'), file]));
      const executed = coverageFocus.filter((focus) => {
        const file = fileByPath.get('/source/' + focus.sourcePath);
        return Array.isArray(file?.lines) && file.lines.some((line) =>
          line.line === focus.line && Number.isSafeInteger(line.count) && line.count > 0);
      });
      yield JSON.stringify({ protocolVersion: 1, kind: 'runtime-locations', complete: files.length > 0,
        locations: executed }) + '\n';
    }
  }
  if (coverageFocus.length > 0 && !coverageReported)
    yield JSON.stringify({ protocolVersion: 1, kind: 'runtime-locations', complete: false,
      locations: [] }) + '\n';
}
`;
}

export const NODE_REPORTER_SOURCE = nodeReporterSource();
