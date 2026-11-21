import {
  computeCanonicalHash,
  isMoneyValue,
  isUnknown,
  moneyAdd,
  moneyCompare,
  moneyMax,
  moneyMin,
  moneyMul,
  moneySub,
  pickText,
  type AuthorityLevel,
  type ConflictItem,
  type DialecticalPoleMatch,
  type DialecticalTraceDetail,
  type EscalationItem,
  type EvaluationContext,
  type EvaluationResult,
  type Expr,
  type LcfDocument,
  type MoneyValue,
  type Rule,
  type SubsumtionTraceDetail,
  type TraceEntry,
  type UnknownValue,
} from "../../core/src/index.ts";
import {
  computeOrTerminationEndDate,
  computeZpoDeadline,
  daysBetween,
} from "../../calendars/src/index.ts";

const UNKNOWN: UnknownValue = { $state: "unknown" };

const EU_MEMBER_STATES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
]);

const EEA_EFTA_STATES = new Set(["NO", "IS", "LI"]);

const AUTHORITY_LEVEL_RANK: Record<AuthorityLevel, number> = {
  supranational: 90,
  constitutional: 80,
  federal_statute: 70,
  federal_ordinance: 60,
  cantonal_statute: 50,
  municipal: 40,
  judicial_precedent: 35,
  admin_directive: 30,
  contractual: 20,
};

/**
 * Checks whether an evaluation jurisdiction (e.g. "CH-ZH", "DE-BY", "NO", "UK-SCT")
 * falls within a rule's declared jurisdiction scope (e.g. "CH", "EU", "EEA", "UK").
 */
export function jurisdictionMatches(evalJur: string, ruleScopeJur: string): boolean {
  const e = evalJur.toUpperCase();
  const s = ruleScopeJur.toUpperCase();
  if (e === s) return true;
  if (e.startsWith(`${s}-`)) return true;
  const country = e.split("-")[0] ?? e;
  if (s === "EU" && EU_MEMBER_STATES.has(country)) return true;
  if (s === "EEA" && (EU_MEMBER_STATES.has(country) || EEA_EFTA_STATES.has(country) || e === "EU")) return true;
  if (s === "ECHR" && (country === "CH" || country === "UK" || EU_MEMBER_STATES.has(country) || EEA_EFTA_STATES.has(country))) {
    return true;
  }
  return false;
}

function jurisdictionSpecificity(evalJur: string, scopes?: string[]): number {
  if (!scopes || scopes.length === 0) return 0;
  let best = 0;
  const e = evalJur.toUpperCase();
  for (const raw of scopes) {
    const s = raw.toUpperCase();
    if (!jurisdictionMatches(e, s)) continue;
    if (s === e) best = Math.max(best, 100);
    else if (s.includes("-")) best = Math.max(best, 70);
    else if (s === "EU" || s === "EEA" || s === "ECHR") best = Math.max(best, 10);
    else best = Math.max(best, 50);
  }
  return best;
}

function isRuleTemporallyActive(rule: Rule, ctx: EvaluationContext): boolean {
  if (!rule.temporal) return true;
  const basis = rule.temporal.basis ?? "factDate";
  const date =
    basis === "decisionDate"
      ? ctx.decisionDate
      : basis === "lawVersion"
        ? ctx.lawVersion
        : ctx.factDate;
  if (rule.temporal.validFrom && date < rule.temporal.validFrom) return false;
  if (rule.temporal.validUntil && date >= rule.temporal.validUntil) return false;
  return true;
}

