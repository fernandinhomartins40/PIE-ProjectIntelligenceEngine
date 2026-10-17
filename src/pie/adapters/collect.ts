import { randomUUID } from "node:crypto";
import type { Evidence } from "../contracts.js";
import { sealEvidence } from "../evidence.js";
import type { AdapterFact, AdapterRead } from "./contracts.js";
import { declarationIdentity } from "./identity.js";

/** Owns conversion from parser declarations into immutable evidence-linked facts. */
export function collectDeclarations(
  file: Evidence,
  parsed: AdapterRead | null,
) {
  const evidence: Evidence[] = [];
  const declarations: AdapterFact[] = [];
  const identities = new Set<string>();
  let repeated = 0;
  try {
    if (!parsed) return { evidence, declarations, limitations: [] };
    const { sha256: previousDigest, ...fields } = file;
    void previousDigest;
    for (const declaration of parsed.declarations) {
      const proof = sealEvidence({
        ...fields,
        id: randomUUID(),
        source: { ...file.source, line: declaration.line },
        confidence: "derived",
        observation: `Declaração estática ${declaration.kind} identificada por ${declaration.adapter}; não verificada em execução.`,
      });
      const value = {
        adapter: declaration.adapter,
        kind: declaration.kind,
        name: declaration.name,
        parent: declaration.parent,
        source: proof.source,
      };
      const id = declarationIdentity(value);
      if (identities.has(id)) {
        repeated++;
        continue;
      }
      identities.add(id);
      declarations.push({
        ...value,
        id,
        evidenceId: proof.id,
        method: "static",
        state: "unverified",
      });
      evidence.push(proof);
    }
    return {
      evidence,
      declarations,
      limitations: [
        ...parsed.limitations.map((value) => `${file.source.path}: ${value}`),
        ...(repeated
          ? [
              `${file.source.path}: ${repeated} declarações idênticas na mesma linha foram consolidadas; ocorrências não distinguíveis por coluna.`,
            ]
          : []),
      ],
    };
  } catch {
    return {
      evidence: [],
      declarations: [],
      limitations: [
        `${file.source.path}: formato declarativo não analisado; nenhuma declaração inferida a partir da falha.`,
      ],
    };
  }
}
