/** Trusted reporter copied outside target sources and selected explicitly by the sandbox. */
export const NODE_REPORTER_SOURCE = String.raw`
export default async function* report(source) {
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
  }
}
`;