export function collectExprDependencies(expr: Expr | undefined, targets: Set<string>, inputs: Set<string>): void {
  if (!expr) return;
  switch (expr.op) {
    case "lit":
    case "context":
    case "money_zero":
      return;
    case "input":
      inputs.add(expr.name);
      return;
    case "ref":
      targets.add(expr.target);
      return;
    case "and":
    case "or":
    case "add":
    case "min":
    case "max":
    case "money_add":
    case "money_min":
    case "money_max":
      for (const a of expr.args) collectExprDependencies(a, targets, inputs);
      return;
    case "not":
    case "is_known":
      collectExprDependencies(expr.arg, targets, inputs);
      return;
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "sub":
    case "mul":
    case "money_sub":
      collectExprDependencies(expr.left, targets, inputs);
      collectExprDependencies(expr.right, targets, inputs);
      return;
    case "in":
      collectExprDependencies(expr.value, targets, inputs);
      collectExprDependencies(expr.list, targets, inputs);
      return;
    case "if":
      collectExprDependencies(expr.cond, targets, inputs);
      collectExprDependencies(expr.then, targets, inputs);
      collectExprDependencies(expr.else, targets, inputs);
      return;
    case "money_mul":
      collectExprDependencies(expr.money, targets, inputs);
      collectExprDependencies(expr.factor, targets, inputs);
      return;
    case "days_between":
      collectExprDependencies(expr.from, targets, inputs);
      collectExprDependencies(expr.to, targets, inputs);
      return;
    case "zpo_deadline":
      collectExprDependencies(expr.triggerDate, targets, inputs);
      collectExprDependencies(expr.deliveryMethod, targets, inputs);
      collectExprDependencies(expr.durationDays, targets, inputs);
      collectExprDependencies(expr.durationMonths, targets, inputs);
      collectExprDependencies(expr.suspensionApplies, targets, inputs);
      collectExprDependencies(expr.canton, targets, inputs);
      collectExprDependencies(expr.applyArt142Abs1bis, targets, inputs);
      return;
    case "or_termination_end_date":
      collectExprDependencies(expr.noticeReceivedDate, targets, inputs);
      collectExprDependencies(expr.noticeMonths, targets, inputs);
      collectExprDependencies(expr.inProbation, targets, inputs);
      collectExprDependencies(expr.probationDays, targets, inputs);
      collectExprDependencies(expr.incapacityDuringNoticeDays, targets, inputs);
      collectExprDependencies(expr.sperrfristCapDays, targets, inputs);
      collectExprDependencies(expr.extraParentalLeaveDays, targets, inputs);
      collectExprDependencies(expr.endOfMonthOnly, targets, inputs);
      return;
    case "record":
      for (const v of Object.values(expr.fields)) {
        collectExprDependencies(v, targets, inputs);
      }
      return;
  }
}

interface EvalEnv {
  doc: LcfDocument;
  inputs: Record<string, unknown>;
  resolved: Record<string, unknown>;
  context: EvaluationContext;
  missingInputs: Set<string>;
}

function resolveInputValue(name: string, env: EvalEnv): unknown {
  const raw = env.inputs[name];
  if (!isUnknown(raw)) return raw;
  const spec = env.doc.inputs[name];
  if (spec?.defaultValue !== undefined) return spec.defaultValue;
  env.missingInputs.add(name);
  if (env.context.mode === "adjudicate" && spec?.burdenOfProof) {
    if (spec.burdenOfProof.onUnknown === "resolve_false") return false;
    if (spec.burdenOfProof.onUnknown === "resolve_true") return true;
  }
  return UNKNOWN;
}

function compareValues(left: unknown, right: unknown): number {
  if (isMoneyValue(left) && isMoneyValue(right)) {
    return moneyCompare(left, right);
  }
  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  throw new Error(`Cannot order-compare ${typeof left} and ${typeof right}`);
}

