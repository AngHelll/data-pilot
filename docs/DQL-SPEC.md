# DQL 0.1 Language Specification

**Status:** Closed for Phase 0 (spec before parser — D-004)  
**Version:** `0.1`  
**Parser:** not started until this document’s critical points remain stable  

This is the canonical grammar/semantics contract for Data Pilot Query Language 0.1. Phase 2 implements a parser with AST and source spans against this spec.

---

## 1. Scope

### In scope (v0.1)

| Area | Capability |
|---|---|
| Predicates | comparisons, `and` / `or` / `not`, `in`, `contains`, null/empty/missing tests |
| Search | `find` |
| Params | `$name` parameters |
| Projection | `select` |
| Limit | `take` |
| Aggregate | `count` |
| Literals | strings, numbers, booleans, `null` / `missing` where defined |
| Dates | `date(...)` when a column schema/type is known (optional sugar) |

### Deferred (v0.2+)

`sort`, grouping / aggregates beyond `count`, `duplicates`, `expect` / `when…expect`, joins, window functions, arbitrary SQL/JS.

Unsupported constructs MUST produce a clear `unsupported-operation` (or parse) diagnostic — never silent ignore.

---

## 2. Lexical rules

### 2.1 Comments

- Line comments: `//` to end of line  
- Block comments: not in 0.1  

### 2.2 Identifiers (columns)

- Unquoted: `[A-Za-z_][A-Za-z0-9_]*`  
- Escaped / quoted: backtick-wrapped, with ``` ` as an escaped backtick  

Examples: `balance`, `country`, `` `order id` ``, `` `weird``name` ``

**Case sensitivity (columns):** column name matching is **case-sensitive** against the dataset’s declared/header names. Engines MUST NOT fold `Country` to `country`. Diagnostics SHOULD suggest near-matches when confidence is high, without auto-running them.

### 2.3 Strings

- Double-quoted only: `"..."`.  
- Escapes inside strings: `\\`, `\"`, `\n`, `\r`, `\t`, `\uXXXX` (4 hex digits).  
- No single-quoted strings in 0.1 (use double quotes).  
- Adjacent string concatenation is not supported.

### 2.4 Numbers

- Integers: optional `-`, digits (no leading `+`).  
- Decimals: digits with `.` fraction; optional exponent `e`/`E`.  
- Parsed into tagged values (`integer` / `decimal` as **strings** in the value model) — never JS `Number` for storage of results.

### 2.5 Booleans & specials

- `true` / `false` (lowercase)  
- `null` — SQL-ish unknown/null cell  
- `missing` — field absent (JSONL) or unmapped column  

### 2.6 Parameters

- `$identifier` — bound at execution from a param map  
- Missing binding → diagnostic `unbound-parameter` (error); query does not run  

---

## 3. Pipeline shape

A query is a **pipeline** of stages separated by `|` (pipe), optionally starting with a from-less stream (dataset is bound by the session, not by DQL in 0.1).

```text
query        := stage ( '|' stage )*
stage        := findStage | whereStage | selectStage | takeStage | countStage
```

### Allowed pipelines (0.1)

| Pattern | Allowed |
|---|---|
| (empty / identity) | yes — means preview/default scan under budget |
| `find …` | yes — at most one; MUST be first stage if present |
| `where …` | yes — zero or more; after `find`, before `select`/`take`/`count` |
| `select …` | yes — at most one; before `take`/`count` |
| `take N` | yes — at most one; not after `count` |
| `count` | yes — terminal; incompatible with `take` / row-returning terminal |

**Illegal examples (must error):**

- `take 10 | where x > 1` — `take` not last among transforming stages when followed by filter  
- `count | select a` — `count` must be terminal  
- `find "a" | find "b"` — multiple `find`  
- `sort by a` — unsupported in 0.1  

Recommended stage order:

```text
[find] → [where]* → [select]? → (take | count)?
```

---

## 4. Stages

### 4.1 `find` (search)

```text
findStage := 'find' stringLiteral ( 'in' columnList )? ( 'case' caseMode )?
columnList := column ( ',' column )*
caseMode  := 'sensitive' | 'insensitive'
```

- Without `in`: search **all columns** (stringified cell text).  
- With `in`: search only listed columns.  
- Default case mode: **`insensitive`** for `find` only (Unicode simple case fold).  
- Column names in `in` follow §2.2 case-sensitive matching.  
- Match = substring contains (not regex in 0.1).  
- `null` / `missing` cells do not match.

### 4.2 `where` (predicates)

```text
whereStage := 'where' predicate
predicate  := orExpr
orExpr     := andExpr ( 'or' andExpr )*
andExpr    := notExpr ( 'and' notExpr )*
notExpr    := 'not' notExpr | primary
primary    := comparison | nullTest | emptyTest | missingTest
            | 'contains' '(' expr ',' stringLiteral ')'
            | 'in' '(' expr ',' '[' literalList ']' ')'
            | '(' predicate ')'
```

#### Comparisons

```text
comparison := expr comparator expr
comparator := '=' | '!=' | '<' | '<=' | '>' | '>='
```

#### Canonical null / missing tests (closed)

| Surface syntax | Meaning |
|---|---|
| `expr is null` | cell tagged `null` |
| `expr is not null` | cell is present and not `null` (still true for `missing`? — **no**, see below) |
| `expr is missing` | cell tagged `missing` |
| `expr is not missing` | not `missing` |
| `expr is empty` | string length 0 **or** `null` (not `missing`) |
| `expr is not empty` | string with length > 0 |

