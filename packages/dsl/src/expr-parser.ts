import type { Expr } from "../../core/src/index.ts";

interface Token {
  kind: "ident" | "string" | "number" | "op" | "punct" | "eof";
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let str = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < src.length) {
          i += 1;
          str += src[i];
        } else {
          str += src[i];
        }
        i += 1;
      }
      if (i >= src.length) throw new Error("Unterminated string literal in .law expression");
      i += 1;
      tokens.push({ kind: "string", value: str });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", ">=", "<="].includes(two)) {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if ([">", "<", "+", "-", "*"].includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    if (["(", ")", "[", "]", ",", ":"].includes(ch)) {
      tokens.push({ kind: "punct", value: ch });
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let num = "";
      while (i < src.length && /[0-9.]/.test(src[i]!)) {
        num += src[i];
        i += 1;
      }
      tokens.push({ kind: "number", value: num });
      continue;
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let ident = "";
      while (i < src.length && /[a-zA-Z0-9_$.-]/.test(src[i]!)) {
        ident += src[i];
        i += 1;
      }
      tokens.push({ kind: "ident", value: ident });
      continue;
    }
    throw new Error(`Unexpected character "${ch}" in .law expression: ${src}`);
  }
  tokens.push({ kind: "eof", value: "" });
  return tokens;
}

/**
 * Recursive-descent parser for human-legible .law expressions into typed LCF Expr ASTs.
 * Supports: if/then/else, or, and, not, ==, !=, >=, <=, >, <, in [...], +, -, *,
 * ref(target), context(field), is_known(x), money("100.00", "CHF"), money_mul(m, f).
 */
export function parseLawExpr(src: string, knownTargets: Set<string>): Expr {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos]!;
  const consume = () => tokens[pos++]!;
  const expect = (kind: Token["kind"], val?: string) => {
    const t = consume();
    if (t.kind !== kind || (val !== undefined && t.value !== val)) {
      throw new Error(`Expected ${val ?? kind} but got "${t.value}" in expression: ${src}`);
    }
    return t;
  };

  const parseIf = (): Expr => {
    if (peek().kind === "ident" && peek().value === "if") {
      consume();
      const cond = parseOr();
      expect("ident", "then");
      const thenBranch = parseIf();
      expect("ident", "else");
      const elseBranch = parseIf();
      return { op: "if", cond, then: thenBranch, else: elseBranch };
    }
    return parseOr();
  };

  const parseOr = (): Expr => {
    const args: Expr[] = [parseAnd()];
    while (peek().kind === "ident" && peek().value === "or") {
      consume();
      args.push(parseAnd());
    }
    return args.length === 1 ? args[0]! : { op: "or", args };
  };

  const parseAnd = (): Expr => {
    const args: Expr[] = [parseNot()];
    while (peek().kind === "ident" && peek().value === "and") {
      consume();
      args.push(parseNot());
    }
    return args.length === 1 ? args[0]! : { op: "and", args };
  };

  const parseNot = (): Expr => {
    if (peek().kind === "ident" && peek().value === "not") {
      consume();
      return { op: "not", arg: parseNot() };
    }
    return parseComparison();
  };

  const parseComparison = (): Expr => {
    const left = parseAddSub();
    const p = peek();
    if (p.kind === "op" && ["==", "!=", ">=", "<=", ">", "<"].includes(p.value)) {
      consume();
      const right = parseAddSub();
      const map: Record<string, "eq" | "neq" | "gte" | "lte" | "gt" | "lt"> = {
        "==": "eq",
        "!=": "neq",
        ">=": "gte",
        "<=": "lte",
        ">": "gt",
        "<": "lt",
      };
      return { op: map[p.value]!, left, right };
    }
    if (p.kind === "ident" && p.value === "in") {
      consume();
      const list = parsePrimary();
      return { op: "in", value: left, list };
    }
    return left;
  };

  const parseAddSub = (): Expr => {
    let left = parseMul();
    while (peek().kind === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = consume().value;
      const right = parseMul();
      left = op === "+" ? { op: "add", args: [left, right] } : { op: "sub", left, right };
    }
    return left;
  };

  const parseMul = (): Expr => {
    let left = parsePrimary();
    while (peek().kind === "op" && peek().value === "*") {
      consume();
      const right = parsePrimary();
      left = { op: "mul", left, right };
    }
    return left;
  };

  const parseCallArgs = (): Expr[] => {
    expect("punct", "(");
    const args: Expr[] = [];
    if (!(peek().kind === "punct" && peek().value === ")")) {
      args.push(parseIf());
      while (peek().kind === "punct" && peek().value === ",") {
        consume();
        args.push(parseIf());
      }
    }
    expect("punct", ")");
    return args;
  };

  const parsePrimary = (): Expr => {
    const t = peek();
    if (t.kind === "punct" && t.value === "(") {
      consume();
      const inner = parseIf();
      expect("punct", ")");
      return inner;
    }
    if (t.kind === "punct" && t.value === "[") {
      consume();
      const items: unknown[] = [];
      if (!(peek().kind === "punct" && peek().value === "]")) {
        const readLit = () => {
          const tok = consume();
          if (tok.kind === "string") return tok.value;
          if (tok.kind === "number") return Number(tok.value);
          if (tok.kind === "ident" && tok.value === "true") return true;
          if (tok.kind === "ident" && tok.value === "false") return false;
          return tok.value;
        };
        items.push(readLit());
        while (peek().kind === "punct" && peek().value === ",") {
          consume();
          items.push(readLit());
        }
      }
      expect("punct", "]");
      return { op: "lit", value: items };
    }
    if (t.kind === "string") {
      consume();
      return { op: "lit", value: t.value };
    }
    if (t.kind === "number") {
      consume();
      return { op: "lit", value: Number(t.value) };
    }
    if (t.kind === "ident") {
      consume();
      if (t.value === "true") return { op: "lit", value: true };
      if (t.value === "false") return { op: "lit", value: false };
      if (peek().kind === "punct" && peek().value === "(") {
        const args = parseCallArgs();
        if (t.value === "is_known") return { op: "is_known", arg: args[0]! };
        if (t.value === "ref") {
          const arg = args[0]!;
          if (arg.op === "lit") return { op: "ref", target: String(arg.value) };
          if (arg.op === "input") return { op: "ref", target: arg.name };
          if (arg.op === "ref") return arg;
        }
        if (t.value === "context") {
          const arg = args[0]!;
          const field = arg.op === "lit" ? String(arg.value) : arg.op === "input" ? arg.name : "jurisdiction";
          return { op: "context", field: field as "jurisdiction" | "factDate" | "decisionDate" | "lawVersion" | "lens" };
        }
        if (t.value === "money_zero") {
          const c = args[0] && args[0].op === "lit" ? String(args[0].value) : "CHF";
          return { op: "money_zero", currency: c };
        }
        if (t.value === "money") {
          const amount = args[0] && args[0].op === "lit" ? String(args[0].value) : "0.00";
          const currency = args[1] && args[1].op === "lit" ? String(args[1].value) : "CHF";
          return { op: "lit", value: { amount, currency } };
        }
        if (t.value === "money_mul") return { op: "money_mul", money: args[0]!, factor: args[1]! };
        if (t.value === "money_add") return { op: "money_add", args };
        if (t.value === "min") return { op: "min", args };
        if (t.value === "max") return { op: "max", args };
        if (t.value === "days_between") return { op: "days_between", from: args[0]!, to: args[1]! };
        throw new Error(`Unknown function "${t.value}" in .law expression`);
      }
      if (t.value.startsWith("$")) {
        return { op: "ref", target: t.value.slice(1) };
      }
      if (knownTargets.has(t.value)) {
        return { op: "ref", target: t.value };
      }
      return { op: "input", name: t.value };
    }
    throw new Error(`Unexpected token "${t.value}" in .law expression: ${src}`);
  };

  const expr = parseIf();
  if (peek().kind !== "eof") {
    throw new Error(`Trailing token "${peek().value}" in .law expression: ${src}`);
  }
  return expr;
}

