import { sha256 } from "../evidence.js";
import type { AdapterFact } from "./contracts.js";

export const declarationIdentity = (
  fact: Pick<AdapterFact, "source" | "adapter" | "kind" | "name" | "parent">,
): string =>
  sha256(
    JSON.stringify([
      fact.source.path,
      fact.adapter,
      fact.kind,
      fact.name,
      fact.parent,
      fact.source.line,
    ]),
  );