export function evalExpr(expr: Expr, env: EvalEnv): unknown {
  switch (expr.op) {
    case "lit":
      return expr.value;
    case "input":
      return resolveInputValue(expr.name, env);
    case "ref": {
      const val = env.resolved[expr.target];
      return isUnknown(val) ? UNKNOWN : val;
    }
    case "context":
      return env.context[expr.field];
    case "is_known": {
      const v = evalExpr(expr.arg, env);
      return !isUnknown(v);
    }
    case "not": {
      const v = evalExpr(expr.arg, env);
      if (isUnknown(v)) return UNKNOWN;
      return !Boolean(v);
    }
    case "and": {
      let sawUnknown = false;
      for (const arg of expr.args) {
        const v = evalExpr(arg, env);
        if (v === false) return false;
        if (isUnknown(v)) sawUnknown = true;
      }
      return sawUnknown ? UNKNOWN : true;
    }
    case "or": {
      let sawUnknown = false;
      for (const arg of expr.args) {
        const v = evalExpr(arg, env);
        if (v === true) return true;
        if (isUnknown(v)) sawUnknown = true;
      }
      return sawUnknown ? UNKNOWN : false;
    }
    case "eq": {
      const l = evalExpr(expr.left, env);
      const r = evalExpr(expr.right, env);
      if (isUnknown(l) || isUnknown(r)) return UNKNOWN;
      if (isMoneyValue(l) && isMoneyValue(r)) return moneyCompare(l, r) === 0;
      return l === r;
    }
    case "neq": {
      const l = evalExpr(expr.left, env);
      const r = evalExpr(expr.right, env);
      if (isUnknown(l) || isUnknown(r)) return UNKNOWN;
      if (isMoneyValue(l) && isMoneyValue(r)) return moneyCompare(l, r) !== 0;
      return l !== r;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const l = evalExpr(expr.left, env);
      const r = evalExpr(expr.right, env);
      if (isUnknown(l) || isUnknown(r)) return UNKNOWN;
      const cmp = compareValues(l, r);
      if (expr.op === "gt") return cmp > 0;
      if (expr.op === "gte") return cmp >= 0;
      if (expr.op === "lt") return cmp < 0;
      return cmp <= 0;
    }
    case "in": {
      const val = evalExpr(expr.value, env);
      const list = evalExpr(expr.list, env);
      if (isUnknown(val) || isUnknown(list) || !Array.isArray(list)) return UNKNOWN;
      return list.includes(val);
    }
    case "if": {
      const c = evalExpr(expr.cond, env);
      if (isUnknown(c)) return UNKNOWN;
      return c ? evalExpr(expr.then, env) : evalExpr(expr.else, env);
    }
    case "add": {
      let sum = 0;
      for (const a of expr.args) {
        const v = evalExpr(a, env);
        if (isUnknown(v)) return UNKNOWN;
        sum += Number(v);
      }
      return sum;
    }
    case "sub": {
      const l = evalExpr(expr.left, env);
      const r = evalExpr(expr.right, env);
      if (isUnknown(l) || isUnknown(r)) return UNKNOWN;
      return Number(l) - Number(r);
    }
    case "mul": {
      const l = evalExpr(expr.left, env);
      const r = evalExpr(expr.right, env);
      if (isUnknown(l) || isUnknown(r)) return UNKNOWN;
      return Number(l) * Number(r);
    }
    case "min": {
      const vals: number[] = [];
      for (const a of expr.args) {
        const v = evalExpr(a, env);
        if (isUnknown(v)) return UNKNOWN;
        vals.push(Number(v));
      }
      return Math.min(...vals);
    }
    case "max": {
      const vals: number[] = [];
      for (const a of expr.args) {
        const v = evalExpr(a, env);
        if (isUnknown(v)) return UNKNOWN;
        vals.push(Number(v));
      }
      return Math.max(...vals);
    }
    case "money_zero":
      return { amount: "0.00", currency: expr.currency } satisfies MoneyValue;
    case "money_mul": {
      const m = evalExpr(expr.money, env);
      const f = evalExpr(expr.factor, env);
      if (isUnknown(m) || isUnknown(f) || !isMoneyValue(m)) return UNKNOWN;
      return moneyMul(m, String(f));
    }
    case "money_add": {
      const vals: MoneyValue[] = [];
      for (const a of expr.args) {
        const v = evalExpr(a, env);
        if (isUnknown(v) || !isMoneyValue(v)) return UNKNOWN;
        vals.push(v);
      }
      return moneyAdd(vals);
    }
    case "money_sub": {
      const l = evalExpr(expr.left, env);
      const r = evalExpr(expr.right, env);
      if (isUnknown(l) || isUnknown(r) || !isMoneyValue(l) || !isMoneyValue(r)) return UNKNOWN;
      return moneySub(l, r);
    }
    case "money_min": {
      const vals: MoneyValue[] = [];
      for (const a of expr.args) {
        const v = evalExpr(a, env);
        if (isUnknown(v) || !isMoneyValue(v)) return UNKNOWN;
        vals.push(v);
      }
      return moneyMin(vals);
    }
    case "money_max": {
      const vals: MoneyValue[] = [];
      for (const a of expr.args) {
        const v = evalExpr(a, env);
        if (isUnknown(v) || !isMoneyValue(v)) return UNKNOWN;
        vals.push(v);
      }
      return moneyMax(vals);
    }
    case "days_between": {
      const f = evalExpr(expr.from, env);
      const t = evalExpr(expr.to, env);
      if (isUnknown(f) || isUnknown(t)) return UNKNOWN;
      return daysBetween(String(f), String(t));
    }
    case "zpo_deadline": {
      const triggerDate = evalExpr(expr.triggerDate, env);
      const deliveryMethod = evalExpr(expr.deliveryMethod, env);
      const durationDays = expr.durationDays ? evalExpr(expr.durationDays, env) : undefined;
      const durationMonths = expr.durationMonths ? evalExpr(expr.durationMonths, env) : undefined;
      const suspensionApplies = evalExpr(expr.suspensionApplies, env);
      const canton = evalExpr(expr.canton, env);
      const applyArt142Abs1bis = evalExpr(expr.applyArt142Abs1bis, env);
      if (
        isUnknown(triggerDate) ||
        isUnknown(deliveryMethod) ||
        isUnknown(suspensionApplies) ||
        isUnknown(canton) ||
        isUnknown(applyArt142Abs1bis) ||
        (isUnknown(durationDays) && isUnknown(durationMonths))
      ) {
        return UNKNOWN;
      }
      return computeZpoDeadline({
        triggerDate: String(triggerDate),
        deliveryMethod: String(deliveryMethod) as "registered_mail" | "ordinary_mail" | "electronic" | "court_pronouncement",
        durationDays: isUnknown(durationDays) ? undefined : Number(durationDays),
        durationMonths: isUnknown(durationMonths) ? undefined : Number(durationMonths),
        suspensionApplies: Boolean(suspensionApplies),
        canton: String(canton),
        applyArt142Abs1bis: Boolean(applyArt142Abs1bis),
      });
    }
    case "or_termination_end_date": {
      const noticeReceivedDate = evalExpr(expr.noticeReceivedDate, env);
      const noticeMonths = evalExpr(expr.noticeMonths, env);
      const inProbation = evalExpr(expr.inProbation, env);
      if (isUnknown(noticeReceivedDate) || isUnknown(inProbation) || (!inProbation && isUnknown(noticeMonths))) {
        return UNKNOWN;
      }
      const probationDays = expr.probationDays ? evalExpr(expr.probationDays, env) : 7;
      const incapacityDuringNoticeDays = expr.incapacityDuringNoticeDays
        ? evalExpr(expr.incapacityDuringNoticeDays, env)
        : 0;
      const sperrfristCapDays = expr.sperrfristCapDays ? evalExpr(expr.sperrfristCapDays, env) : undefined;
      const extraParentalLeaveDays = expr.extraParentalLeaveDays
        ? evalExpr(expr.extraParentalLeaveDays, env)
        : 0;
      const endOfMonthOnly = expr.endOfMonthOnly ? evalExpr(expr.endOfMonthOnly, env) : true;
      return computeOrTerminationEndDate({
        noticeReceivedDate: String(noticeReceivedDate),
        noticeMonths: isUnknown(noticeMonths) ? 0 : Number(noticeMonths),
        inProbation: Boolean(inProbation),
        probationDays: isUnknown(probationDays) ? 7 : Number(probationDays),
        incapacityDuringNoticeDays: isUnknown(incapacityDuringNoticeDays) ? 0 : Number(incapacityDuringNoticeDays),
        sperrfristCapDays: isUnknown(sperrfristCapDays) ? undefined : Number(sperrfristCapDays),
        extraParentalLeaveDays: isUnknown(extraParentalLeaveDays) ? 0 : Number(extraParentalLeaveDays),
        endOfMonthOnly: isUnknown(endOfMonthOnly) ? true : Boolean(endOfMonthOnly),
      });
    }
    case "record": {
      const out: Record<string, unknown> = {};
      for (const [k, vExpr] of Object.entries(expr.fields)) {
        out[k] = evalExpr(vExpr, env);
      }
      return out;
    }
  }
}

