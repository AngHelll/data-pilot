import type { DqlQuery, Predicate, Stage } from "./ast.js";

function fmtPred(p: Predicate): string {
  switch (p.kind) {
    case "or":
      return `${fmtPred(p.left)} or ${fmtPred(p.right)}`;
    case "and":
      return `${fmtPred(p.left)} and ${fmtPred(p.right)}`;
    case "not":
      return `not ${fmtPred(p.inner)}`;
    case "cmp":
      return `${fmtExpr(p.left)} ${p.op} ${fmtExpr(p.right)}`;
    case "is": {
      const neg = p.negated ? " not" : "";
      return `${fmtExpr(p.expr)} is${neg} ${p.test}`;
    }
    case "contains":
      return `contains(${fmtExpr(p.expr)}, ${JSON.stringify(p.needle)})`;
    case "in":
      return `${fmtExpr(p.expr)} in [${p.values.map(fmtExpr).join(", ")}]`;
  }
}

function fmtExpr(e: import("./ast.js").Expr): string {
  switch (e.kind) {
    case "column":
      return /[^A-Za-z0-9_]/.test(e.name) ? `\`${e.name.replace(/`/g, "``")}\`` : e.name;
    case "string":
      return JSON.stringify(e.value);
    case "integer":
    case "decimal":
      return e.value;
    case "boolean":
      return e.value ? "true" : "false";
    case "null":
      return "null";
    case "missing":
      return "missing";
    case "param":
      return `$${e.name}`;
    case "date":
      return `date(${fmtExpr(e.arg)})`;
  }
}

function fmtStage(s: Stage): string {
  switch (s.kind) {
    case "find": {
      let out = `find ${JSON.stringify(s.needle)}`;
      if (s.columns) out += ` in ${s.columns.join(", ")}`;
      out += ` case ${s.caseMode}`;
      return out;
    }
    case "where":
      return `where ${fmtPred(s.predicate)}`;
    case "select":
      return `select ${s.columns.join(", ")}`;
    case "take":
      return `take ${s.count}`;
    case "count":
      return "count";
  }
}

/** Canonical formatter — emits `is not null` spacing/case. */
export function formatDql(query: DqlQuery): string {
  if (query.stages.length === 0) return "";
  return query.stages.map(fmtStage).join(" | ");
}
