import type { Trace } from "./api.js";
import { Notice, Pager } from "./components.js";

export function TraceResult({
  trace,
  onEvidence,
  onPage,
  limit,
}: {
  trace: Trace;
  onEvidence: (id: string) => void;
  onPage: (offset: number) => void;
  limit: number;
}) {
  const labels = new Map(
    trace.nodes.items.map((node) => [node.id, node.label]),
  );
  return (
    <>
      <Notice>
        {trace.nodes.total} nós alcançados · {trace.edges.total} relações ·{" "}
        {trace.coverage.truncated
          ? "Busca truncada pelos limites"
          : "Busca concluída nas relações registradas"}
        . Execução não verificada.
      </Notice>
      <div className="table-wrap">
        <table>
          <caption>Nós alcançados no trace</caption>
          <thead>
            <tr>
              <th>Nó</th>
              <th>Tipo</th>
              <th>Origem</th>
              <th>Evidência</th>
            </tr>
          </thead>
          <tbody>
            {trace.nodes.items.map((node) => (
              <tr key={node.id}>
                <td>{node.label}</td>
                <td>{node.kind}</td>
                <td className="path">
                  {node.path}
                  {node.line ? `:${node.line}` : ""}
                </td>
                <td>
                  <button onClick={() => onEvidence(node.evidenceIds[0]!)}>
                    Ver evidência
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table>
          <caption>Relações registradas no trace</caption>
          <thead>
            <tr>
              <th>Origem</th>
              <th>Relação</th>
              <th>Destino</th>
              <th>Confiança / evidência</th>
            </tr>
          </thead>
          <tbody>
            {trace.edges.items.map((edge) => (
              <tr key={edge.id}>
                <td className="path">{labels.get(edge.from) ?? edge.from}</td>
                <td>{edge.kind}</td>
                <td className="path">{labels.get(edge.to) ?? edge.to}</td>
                <td>
                  {edge.confidence}
                  {edge.evidenceIds.map((id) => (
                    <button key={id} onClick={() => onEvidence(id)}>
                      Ver evidência
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        As tabelas são paginadas juntas. Cada página pode ter apenas nós ou
        relações; IDs identificam nós fora da página atual.
      </p>
      <Pager
        offset={trace.nodes.offset}
        total={Math.max(trace.nodes.total, trace.edges.total)}
        limit={limit}
        onChange={onPage}
      />
      <details>
        <summary>
          Limites e relações não resolvidas (
          {trace.coverage.unresolvedRelations})
        </summary>
        <ul>
          {trace.coverage.limitations.map((value, index) => (
            <li key={index}>{value}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
