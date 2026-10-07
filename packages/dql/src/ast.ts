export type Span = { start: number; end: number };

export type CaseMode = "sensitive" | "insensitive";

export type Expr =
  | { kind: "column"; name: string; span: Span }
  | { kind: "string"; value: string; span: Span }
  | { kind: "integer"; value: string; span: Span }
  | { kind: "decimal"; value: string; span: Span }
  | { kind: "boolean"; value: boolean; span: Span }
  | { kind: "null"; span: Span }
  | { kind: "missing"; span: Span }
  | { kind: "param"; name: string; span: Span }
  | { kind: "date"; arg: Expr; span: Span };

export type Predicate =
  | { kind: "or"; left: Predicate; right: Predicate; span: Span }
  | { kind: "and"; left: Predicate; right: Predicate; span: Span }
  | { kind: "not"; inner: Predicate; span: Span }
  | {
      kind: "cmp";
      op: "=" | "!=" | "<" | "<=" | ">" | ">=";
      left: Expr;
      right: Expr;
      span: Span;
    }
  | {
      kind: "is";
      expr: Expr;
      test: "null" | "missing" | "empty";
      negated: boolean;
      span: Span;
    }
  | { kind: "contains"; expr: Expr; needle: string; span: Span }
  | { kind: "in"; expr: Expr; values: Expr[]; span: Span };

export type Stage =
  | {
      kind: "find";
      needle: string;
      columns: string[] | null;
      caseMode: CaseMode;
      span: Span;
    }
  | { kind: "where"; predicate: Predicate; span: Span }
  | { kind: "select"; columns: string[]; span: Span }
  | { kind: "take"; count: number; span: Span }
  | { kind: "count"; span: Span }
  | { kind: "expectCount"; count: number; span: Span };

export interface DqlQuery {
  version: "0.1";
  source: string;
  stages: Stage[];
}

export interface SourceRange {
  start: number;
  end: number;
}
