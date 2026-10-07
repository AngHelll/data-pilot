import {
  type EngineOp,
  type TrustMode,
  isUntrustedAllowed,
  type Diagnostic,
} from "@data-pilot/contracts";

export interface SessionContext {
  trustMode: TrustMode;
}

export function assertOpAllowed(
  ctx: SessionContext,
  op: EngineOp,
): Diagnostic | null {
  if (ctx.trustMode === "untrusted-limited" && !isUntrustedAllowed(op)) {
    return {
      code: "untrusted-blocked",
      severity: "error",
      message: `Operation '${op}' is not available in untrusted workspaces`,
    };
  }
  return null;
}
