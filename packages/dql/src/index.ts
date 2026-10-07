/**
 * DQL package stub — Phase 0 closes the spec only (see docs/DQL-SPEC.md).
 * Full tokenizer/parser arrives in Phase 2 after the spec gate.
 */

export const DQL_VERSION = "0.1" as const;

/** Placeholder AST root — shape locked in Phase 2 against DQL-SPEC. */
export type DqlAst = {
  version: typeof DQL_VERSION;
  /** Raw source retained until parser produces a typed tree. */
  source: string;
};

export function unsupportedParser(_source: string): never {
  throw new Error(
    "DQL parser is not implemented in Phase 0. See docs/DQL-SPEC.md (closed before parser work).",
  );
}
