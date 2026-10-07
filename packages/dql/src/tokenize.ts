import type { Span } from "./ast.js";

export type TokenKind =
  | "ident"
  | "string"
  | "integer"
  | "decimal"
  | "param"
  | "pipe"
  | "comma"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "eof";

export interface Token {
  kind: TokenKind;
  value: string;
  span: Span;
}

const KEYWORDS = new Set([
  "where",
  "find",
  "select",
  "take",
  "count",
  "and",
  "or",
  "not",
  "in",
  "case",
  "sensitive",
  "insensitive",
  "is",
  "null",
  "missing",
  "empty",
  "true",
  "false",
  "contains",
  "date",
  "sort",
  "group",
  "by",
  "duplicates",
  "expect",
  "when",
]);

export function isKeyword(ident: string): boolean {
  return KEYWORDS.has(ident.toLowerCase());
}

export class TokenizeError extends Error {
  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
    this.name = "TokenizeError";
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const push = (kind: TokenKind, value: string, start: number, end: number) => {
    tokens.push({ kind, value, span: { start, end } });
  };

  while (i < source.length) {
    const ch = source[i]!;

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "|") {
      push("pipe", "|", i, i + 1);
      i += 1;
      continue;
    }
    if (ch === ",") {
      push("comma", ",", i, i + 1);
      i += 1;
      continue;
    }
    if (ch === "(") {
      push("lparen", "(", i, i + 1);
      i += 1;
      continue;
    }
    if (ch === ")") {
      push("rparen", ")", i, i + 1);
      i += 1;
      continue;
    }
    if (ch === "[") {
      push("lbracket", "[", i, i + 1);
      i += 1;
      continue;
    }
    if (ch === "]") {
      push("rbracket", "]", i, i + 1);
      i += 1;
      continue;
    }

    if (ch === "!" && source[i + 1] === "=") {
      push("neq", "!=", i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "<" && source[i + 1] === "=") {
      push("lte", "<=", i, i + 2);
      i += 2;
      continue;
    }
    if (ch === ">" && source[i + 1] === "=") {
      push("gte", ">=", i, i + 2);
      i += 2;
      continue;
    }
    if (ch === "=") {
      push("eq", "=", i, i + 1);
      i += 1;
      continue;
    }
    if (ch === "<") {
      push("lt", "<", i, i + 1);
      i += 1;
      continue;
    }
    if (ch === ">") {
      push("gt", ">", i, i + 1);
      i += 1;
      continue;
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      let value = "";
      while (i < source.length) {
        const c = source[i]!;
        if (c === '"') {
          i += 1;
          push("string", value, start, i);
          break;
        }
        if (c === "\\") {
          i += 1;
          const esc = source[i];
          if (esc === undefined) throw new TokenizeError("Unterminated escape", { start, end: i });
          const map: Record<string, string> = {
            "\\": "\\",
            '"': '"',
            n: "\n",
            r: "\r",
            t: "\t",
          };
          if (esc === "u") {
            const hex = source.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new TokenizeError("Invalid \\u escape", { start: i, end: i + 1 });
            }
            value += String.fromCharCode(parseInt(hex, 16));
            i += 5;
            continue;
          }
          if (!(esc in map)) {
            throw new TokenizeError(`Invalid escape \\${esc}`, { start: i - 1, end: i + 1 });
          }
          value += map[esc];
          i += 1;
          continue;
        }
        value += c;
        i += 1;
      }
      if (tokens[tokens.length - 1]?.kind !== "string" || tokens[tokens.length - 1]?.span.start !== start) {
        throw new TokenizeError("Unterminated string", { start, end: i });
      }
      continue;
    }

    if (ch === "`") {
      const start = i;
      i += 1;
      let value = "";
      while (i < source.length) {
        if (source[i] === "`" && source[i + 1] === "`") {
          value += "`";
          i += 2;
          continue;
        }
        if (source[i] === "`") {
          i += 1;
          push("ident", value, start, i);
          break;
        }
        value += source[i];
        i += 1;
      }
      if (tokens[tokens.length - 1]?.span.start !== start) {
        throw new TokenizeError("Unterminated identifier", { start, end: i });
      }
      continue;
    }

    if (ch === "$") {
      const start = i;
      i += 1;
      if (!/[A-Za-z_]/.test(source[i] ?? "")) {
        throw new TokenizeError("Invalid parameter name", { start, end: i });
      }
      let name = "";
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i]!)) {
        name += source[i];
        i += 1;
      }
      push("param", name, start, i);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(source[i + 1] ?? ""))) {
      const start = i;
      if (ch === "-") i += 1;
      while (i < source.length && /[0-9]/.test(source[i]!)) i += 1;
      let isDecimal = false;
      if (source[i] === ".") {
        isDecimal = true;
        i += 1;
        while (i < source.length && /[0-9]/.test(source[i]!)) i += 1;
      }
      if (source[i] === "e" || source[i] === "E") {
        isDecimal = true;
        i += 1;
        if (source[i] === "+" || source[i] === "-") i += 1;
        while (i < source.length && /[0-9]/.test(source[i]!)) i += 1;
      }
      push(isDecimal ? "decimal" : "integer", source.slice(start, i), start, i);
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i]!)) i += 1;
      const value = source.slice(start, i);
      push("ident", value, start, i);
      continue;
    }

    throw new TokenizeError(`Unexpected character '${ch}'`, { start: i, end: i + 1 });
  }

  push("eof", "", i, i);
  return tokens;
}
