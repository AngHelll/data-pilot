import type {
  CaseMode,
  DqlQuery,
  Expr,
  Predicate,
  Span,
  Stage,
} from "./ast.js";
import { TokenizeError, tokenize, type Token } from "./tokenize.js";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly span: Span,
    readonly code: string = "parse-error",
  ) {
    super(message);
    this.name = "ParseError";
  }
}

const UNSUPPORTED = new Set(["sort", "group", "duplicates", "expect", "when"]);

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  private peek(): Token {
    return this.tokens[this.i] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.i += 1;
    return t;
  }

  private matchIdent(...names: string[]): Token | null {
    const t = this.peek();
    if (t.kind === "ident" && names.includes(t.value.toLowerCase())) {
      return this.advance();
    }
    return null;
  }

  private expectIdent(...names: string[]): Token {
    const t = this.matchIdent(...names);
    if (!t) {
      const got = this.peek();
      throw new ParseError(
        `Expected ${names.join("|")}, got '${got.value || got.kind}'`,
        got.span,
      );
    }
    return t;
  }

  private expect(kind: Token["kind"]): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(`Expected ${kind}, got '${t.value || t.kind}'`, t.span);
    }
    return this.advance();
  }

  parse(): DqlQuery {
    if (this.peek().kind === "eof") {
      return { version: "0.1", source: this.source, stages: [] };
    }
    const stages: Stage[] = [];
    stages.push(this.parseStage());
    while (this.peek().kind === "pipe") {
      this.advance();
      stages.push(this.parseStage());
    }
    if (this.peek().kind !== "eof") {
      throw new ParseError("Unexpected tokens after query", this.peek().span);
    }
    validatePipeline(stages);
    return { version: "0.1", source: this.source, stages };
  }

  private parseStage(): Stage {
    const t = this.peek();
    if (t.kind !== "ident") {
      throw new ParseError("Expected stage keyword", t.span);
    }
    const kw = t.value.toLowerCase();
    if (UNSUPPORTED.has(kw)) {
      throw new ParseError(
        `'${kw}' is not supported in DQL 0.1`,
        t.span,
        "unsupported-operation",
      );
    }
    if (kw === "find") return this.parseFind();
    if (kw === "where") return this.parseWhere();
    if (kw === "select") return this.parseSelect();
    if (kw === "take") return this.parseTake();
    if (kw === "count") return this.parseCount();
    throw new ParseError(`Unknown stage '${t.value}'`, t.span);
  }

  private parseFind(): Stage {
    const start = this.expectIdent("find").span.start;
    const needleTok = this.expect("string");
    let columns: string[] | null = null;
    if (this.matchIdent("in")) {
      columns = [this.parseColumnName()];
      while (this.peek().kind === "comma") {
        this.advance();
        columns.push(this.parseColumnName());
      }
    }
    let caseMode: CaseMode = "insensitive";
    if (this.matchIdent("case")) {
      const mode = this.expectIdent("sensitive", "insensitive");
      caseMode = mode.value.toLowerCase() as CaseMode;
    }
    return {
      kind: "find",
      needle: needleTok.value,
      columns,
      caseMode,
      span: { start, end: this.tokens[this.i - 1]!.span.end },
    };
  }

  private parseWhere(): Stage {
    const start = this.expectIdent("where").span.start;
    const predicate = this.parseOr();
    return {
      kind: "where",
      predicate,
      span: { start, end: predicate.span.end },
    };
  }

  private parseSelect(): Stage {
    const start = this.expectIdent("select").span.start;
    const columns = [this.parseColumnName()];
    while (this.peek().kind === "comma") {
      this.advance();
      columns.push(this.parseColumnName());
    }
    const dup = columns.find((c, idx) => columns.indexOf(c) !== idx);
    if (dup) {
      throw new ParseError(`Duplicate column '${dup}' in select`, {
        start,
        end: this.tokens[this.i - 1]!.span.end,
      });
    }
    return {
      kind: "select",
      columns,
      span: { start, end: this.tokens[this.i - 1]!.span.end },
    };
  }

  private parseTake(): Stage {
    const start = this.expectIdent("take").span.start;
    const nTok = this.expect("integer");
    const count = Number(nTok.value);
    if (!Number.isInteger(count) || count < 0) {
      throw new ParseError("take requires a non-negative integer", nTok.span);
    }
    return { kind: "take", count, span: { start, end: nTok.span.end } };
  }

  private parseCount(): Stage {
    const tok = this.expectIdent("count");
    return { kind: "count", span: tok.span };
  }

  private parseColumnName(): string {
    const t = this.expect("ident");
    return t.value;
  }

  private parseOr(): Predicate {
    let left = this.parseAnd();
    while (this.matchIdent("or")) {
      const right = this.parseAnd();
      left = {
        kind: "or",
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parseAnd(): Predicate {
    let left = this.parseNot();
    while (this.matchIdent("and")) {
      const right = this.parseNot();
      left = {
        kind: "and",
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      };
    }
    return left;
  }

  private parseNot(): Predicate {
    if (this.matchIdent("not")) {
      const start = this.tokens[this.i - 1]!.span.start;
      const inner = this.parseNot();
      return { kind: "not", inner, span: { start, end: inner.span.end } };
    }
    return this.parsePrimaryPred();
  }

  private parsePrimaryPred(): Predicate {
    if (this.peek().kind === "lparen") {
      this.advance();
      const inner = this.parseOr();
      this.expect("rparen");
      return inner;
    }

    if (this.matchIdent("contains")) {
      const start = this.tokens[this.i - 1]!.span.start;
      this.expect("lparen");
      const expr = this.parseExpr();
      this.expect("comma");
      const needle = this.expect("string");
      const end = this.expect("rparen").span.end;
      return { kind: "contains", expr, needle: needle.value, span: { start, end } };
    }

    if (this.matchIdent("in")) {
      // in(expr, [literals]) — also `expr in [...]` not in grammar; only function form
      const start = this.tokens[this.i - 1]!.span.start;
      this.expect("lparen");
      const expr = this.parseExpr();
      this.expect("comma");
      this.expect("lbracket");
      const values: Expr[] = [];
      if (this.peek().kind !== "rbracket") {
        values.push(this.parseLiteralExpr());
        while (this.peek().kind === "comma") {
          this.advance();
          values.push(this.parseLiteralExpr());
        }
      }
      this.expect("rbracket");
      const end = this.expect("rparen").span.end;
      return { kind: "in", expr, values, span: { start, end } };
    }

    const expr = this.parseExpr();

    if (this.matchIdent("is")) {
      let negated = false;
      if (this.matchIdent("not")) negated = true;
      const testTok = this.expectIdent("null", "missing", "empty");
      const test = testTok.value.toLowerCase() as "null" | "missing" | "empty";
      return {
        kind: "is",
        expr,
        test,
        negated,
        span: { start: expr.span.start, end: testTok.span.end },
      };
    }

    // Spec example form: `currency in ["MXN", "USD"]`
    if (this.matchIdent("in")) {
      this.expect("lbracket");
      const values: Expr[] = [];
      if (this.peek().kind !== "rbracket") {
        values.push(this.parseLiteralExpr());
        while (this.peek().kind === "comma") {
          this.advance();
          values.push(this.parseLiteralExpr());
        }
      }
      const end = this.expect("rbracket").span.end;
      return { kind: "in", expr, values, span: { start: expr.span.start, end } };
    }

    const opTok = this.peek();
    if (
      opTok.kind === "eq" ||
      opTok.kind === "neq" ||
      opTok.kind === "lt" ||
      opTok.kind === "lte" ||
      opTok.kind === "gt" ||
      opTok.kind === "gte"
    ) {
      this.advance();
      const right = this.parseExpr();
      const op =
        opTok.kind === "eq"
          ? "="
          : opTok.kind === "neq"
            ? "!="
            : opTok.kind === "lt"
              ? "<"
              : opTok.kind === "lte"
                ? "<="
                : opTok.kind === "gt"
                  ? ">"
                  : ">=";
      return {
        kind: "cmp",
        op,
        left: expr,
        right,
        span: { start: expr.span.start, end: right.span.end },
      };
    }

    throw new ParseError("Expected comparison or null-test after expression", expr.span);
  }

  private parseExpr(): Expr {
    if (this.matchIdent("date")) {
      const start = this.tokens[this.i - 1]!.span.start;
      this.expect("lparen");
      const arg = this.parseExpr();
      const end = this.expect("rparen").span.end;
      return { kind: "date", arg, span: { start, end } };
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.peek();
    if (t.kind === "ident") {
      const lower = t.value.toLowerCase();
      if (lower === "true" || lower === "false") {
        this.advance();
        return { kind: "boolean", value: lower === "true", span: t.span };
      }
      if (lower === "null") {
        this.advance();
        return { kind: "null", span: t.span };
      }
      if (lower === "missing") {
        this.advance();
        return { kind: "missing", span: t.span };
      }
      this.advance();
      return { kind: "column", name: t.value, span: t.span };
    }
    if (t.kind === "string") {
      this.advance();
      return { kind: "string", value: t.value, span: t.span };
    }
    if (t.kind === "integer") {
      this.advance();
      return { kind: "integer", value: t.value, span: t.span };
    }
    if (t.kind === "decimal") {
      this.advance();
      return { kind: "decimal", value: t.value, span: t.span };
    }
    if (t.kind === "param") {
      this.advance();
      return { kind: "param", name: t.value, span: t.span };
    }
    throw new ParseError("Expected expression", t.span);
  }

  private parseLiteralExpr(): Expr {
    const expr = this.parseAtom();
    if (expr.kind === "column" || expr.kind === "param" || expr.kind === "date") {
      throw new ParseError("Expected literal in list", expr.span);
    }
    return expr;
  }
}

function validatePipeline(stages: Stage[]): void {
  let seenFind = false;
  let seenSelect = false;
  let seenTake = false;
  let seenCount = false;
  let phase: "find" | "where" | "select" | "tail" = "find";

  for (const stage of stages) {
    if (stage.kind === "find") {
      if (seenFind || phase !== "find") {
        throw new ParseError("Invalid pipeline: find must be first and unique", stage.span, "invalid-pipeline");
      }
      seenFind = true;
      phase = "where";
      continue;
    }
    if (stage.kind === "where") {
      if (phase === "select" || phase === "tail") {
        throw new ParseError("Invalid pipeline: where after select/take/count", stage.span, "invalid-pipeline");
      }
      if (phase === "find") phase = "where";
      continue;
    }
    if (stage.kind === "select") {
      if (seenSelect || phase === "tail") {
        throw new ParseError("Invalid pipeline: select placement", stage.span, "invalid-pipeline");
      }
      seenSelect = true;
      phase = "select";
      continue;
    }
    if (stage.kind === "take") {
      if (seenTake || seenCount || phase === "tail") {
        throw new ParseError("Invalid pipeline: take placement", stage.span, "invalid-pipeline");
      }
      seenTake = true;
      phase = "tail";
      continue;
    }
    if (stage.kind === "count") {
      if (seenCount || seenTake || phase === "tail") {
        throw new ParseError(
          "Invalid pipeline: count must be terminal and exclusive of take",
          stage.span,
          "invalid-pipeline",
        );
      }
      seenCount = true;
      phase = "tail";
    }
  }
}

export function parseDql(source: string): DqlQuery {
  try {
    const tokens = tokenize(source);
    return new Parser(tokens, source).parse();
  } catch (err) {
    if (err instanceof TokenizeError) {
      throw new ParseError(err.message, err.span, "parse-error");
    }
    throw err;
  }
}