function resolveDefaultContext(doc: LcfDocument, partial?: Partial<EvaluationContext>): EvaluationContext {
  const defaultLens =
    doc.lenses?.find((l) => l.default)?.id ?? doc.lenses?.[0]?.id ?? "default";
  const today = new Date().toISOString().slice(0, 10);
  const factDate = partial?.factDate ?? today;
  const decisionDate = partial?.decisionDate ?? factDate;
  const lawVersion = partial?.lawVersion ?? decisionDate;
  return {
    jurisdiction: partial?.jurisdiction ?? doc.metadata.jurisdictions[0] ?? "CH",
    language: partial?.language ?? doc.metadata.languages[0] ?? "de",
    factDate,
    decisionDate,
    lawVersion,
    lens: partial?.lens ?? defaultLens,
    mode: partial?.mode ?? "adjudicate",
  };
}

/**
 * Topologically orders target variables based on `ref` dependencies so every rule
 * reads already-resolved upstream targets.
 */
function orderTargets(rules: Rule[]): string[] {
  const targetRules = new Map<string, Rule[]>();
  const deps = new Map<string, Set<string>>();

  for (const r of rules) {
    if (!targetRules.has(r.target)) targetRules.set(r.target, []);
    targetRules.get(r.target)!.push(r);
    if (!deps.has(r.target)) deps.set(r.target, new Set());
    const tDeps = new Set<string>();
    const iDeps = new Set<string>();
    collectExprDependencies(r.when, tDeps, iDeps);
    collectExprDependencies(r.compute, tDeps, iDeps);
    if (r.subsumtion) {
      for (const d of r.subsumtion.disqualifiers ?? []) collectExprDependencies(d.when, tDeps, iDeps);
      for (const f of r.subsumtion.factors) collectExprDependencies(f.when, tDeps, iDeps);
    }
    if (r.dialectical) {
      for (const d of r.dialectical.disqualifiers ?? []) collectExprDependencies(d.when, tDeps, iDeps);
      for (const p of r.dialectical.poles) collectExprDependencies(p.when, tDeps, iDeps);
    }
    for (const d of tDeps) {
      if (d !== r.target) deps.get(r.target)!.add(d);
    }
  }

  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (t: string) => {
    if (visited.has(t) || visiting.has(t)) return;
    visiting.add(t);
    for (const d of deps.get(t) ?? []) {
      if (targetRules.has(d)) visit(d);
    }
    visiting.delete(t);
    visited.add(t);
    ordered.push(t);
  };

  for (const t of targetRules.keys()) visit(t);
  return ordered;
}

