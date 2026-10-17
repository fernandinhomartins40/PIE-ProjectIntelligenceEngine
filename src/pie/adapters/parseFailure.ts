export type AdapterParseFailureKind =
  | "invalid_syntax"
  | "invalid_structure"
  | "unsupported_format";

/** A known source rejection; unexpected implementation errors must remain thrown. */
export class AdapterParseFailure extends Error {
  constructor(
    readonly kind: AdapterParseFailureKind,
    message: string = kind,
  ) {
    super(message);
    this.name = "AdapterParseFailure";
  }
}
