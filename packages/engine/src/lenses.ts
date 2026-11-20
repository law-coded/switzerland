import {
  pickText,
  type EvaluationContext,
  type EvaluationResult,
  type LcfDocument,
} from "../../core/src/index.ts";
import { evaluateDocument } from "./evaluator.ts";

export interface LensOutputDivergence {
  outputId: string;
  label: string;
  valuesByLens: Record<string, unknown>;
}

export interface LensDiffReport {
  lensesEvaluated: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  hasDivergence: boolean;
  divergingOutputs: LensOutputDivergence[];
  resultsByLens: Record<string, EvaluationResult>;
}

/**
 * Streitstand / Multi-Lens Diff Engine:
 * Evaluates the exact same facts across multiple interpretive lenses
 * (e.g. settled BGer practice vs. strict statutory wording vs. minority doctrine)
 * and pinpoints every output where the legal outcome diverges.
 */
export function diffLenses(
  doc: LcfDocument,
  inputs: Record<string, unknown>,
  baseContext?: Partial<EvaluationContext>,
  lensIds?: string[],
): LensDiffReport {
  const lang = baseContext?.language ?? doc.metadata.languages[0] ?? "de";
  const allLenses = doc.lenses ?? [
    {
      id: "default",
      label: { de: "Standard", en: "Default" },
      description: { de: "Standardauslegung", en: "Default interpretation" },
      default: true,
    },
  ];
  const selected = lensIds
    ? allLenses.filter((l) => lensIds.includes(l.id))
    : allLenses;

  const resultsByLens: Record<string, EvaluationResult> = {};
  for (const lens of selected) {
    resultsByLens[lens.id] = evaluateDocument(doc, inputs, {
      ...baseContext,
      lens: lens.id,
    });
  }

  const divergingOutputs: LensOutputDivergence[] = [];
  for (const out of doc.outputs) {
    const valuesByLens: Record<string, unknown> = {};
    const serialized = new Set<string>();
    for (const lens of selected) {
      const val = resultsByLens[lens.id]!.outputs[out.id];
      valuesByLens[lens.id] = val;
      serialized.add(JSON.stringify(val));
    }
    if (serialized.size > 1) {
      divergingOutputs.push({
        outputId: out.id,
        label: pickText(out.label, lang, out.id),
        valuesByLens,
      });
    }
  }

  return {
    lensesEvaluated: selected.map((l) => ({
      id: l.id,
      label: pickText(l.label, lang, l.id),
      description: pickText(l.description, lang),
    })),
    hasDivergence: divergingOutputs.length > 0,
    divergingOutputs,
    resultsByLens,
  };
}