function rulePrecedenceScore(rule: Rule, ctx: EvaluationContext): number {
  const lensBonus = rule.scope?.lenses?.includes(ctx.lens) ? 100_000 : 0;
  const prioBonus = (rule.priority ?? 0) * 1_000;
  const jurBonus = jurisdictionSpecificity(ctx.jurisdiction, rule.scope?.jurisdictions) * 10;
  const levelBonus = rule.scope?.authorityLevel ? AUTHORITY_LEVEL_RANK[rule.scope.authorityLevel] : 0;
  return lensBonus + prioBonus + jurBonus + levelBonus;
}

function evaluateSubsumtion(rule: Rule, env: EvalEnv): { value: unknown; detail: SubsumtionTraceDetail; escalate: boolean } {
  const contract = rule.subsumtion!;
  const lang = env.context.language;
  const concept = pickText(contract.legalConcept, lang);

  // 1. Check hard statutory / leading-case disqualifiers first
  for (const dq of contract.disqualifiers ?? []) {
    const res = evalExpr(dq.when, env);
    if (res === true) {
      const detail: SubsumtionTraceDetail = {
        legalConcept: concept,
        disqualifiedBy: {
          id: dq.id,
          label: pickText(dq.label, lang),
          authorityRef: dq.authorityRef,
        },
        score: -999,
        escalationBand: contract.escalationBand,
        verdict: "not_fulfilled",
        triggeredFactors: [],
      };
      return { value: false, detail, escalate: false };
    }
  }

  // 2. Score structured precedent-anchored balancing criteria
  let score = 0;
  const triggered: SubsumtionTraceDetail["triggeredFactors"] = [];
  for (const f of contract.factors) {
    const matched = evalExpr(f.when, env);
    if (matched === true) {
      const signedWeight = f.direction === "pro" ? f.weight : -f.weight;
      score += signedWeight;
      triggered.push({
        id: f.id,
        label: pickText(f.label, lang),
        direction: f.direction,
        weight: signedWeight,
        authorityRef: f.authorityRef,
        evidenceValue: f.evidenceInput ? env.inputs[f.evidenceInput] : undefined,
      });
    }
  }

  const { low, high } = contract.escalationBand;
  if (score >= high) {
    return {
      value: true,
      detail: {
        legalConcept: concept,
        score,
        escalationBand: contract.escalationBand,
        verdict: "fulfilled",
        triggeredFactors: triggered,
      },
      escalate: false,
    };
  }
  if (score <= low) {
    return {
      value: false,
      detail: {
        legalConcept: concept,
        score,
        escalationBand: contract.escalationBand,
        verdict: "not_fulfilled",
        triggeredFactors: triggered,
      },
      escalate: false,
    };
  }

  // Inside borderline escalation band -> mandatory human-jurist escalation!
  return {
    value: { $state: "escalate_human", score, band: contract.escalationBand },
    detail: {
      legalConcept: concept,
      score,
      escalationBand: contract.escalationBand,
      verdict: "escalate_human",
      triggeredFactors: triggered,
    },
    escalate: true,
  };
}