export function formatLawExpr(expr: Expr): string {
  switch (expr.op) {
    case "lit":
      return JSON.stringify(expr.value);
    case "input":
      return expr.name;
    case "ref":
      return `$${expr.target}`;
    case "context":
      return `context("${expr.field}")`;
    case "not":
      return `not (${formatLawExpr(expr.arg)})`;
    case "is_known":
      return `is_known(${formatLawExpr(expr.arg)})`;
    case "and":
      return `(${expr.args.map(formatLawExpr).join(" and ")})`;
    case "or":
      return `(${expr.args.map(formatLawExpr).join(" or ")})`;
    case "eq":
      return `${formatLawExpr(expr.left)} == ${formatLawExpr(expr.right)}`;
    case "neq":
      return `${formatLawExpr(expr.left)} != ${formatLawExpr(expr.right)}`;
    case "gt":
      return `${formatLawExpr(expr.left)} > ${formatLawExpr(expr.right)}`;
    case "gte":
      return `${formatLawExpr(expr.left)} >= ${formatLawExpr(expr.right)}`;
    case "lt":
      return `${formatLawExpr(expr.left)} < ${formatLawExpr(expr.right)}`;
    case "lte":
      return `${formatLawExpr(expr.left)} <= ${formatLawExpr(expr.right)}`;
    case "in":
      return `${formatLawExpr(expr.value)} in ${formatLawExpr(expr.list)}`;
    case "if":
      return `if ${formatLawExpr(expr.cond)} then ${formatLawExpr(expr.then)} else ${formatLawExpr(expr.else)}`;
    case "add":
      return `(${expr.args.map(formatLawExpr).join(" + ")})`;
    case "sub":
      return `(${formatLawExpr(expr.left)} - ${formatLawExpr(expr.right)})`;
    case "mul":
      return `(${formatLawExpr(expr.left)} * ${formatLawExpr(expr.right)})`;
    case "min":
      return `min(${expr.args.map(formatLawExpr).join(", ")})`;
    case "max":
      return `max(${expr.args.map(formatLawExpr).join(", ")})`;
    case "money_zero":
      return `money_zero("${expr.currency}")`;
    case "money_mul":
      return `money_mul(${formatLawExpr(expr.money)}, ${formatLawExpr(expr.factor)})`;
    case "money_add":
      return `money_add(${expr.args.map(formatLawExpr).join(", ")})`;
    case "money_sub":
      return `money_sub(${formatLawExpr(expr.left)}, ${formatLawExpr(expr.right)})`;
    case "money_min":
      return `money_min(${expr.args.map(formatLawExpr).join(", ")})`;
    case "money_max":
      return `money_max(${expr.args.map(formatLawExpr).join(", ")})`;
    case "days_between":
      return `days_between(${formatLawExpr(expr.from)}, ${formatLawExpr(expr.to)})`;
    case "zpo_deadline":
      return `zpo_deadline(...)`;
    case "or_termination_end_date":
      return `or_termination_end_date(...)`;
    case "record":
      return `{ ${Object.entries(expr.fields).map(([k, v]) => `${k}: ${formatLawExpr(v)}`).join(", ")} }`;
  }
}
