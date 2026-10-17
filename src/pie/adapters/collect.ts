import { randomUUID } from "node:crypto";
import type { Evidence } from "../contracts.js";
import { sealEvidence } from "../evidence.js";
import {
  declarationEvidenceObservation,
  derivationEvidenceObservation,
  type AdapterFact,
  type AdapterRead,
} from "./contracts.js";
import { declarationIdentity } from "./identity.js";

/** Owns conversion from parsed facts and their derivations to immutable Evidence. */
export function collectDeclarations(
  file: Evidence,
  parsed: AdapterRead | null,
) {
  const evidence: Evidence[] = [];
  const declarations: AdapterFact[] = [];
  const byId = new Map<string, AdapterFact>();
  let repeated = 0;
  if (!parsed) return { evidence, declarations, limitations: [] };
  const { sha256: previousDigest, ...fields } = file;
  void previousDigest;
  const makeProof = (
    line: number,
    observation: string,
    redactions: string[] = [],
  ) =>
    sealEvidence({
      ...fields,
      id: randomUUID(),
      source: { ...file.source, line },
      confidence: "derived",
      redactionStatus: redactions.length ? "redacted" : fields.redactionStatus,
      limitations: [...fields.limitations, ...redactions],
      observation,
    });
  for (const declaration of parsed.declarations) {
    const value = {
      adapter: declaration.adapter,
      kind: declaration.kind,
      name: declaration.name,
      parent: declaration.parent,
      relation: declaration.relation ?? null,
    };
    const source = { ...file.source, line: declaration.line };
    const id = declarationIdentity({ ...value, source });
    const existing = byId.get(id);
    const existingDerivations = new Set(
      existing?.derivations.map((item) =>
        JSON.stringify([
          item.line,
          item.operation,
          item.prefix,
          item.sourcePath ?? null,
        ]),
      ) ?? [],
    );
    const derivations = (declaration.derivedFrom ?? []).filter((item) => {
      const key = JSON.stringify([
        item.line,
        item.operation,
        item.prefix,
        item.sourcePath ?? null,
      ]);
      if (existingDerivations.has(key)) return false;
      existingDerivations.add(key);
      return true;
    });
    const derivationProofs = derivations.map((derivation) => {
      const proof = makeProof(
        derivation.line,
        derivationEvidenceObservation(derivation),
      );
      return { ...derivation, evidenceId: proof.id, proof };
    });
    if (existing) {
      existing.derivations.push(
        ...derivationProofs.map(({ proof: _proof, ...item }) => item),
      );
      evidence.push(...derivationProofs.map((item) => item.proof));
      repeated++;
      continue;
    }
    const proof = makeProof(
      declaration.line,
      declarationEvidenceObservation(value),
      declaration.redactions ?? [],
    );
    const fact: AdapterFact = {
      ...value,
      source: proof.source,
      id,
      provenanceVersion: declaration.relation ? 4 : 3,
      evidenceId: proof.id,
      derivations: derivationProofs.map(({ proof: _proof, ...item }) => item),
      method: "static",
      state: "unverified",
    };
    byId.set(id, fact);
    declarations.push(fact);
    evidence.push(proof, ...derivationProofs.map((item) => item.proof));
  }
  return {
    evidence,
    declarations,
    limitations: [
      ...parsed.limitations.map((value) => `${file.source.path}: ${value}`),
      ...(repeated
        ? [
            `${file.source.path}: ${repeated} declarações idênticas na mesma linha foram consolidadas; derivações distintas preservaram suas próprias evidências.`,
          ]
        : []),
    ],
  };
}