function evaluateDialectical(
  rule: Rule,
  env: EvalEnv,
): { value: unknown; detail: DialecticalTraceDetail; escalate: boolean } {
  const contract = rule.dialectical!;
  const lang = env.context.language;
  const concept = pickText(contract.legalConcept, lang);
  const teleology = contract.teleology
    ? {
        summary: pickText(contract.teleology.summary, lang),
        authorityRef: contract.teleology.authorityRef,
      }
    : undefined;

  // 1. Check hard statutory / binding disqualifiers first (Layer 1 cutoff)
  for (const dq of contract.disqualifiers ?? []) {
    if (evalExpr(dq.when, env) === true) {
      return {
        value: false,
        escalate: false,
        detail: {
          legalConcept: concept,
          teleology,
          disqualifiedBy: {
            id: dq.id,
            label: pickText(dq.label, lang),
            authorityRef: dq.authorityRef,
          },
          verdict: "clear_negative",
          matchedAffirmingPoles: [],
          matchedDenyingPoles: [],
          distinguishingQuestions: [],
        },
      };
    }
  }

  // 2. Match concrete decided Fallgruppen poles on BOTH sides (no arbitrary numeric scoring)
  const matchedAffirmingPoles: DialecticalPoleMatch[] = [];
  const matchedDenyingPoles: DialecticalPoleMatch[] = [];

  for (const pole of contract.poles) {
    if (evalExpr(pole.when, env) === true) {
      const m: DialecticalPoleMatch = {
        id: pole.id,
        polarity: pole.polarity,
        label: pickText(pole.label, lang),
        holdingSummary: pickText(pole.holdingSummary, lang),
        distinguishingQuestion: pickText(pole.distinguishingQuestion, lang),
        authorityRef: pole.authorityRef,
        evidenceValue: pole.evidenceInput ? env.inputs[pole.evidenceInput] : undefined,
      };
      if (pole.polarity === "affirming") matchedAffirmingPoles.push(m);
      else matchedDenyingPoles.push(m);
    }
  }

  const distinguishingQuestions = [
    ...matchedAffirmingPoles.map((p) => p.distinguishingQuestion),
    ...matchedDenyingPoles.map((p) => p.distinguishingQuestion),
  ];

  // 3. Pure dialectical resolution:
  // - Only affirming poles match -> clear_affirmative
  // - Only denying poles match -> clear_negative
  // - Both sides match -> dialectical_tension_escalate (steelman both poles for human counsel)
  // - Neither side matches -> novel_case_escalate (outside established Fallgruppen)
  if (matchedAffirmingPoles.length > 0 && matchedDenyingPoles.length === 0) {
    return {
      value: true,
      escalate: false,
      detail: {
        legalConcept: concept,
        teleology,
        verdict: "clear_affirmative",
        matchedAffirmingPoles,
        matchedDenyingPoles,
        distinguishingQuestions,
      },
    };
  }

  if (matchedDenyingPoles.length > 0 && matchedAffirmingPoles.length === 0) {
    return {
      value: false,
      escalate: false,
      detail: {
        legalConcept: concept,
        teleology,
        verdict: "clear_negative",
        matchedAffirmingPoles,
        matchedDenyingPoles,
        distinguishingQuestions,
      },
    };
  }

  const verdict =
    matchedAffirmingPoles.length > 0 && matchedDenyingPoles.length > 0
      ? "dialectical_tension_escalate"
      : "novel_case_escalate";

  return {
    value: {
      $state: "escalate_human",
      verdict,
      affirmingPoles: matchedAffirmingPoles.map((p) => p.id),
      denyingPoles: matchedDenyingPoles.map((p) => p.id),
    },
    escalate: true,
    detail: {
      legalConcept: concept,
      teleology,
      verdict,
      matchedAffirmingPoles,
      matchedDenyingPoles,
      distinguishingQuestions:
        distinguishingQuestions.length > 0
          ? distinguishingQuestions
          : contract.poles.map((p) => pickText(p.distinguishingQuestion, lang)),
    },
  };
}

