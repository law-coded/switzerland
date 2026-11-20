import {
  isMoneyValue,
  isUnknown,
  pickText,
  type EvaluationContext,
  type InputSpec,
  type LcfDocument,
} from "../../core/src/index.ts";
import { addDays } from "../../calendars/src/index.ts";
import { evaluateDocument } from "./evaluator.ts";

export interface NextQuestionItem {
  inputName: string;
  label: string;
  type: InputSpec["type"];
  impactScore: number;
  outputsAffected: string[];
  probeValuesTested: unknown[];
}

export interface CounterfactualFinding {
  inputName: string;
  label: string;
  originalValue: unknown;
  counterfactualValue: unknown;
  deltaDescription: string;
  changedOutputs: Array<{
    outputId: string;
    from: unknown;
    to: unknown;
  }>;
}

function representativeProbes(spec: InputSpec): unknown[] {
  if (spec.type === "boolean") return [true, false];
  if (spec.type === "enum" && spec.enumValues) return spec.enumValues;
  if (spec.type === "integer" || spec.type === "decimal") {
    if (Array.isArray(spec.counterfactualStep)) return spec.counterfactualStep;
    return [0, 1, 5, 10, 30, 100];
  }
  if (spec.type === "money") {
    return [
      { amount: "0.00", currency: "CHF" },
      { amount: "5000.00", currency: "CHF" },
      { amount: "12000.00", currency: "CHF" },
    ];
  }
  if (spec.type === "date") {
    return ["2024-07-01", "2025-07-10", "2026-03-15"];
  }
  return ["sample_a", "sample_b"];
}

/**
 * Bidirectional Triage Solver:
 * Given partial inputs, computes the minimal set of currently unknown inputs that
 * can actually change at least one target output, ranked by how many outputs they decide.
 */
export function findMinimalNextQuestions(
  doc: LcfDocument,
  partialInputs: Record<string, unknown>,
  context?: Partial<EvaluationContext>,
): NextQuestionItem[] {
  const triageCtx: Partial<EvaluationContext> = { ...context, mode: "triage" };
  const lang = triageCtx.language ?? doc.metadata.languages[0] ?? "de";
  const base = evaluateDocument(doc, partialInputs, triageCtx);

  // Gather unknown inputs actively blocking trace nodes (plus any unsupplied inputs)
  const blocking = new Set<string>();
  for (const t of base.trace) {
    for (const m of t.missingInputs ?? []) blocking.add(m);
  }
  for (const name of Object.keys(doc.inputs)) {
    if (isUnknown(partialInputs[name]) && doc.inputs[name]?.defaultValue === undefined) {
      blocking.add(name);
    }
  }

  const questions: NextQuestionItem[] = [];

  for (const inputName of blocking) {
    const spec = doc.inputs[inputName];
    if (!spec) continue;
    const probes = representativeProbes(spec);
    const affected = new Set<string>();

    const seenByOutput = new Map<string, Set<string>>();
    for (const out of doc.outputs) seenByOutput.set(out.id, new Set());

    for (const probeVal of probes) {
      const res = evaluateDocument(doc, { ...partialInputs, [inputName]: probeVal }, triageCtx);
      for (const out of doc.outputs) {
        const val = res.outputs[out.id];
        seenByOutput.get(out.id)!.add(JSON.stringify(val));
        if (JSON.stringify(val) !== JSON.stringify(base.outputs[out.id])) {
          affected.add(out.id);
        }
      }
    }

    let impactScore = affected.size * 10;
    for (const out of doc.outputs) {
      if (out.primary && affected.has(out.id)) impactScore += 20;
      if ((seenByOutput.get(out.id)?.size ?? 0) > 1) impactScore += 5;
    }

    if (impactScore > 0) {
      questions.push({
        inputName,
        label: pickText(spec.label, lang, inputName),
        type: spec.type,
        impactScore,
        outputsAffected: Array.from(affected),
        probeValuesTested: probes,
      });
    }
  }

  return questions.sort((a, b) => b.impactScore - a.impactScore);
}

function candidatePerturbations(spec: InputSpec, original: unknown): Array<{ value: unknown; delta: string }> {
  const out: Array<{ value: unknown; delta: string }> = [];
  if (spec.type === "boolean" && typeof original === "boolean") {
    out.push({ value: !original, delta: `${String(original)} -> ${String(!original)}` });
  } else if (spec.type === "enum" && spec.enumValues) {
    for (const v of spec.enumValues) {
      if (v !== original) out.push({ value: v, delta: `${String(original)} -> ${v}` });
    }
  } else if ((spec.type === "integer" || spec.type === "decimal") && typeof original === "number") {
    const steps = Array.isArray(spec.counterfactualStep)
      ? (spec.counterfactualStep as number[])
      : [-1, 1, -5, 5, -30, 30];
    const seen = new Set<number>([original]);
    for (const s of steps) {
      const cand = Math.max(0, original + s);
      if (!seen.has(cand)) {
        seen.add(cand);
        out.push({ value: cand, delta: `${original} -> ${cand} (${s > 0 ? "+" : ""}${s})` });
      }
    }
  } else if (spec.type === "date" && typeof original === "string") {
    for (const d of [-1, 1, -7, 7, -30, 30]) {
      const cand = addDays(original, d);
      out.push({ value: cand, delta: `${original} -> ${cand} (${d > 0 ? "+" : ""}${d}d)` });
    }
  } else if (spec.type === "money" && isMoneyValue(original)) {
    const baseNum = Number(original.amount);
    for (const mult of [0.5, 1.5, 2.0]) {
      const next = (baseNum * mult).toFixed(2);
      out.push({
        value: { amount: next, currency: original.currency },
        delta: `${original.currency} ${original.amount} -> ${original.currency} ${next}`,
      });
    }
  }
  return out;
}

/**
 * Counterfactual & Sensitivity Boundary Solver:
 * Perturbs supplied inputs to find the closest factual changes that flip or alter
 * the primary legal outputs.
 */
export function findCounterfactuals(
  doc: LcfDocument,
  inputs: Record<string, unknown>,
  context?: Partial<EvaluationContext>,
): CounterfactualFinding[] {
  const lang = context?.language ?? doc.metadata.languages[0] ?? "de";
  const base = evaluateDocument(doc, inputs, context);
  const findings: CounterfactualFinding[] = [];

  const primaryIds = new Set(doc.outputs.filter((o) => o.primary).map((o) => o.id));
  const watchIds = primaryIds.size > 0 ? primaryIds : new Set(doc.outputs.map((o) => o.id));

  for (const [inputName, spec] of Object.entries(doc.inputs)) {
    const original = inputs[inputName];
    if (isUnknown(original)) continue;

    const candidates = candidatePerturbations(spec, original);
    for (const cand of candidates) {
      const alt = evaluateDocument(doc, { ...inputs, [inputName]: cand.value }, context);
      const changedOutputs: CounterfactualFinding["changedOutputs"] = [];
      for (const outId of watchIds) {
        if (JSON.stringify(base.outputs[outId]) !== JSON.stringify(alt.outputs[outId])) {
          changedOutputs.push({
            outputId: outId,
            from: base.outputs[outId],
            to: alt.outputs[outId],
          });
        }
      }
      if (changedOutputs.length > 0) {
        findings.push({
          inputName,
          label: pickText(spec.label, lang, inputName),
          originalValue: original,
          counterfactualValue: cand.value,
          deltaDescription: cand.delta,
          changedOutputs,
        });
        break; // Keep the closest flip per input variable
      }
    }
  }

  return findings;
}