**Canonical form:** parsers/formatters SHOULD emit spaces as `is not null` / `is not missing` / `is not empty` (lowercase keywords). `IS NOT NULL` folded to lowercase at parse time.

**`is not null` vs missing:**  
- `is not null` → true only for concrete values (string/boolean/number/date).  
- `missing` ⇒ `is null` is **false**, `is missing` is **true**, `is not null` is **false**.  
- Three-valued logic applies to comparisons (§5).

### 4.3 `select`

```text
selectStage := 'select' column ( ',' column )*
```

- Projects named columns; unknown column → error diagnostic.  
- Order of columns in output = order in `select`.  
- Duplicate column names in `select` → error.

### 4.4 `take`

```text
takeStage := 'take' integerLiteral
```

- `N >= 0`. `take 0` returns no rows with `completion: complete` if the upstream finished within budget.  
- Does not change scan cost honesty — result may be complete while scan was prefix-limited only if the engine proves exhaustion.

### 4.5 `count`

```text
countStage := 'count'
```

- Returns a single integer (tagged) — total matching rows.  
- Exact `totalCount` only when `completion === "complete"`.  
- Cancelled/truncated counts MUST NOT be presented as exact.

---

## 5. Types, inference, and invalid conversions

### 5.1 Value model

Tagged values from `@data-pilot/contracts`: `null` | `missing` | `string` | `boolean` | `integer` | `decimal` | `date` | `datetime`.

### 5.2 Inferred column types

Inferences are **sample-based labels**, never silent coercions of stored raw text:

| Label | Rule of thumb |
|---|---|
| `boolean` | all non-null samples in `{true,false}` (case-insensitive tokens) |
| `integer` | all non-null samples match integer lexical form |
| `decimal` | numeric with fraction/exponent; integers may widen to decimal in mixed numeric samples |
| `date` / `datetime` | ISO-8601 subset when consistently parsed |
| `string` | default |
| `mixed` | conflicting successful parses |
| `unknown` | insufficient sample |

Raw cell text is retained by the engine for export/edit fidelity.

### 5.3 Comparison typing

- Same tagged kind → compare within kind (numeric by decimal math; strings by UTF-8 code unit order unless `find` case mode applies — comparisons are always case-sensitive).  
- `integer` vs `decimal` → promote integer to decimal for the comparison.  
- **Invalid conversions do not coerce:** comparing `string` to `integer`/`decimal`/`boolean`/`date` yields diagnostic `type-mismatch` at plan/type-check time when types are known; at runtime with `mixed`/`unknown`, the row predicate evaluates to **unknown** (three-valued), never a best-effort parse.  
- Explicit conversion functions are **out of scope for 0.1** (no `int()`, `decimal()`).

### 5.4 Three-valued logic

- Predicates evaluate to `true` | `false` | `unknown`.  
- `where` keeps rows where predicate is **true** only.  
- `unknown` arises from: any operand `null` or `missing` in a comparison/`contains`/`in`, or invalid runtime type pairing under `mixed`.  
- `and` / `or` / `not` follow SQL three-valued tables.

---

## 6. Null, missing, and empty — summary

| Cell | `is null` | `is missing` | `is empty` | compares equal to value |
|---|---|---|---|---|
| tagged null | T | F | T | unknown |
| tagged missing | F | T | F | unknown |
| `""` string | F | F | T | per string rules |
| other value | F | F | F | per kind |

CSV dialect tokens that map to null (e.g. `NULL`, `\N`) are **ingest policy** (open question for Ángel — settings vs sidecar), not DQL syntax. Once tagged, DQL sees `null` / `missing` / values only.

---

## 7. Parameters in predicates

```text
where country = $country and balance > $minBalance
```

- Types of params are checked against the comparison site when the binding is provided.  
- Unbound → error.  
- Params cannot introduce new stage keywords.

---

## 8. Examples (normative illustrations)

```dql
where country = "MX" and balance > 50000 | take 50
```

```dql
find "acme" in name, city case insensitive | where status is not null | select id, name | take 20
```

```dql
where amount is not null and currency in ["MXN", "USD"] | count
```

```dql
where `order id` = $oid | select `order id`, total
```

```dql
find "MX" | where balance > $min | take 10
```

---

## 9. Diagnostics (minimum codes)

| Code | When |
|---|---|
| `parse-error` | syntax |
| `unknown-column` | name not in schema/header |
| `unbound-parameter` | missing `$` binding |
| `type-mismatch` | known illegal comparison |
| `unsupported-operation` | v0.2+ feature used |
| `invalid-pipeline` | illegal stage order/combination |

Each diagnostic follows the shared `Diagnostic` contract (`code`, `severity`, `message`, optional `range`).

---

## 10. Conformance notes for implementers

1. No `eval`, no SQL passthrough, no arbitrary JS.  
2. Grammar must attach source spans for errors.  
3. Formatter SHOULD canonicalize `is not null` spacing/case.  
4. Saved queries store `dqlVersion: "0.1"` plus params and schema/parsing metadata.  
5. Semantic stability: same query + schema + revision ⇒ same results.

---

## 11. Open items (do not block 0.1 parser start after Phase 0)

These remain product questions; defaults above are sufficient to implement:

- CSV null-token list and persistence (settings vs sidecar) — plan §7 #11  
- Saved-query file location — plan §7 #15  
- `expect … unique` null/missing policy — v0.2 only  

**Phase 0 gate:** critical syntax/semantics in §§2–6 and pipeline rules in §3 are **closed**.