export function evaluateDocument(
  doc: LcfDocument,
  inputs: Record<string, unknown>,
  partialContext?: Partial<EvaluationContext>,
): EvaluationResult {
  const ctx = resolveDefaultContext(doc, partialContext);
  const resolved: Record<string, unknown> = {};
  const trace: TraceEntry[] = [];
  const escalations: EscalationItem[] = [];
  const conflicts: ConflictItem[] = [];
  const citationsUsed = new Set<string>();

  const targets = orderTargets(doc.rules);

  for (const target of targets) {
    const candidateRules = doc.rules.filter((r) => r.target === target);
    const activeFired: Array<{
      rule: Rule;
      value: unknown;
      traceIndex: number;
      subsumtionDetail?: SubsumtionTraceDetail;
      dialecticalDetail?: DialecticalTraceDetail;
      escalate?: boolean;
    }> = [];

    for (const rule of candidateRules) {
      const label = pickText(rule.label, ctx.language, rule.id);
      const explanation = pickText(rule.explanation, ctx.language);

      // 1. Temporal check
      if (!isRuleTemporallyActive(rule, ctx)) {
        trace.push({
          ruleId: rule.id,
          target,
          kind: rule.kind,
          label,
          status: "inactive_temporal",
          authorities: rule.authorities,
          explanation: pickText(rule.temporal?.transitionalNote, ctx.language) || explanation,
        });
        continue;
      }

      // 2. Jurisdiction check
      if (
        rule.scope?.jurisdictions &&
        rule.scope.jurisdictions.length > 0 &&
        !rule.scope.jurisdictions.some((j) => jurisdictionMatches(ctx.jurisdiction, j))
      ) {
        trace.push({
          ruleId: rule.id,
          target,
          kind: rule.kind,
          label,
          status: "inactive_jurisdiction",
          authorities: rule.authorities,
        });
        continue;
      }

      // 3. Lens check
      if (
        rule.scope?.lenses &&
        rule.scope.lenses.length > 0 &&
        !rule.scope.lenses.includes(ctx.lens)
      ) {
        trace.push({
          ruleId: rule.id,
          target,
          kind: rule.kind,
          label,
          status: "inactive_lens",
          authorities: rule.authorities,
        });
        continue;
      }

      // 4. Evaluate precondition (`when`)
      const missingInputs = new Set<string>();
      const env: EvalEnv = { doc, inputs, resolved, context: ctx, missingInputs };

      let condVal: unknown = true;
      if (rule.when) {
        condVal = evalExpr(rule.when, env);
      }

      if (condVal === false) {
        trace.push({
          ruleId: rule.id,
          target,
          kind: rule.kind,
          label,
          status: "condition_false",
          authorities: rule.authorities,
          explanation,
        });
        continue;
      }

      if (isUnknown(condVal)) {
        // Burden of proof resolution under adjudicate mode!
        if (ctx.mode === "adjudicate" && rule.burdenOfProof) {
          if (rule.burdenOfProof.onUnknown === "resolve_false") {
            for (const a of rule.authorities) citationsUsed.add(a);
            trace.push({
              ruleId: rule.id,
              target,
              kind: rule.kind,
              label,
              status: "resolved_by_burden_of_proof",
              value: false,
              authorities: rule.authorities,
              missingInputs: Array.from(missingInputs),
              explanation,
              burdenResolution: {
                party: rule.burdenOfProof.party,
                factRole: rule.burdenOfProof.factRole,
                legalBasis: rule.burdenOfProof.legalBasis,
                resolvedTo: false,
              },
            });
            continue;
          }
          if (rule.burdenOfProof.onUnknown === "escalate_human") {
            for (const a of rule.authorities) citationsUsed.add(a);
            escalations.push({
              ruleId: rule.id,
              target,
              reason: `Unproven fact requires judicial assessment (${rule.burdenOfProof.party})`,
              authorities: rule.authorities,
            });
            trace.push({
              ruleId: rule.id,
              target,
              kind: rule.kind,
              label,
              status: "escalate_human",
              authorities: rule.authorities,
              missingInputs: Array.from(missingInputs),
              explanation,
            });
            continue;
          }
        }
        trace.push({
          ruleId: rule.id,
          target,
          kind: rule.kind,
          label,
          status: "condition_unknown",
          authorities: rule.authorities,
          missingInputs: Array.from(missingInputs),
          explanation,
        });
        continue;
      }

      // 5. Evaluate rule consequence (`dialectical`, `subsumtion`, or `compute`)
      let value: unknown = true;
      let subsumtionDetail: SubsumtionTraceDetail | undefined;
      let dialecticalDetail: DialecticalTraceDetail | undefined;
      let escalate = false;

      if (rule.kind === "dialectical" && rule.dialectical) {
        const diaRes = evaluateDialectical(rule, env);
        value = diaRes.value;
        dialecticalDetail = diaRes.detail;
        escalate = diaRes.escalate;
      } else if (rule.kind === "subsumtion" && rule.subsumtion) {
        const subRes = evaluateSubsumtion(rule, env);
        value = subRes.value;
        subsumtionDetail = subRes.detail;
        escalate = subRes.escalate;
      } else if (rule.compute) {
        value = evalExpr(rule.compute, env);
      }

      if (isUnknown(value)) {
        trace.push({
          ruleId: rule.id,
          target,
          kind: rule.kind,
          label,
          status: "condition_unknown",
          authorities: rule.authorities,
          missingInputs: Array.from(missingInputs),
          explanation,
        });
        continue;
      }

      const traceIndex = trace.length;
      trace.push({
        ruleId: rule.id,
        target,
        kind: rule.kind,
        label,
        status: escalate ? "escalate_human" : "applied",
        value,
        authorities: rule.authorities,
        explanation,
        subsumtionDetail,
        dialecticalDetail,
      });

      activeFired.push({ rule, value, traceIndex, subsumtionDetail, dialecticalDetail, escalate });
    }

    if (activeFired.length === 0) {
      // If any rule on this target resolved by burden of proof to false, keep resolved false if boolean default
      const bopEntry = trace.find(
        (t) => t.target === target && t.status === "resolved_by_burden_of_proof",
      );
      if (bopEntry) {
        resolved[target] = bopEntry.value;
      } else {
        resolved[target] = UNKNOWN;
      }
      continue;
    }

    // 6. Apply explicit defeasibility defeat graph (`overrides[]`)
    const defeatedMap = new Map<string, string>(); // defeatedRuleId -> defeatingRuleId
    for (const fired of activeFired) {
      for (const overriddenId of fired.rule.overrides ?? []) {
        defeatedMap.set(overriddenId, fired.rule.id);
      }
    }

    const undefeated = activeFired.filter((f) => {
      const winner = defeatedMap.get(f.rule.id);
      if (winner) {
        const entry = trace[f.traceIndex]!;
        entry.status = "defeated";
        entry.defeatedBy = winner;
        return false;
      }
      return true;
    });

    // 7. Precedence resolution among remaining undefeated rules
    undefeated.sort((a, b) => rulePrecedenceScore(b.rule, ctx) - rulePrecedenceScore(a.rule, ctx));
    const top = undefeated[0]!;
    const topScore = rulePrecedenceScore(top.rule, ctx);
    const tied = undefeated.filter((u) => rulePrecedenceScore(u.rule, ctx) === topScore);

    // Check if tied rules disagree on value
    const distinctValues = new Set(tied.map((t) => JSON.stringify(t.value)));
    if (tied.length > 1 && distinctValues.size > 1) {
      for (const t of tied) {
        trace[t.traceIndex]!.status = "conflict";
        for (const a of t.rule.authorities) citationsUsed.add(a);
      }
      conflicts.push({
        target,
        ruleIds: tied.map((t) => t.rule.id),
        values: tied.map((t) => t.value),
        authorities: Array.from(new Set(tied.flatMap((t) => t.rule.authorities))),
      });
      resolved[target] = { $state: "conflict", ruleIds: tied.map((t) => t.rule.id) };
      continue;
    }

    // Mark lower-precedence non-explicitly-overridden rules as defeated by precedence
    for (let i = 1; i < undefeated.length; i++) {
      const loser = undefeated[i]!;
      trace[loser.traceIndex]!.status = "defeated";
      trace[loser.traceIndex]!.defeatedBy = top.rule.id;
    }

    for (const a of top.rule.authorities) citationsUsed.add(a);
    if (top.subsumtionDetail) {
      if (top.subsumtionDetail.disqualifiedBy) {
        citationsUsed.add(top.subsumtionDetail.disqualifiedBy.authorityRef);
      }
      for (const f of top.subsumtionDetail.triggeredFactors) {
        citationsUsed.add(f.authorityRef);
      }
    }
    if (top.dialecticalDetail) {
      if (top.dialecticalDetail.teleology) citationsUsed.add(top.dialecticalDetail.teleology.authorityRef);
      if (top.dialecticalDetail.disqualifiedBy) citationsUsed.add(top.dialecticalDetail.disqualifiedBy.authorityRef);
      for (const p of top.dialecticalDetail.matchedAffirmingPoles) citationsUsed.add(p.authorityRef);
      for (const p of top.dialecticalDetail.matchedDenyingPoles) citationsUsed.add(p.authorityRef);
    }
    if (top.escalate) {
      escalations.push({
        ruleId: top.rule.id,
        target,
        reason:
          pickText(top.rule.dialectical?.requiresHumanReviewLabel, ctx.language) ||
          pickText(top.rule.subsumtion?.requiresHumanReviewLabel, ctx.language) ||
          `Borderline legal assessment (${top.dialecticalDetail?.legalConcept ?? top.subsumtionDetail?.legalConcept}) requires human jurist review.`,
        authorities: top.rule.authorities,
        subsumtionDetail: top.subsumtionDetail,
        dialecticalDetail: top.dialecticalDetail,
      });
    }

    resolved[target] = top.value;
  }

  const outputs: Record<string, unknown> = {};
  for (const out of doc.outputs) {
    outputs[out.id] = resolved[out.target] ?? UNKNOWN;
  }

  return {
    $format: "LCF-Result",
    $specVersion: doc.$specVersion,
    documentRef: {
      id: doc.metadata.id,
      slug: doc.metadata.slug,
      version: doc.metadata.version,
      canonicalHash: computeCanonicalHash(doc),
    },
    context: ctx,
    outputs,
    resolvedTargets: resolved,
    trace,
    escalations,
    conflicts,
    citationsUsed: Array.from(citationsUsed),
  };
}
