import type { EvaluationContext, LcfDocument } from "../../core/src/index.ts";
import { diffLenses, evaluateDocument } from "../../engine/src/index.ts";
import { proveDocument, type FormalProofCertificate } from "../../prover/src/index.ts";

/**
 * A real published court decision distilled into structured Sachverhalt facts and
 * verified Dispositiv holdings for empirical backtesting of executable law ("AlphaProof for Law").
 */
export interface RealCourtCaseRecord {
  decisionId: string;
  citation: string;
  opencaselawUrl: string;
  decisionDate: string;
  court: string;
  summary: string;
  context: Partial<EvaluationContext>;
  facts: Record<string, unknown>;
  actualHolding: Record<string, unknown>;
}

export type MismatchDiagnosis =
  | "streitstand_resolved_by_alternate_lens"
  | "escalation_calibration"
  | "missing_exception_or_rule_refinement";

export interface CaseReplayCounterexample {
  decisionId: string;
  citation: string;
  opencaselawUrl: string;
  outputId: string;
  expectedByCourt: unknown;
  predictedByEngine: unknown;
  diagnosis: MismatchDiagnosis;
  appliedRules: string[];
  alternateLensMatch?: string;
  refinementHint: string;
}

export interface CaseReplayBenchmarkReport {
  documentSlug: string;
  totalCases: number;
  exactMatches: number;
  judicialFidelityPercent: number;
  escalatedToHuman: number;
  counterexamples: CaseReplayCounterexample[];
  converged: boolean;
}

/**
 * CEGAR Empirical Judicial Oracle ("BGE Replay Benchmark"):
 * Executes a compiled LCF/.law document against real published Federal Supreme Court /
 * European court decisions from OpenCaseLaw. Any divergence between the formal rule engine
 * and the court's actual holding becomes a structured Counterexample Packet guiding
 * AI auto-formalization refinement until the executable statute matches live jurisprudence.
 */
export function runCaseReplayBenchmark(
  doc: LcfDocument,
  cases: RealCourtCaseRecord[],
): CaseReplayBenchmarkReport {
  let exactMatches = 0;
  let escalatedToHuman = 0;
  const counterexamples: CaseReplayCounterexample[] = [];

  for (const c of cases) {
    const res = evaluateDocument(doc, c.facts, c.context);
    if (res.escalations.length > 0) escalatedToHuman += 1;

    let caseMatched = true;
    const appliedRules = res.trace
      .filter((t) => t.status === "applied" || t.status === "escalate_human")
      .map((t) => t.ruleId);

    for (const [outId, courtVal] of Object.entries(c.actualHolding)) {
      const predicted = res.outputs[outId];
      if (JSON.stringify(predicted) !== JSON.stringify(courtVal)) {
        caseMatched = false;

        // Check if an alternate Streitstand lens already matches the court holding
        const lensDiff = diffLenses(doc, c.facts, c.context);
        let alternateLensMatch: string | undefined;
        for (const [lensId, lensRes] of Object.entries(lensDiff.resultsByLens)) {
          if (JSON.stringify(lensRes.outputs[outId]) === JSON.stringify(courtVal)) {
            alternateLensMatch = lensId;
            break;
          }
        }

        let diagnosis: MismatchDiagnosis = "missing_exception_or_rule_refinement";
        let refinementHint = `Inspect ${c.citation} (${c.opencaselawUrl}) to encode the missing judicial exception or threshold refinement overriding [${appliedRules.join(", ")}].`;

        if (alternateLensMatch) {
          diagnosis = "streitstand_resolved_by_alternate_lens";
          refinementHint = `Court holding matches lens "${alternateLensMatch}" rather than "${res.context.lens}". Verify whether "${alternateLensMatch}" should become default or scoped by authority level.`;
        } else if (res.escalations.length > 0) {
          diagnosis = "escalation_calibration";
          refinementHint = `Engine escalated to human review while court ruled "${String(courtVal)}". Calibrate Subsumtion factor weights or escalation band against ${c.citation}.`;
        }

        counterexamples.push({
          decisionId: c.decisionId,
          citation: c.citation,
          opencaselawUrl: c.opencaselawUrl,
          outputId: outId,
          expectedByCourt: courtVal,
          predictedByEngine: predicted,
          diagnosis,
          appliedRules,
          alternateLensMatch,
          refinementHint,
        });
      }
    }

    if (caseMatched) exactMatches += 1;
  }

  const judicialFidelityPercent =
    cases.length === 0 ? 100 : Math.round((exactMatches / cases.length) * 100);

  return {
    documentSlug: doc.metadata.slug,
    totalCases: cases.length,
    exactMatches,
    judicialFidelityPercent,
    escalatedToHuman,
    counterexamples,
    converged: counterexamples.length === 0,
  };
}

export interface CegarIterationPacket {
  iteration: number;
  status: "CONVERGED" | "NEEDS_REFINEMENT";
  formalProof: FormalProofCertificate;
  judicialReplay: CaseReplayBenchmarkReport;
  repairDirectives: string[];
  autoFormalizerContract: {
    targetFormat: "law-coded .law DSL -> LCF 0.1";
    groundingSources: string[];
    stoppingCondition: string;
  };
}

/**
 * Runs one full CEGAR verification gate (Formal Prover + Real Court Replay Oracle)
 * and emits exact machine-checkable repair directives for an AI auto-formalizer loop.
 */
export function runCegarVerificationGate(
  doc: LcfDocument,
  courtCases: RealCourtCaseRecord[],
  iteration = 1,
): CegarIterationPacket {
  const formalProof = proveDocument(doc);
  const judicialReplay = runCaseReplayBenchmark(doc, courtCases);
  const repairDirectives: string[] = [];

  if (!formalProof.properties.zeroSilentConflicts.proven) {
    repairDirectives.push(
      `CONFLICT: Resolve ${formalProof.properties.zeroSilentConflicts.counterexamples.length} normative conflict(s) using explicit overrides[] or priority / Streitstand lenses.`,
    );
  }
  if (!formalProof.properties.totalPrimaryCoverage.proven) {
    repairDirectives.push(
      `COVERAGE GAP: Add default/base rules covering missing primary outputs in ${formalProof.properties.totalPrimaryCoverage.counterexamples.length} partition(s).`,
    );
  }
  if (!formalProof.properties.noShadowedDeadRules.proven) {
    repairDirectives.push(
      `DEAD RULES: Rules [${formalProof.properties.noShadowedDeadRules.deadRuleIds.join(", ")}] never fire in symbolic exploration; verify scope/when/temporal bounds.`,
    );
  }
  for (const ce of judicialReplay.counterexamples) {
    repairDirectives.push(`BGE COUNTEREXAMPLE (${ce.citation}): ${ce.refinementHint}`);
  }

  const converged =
    formalProof.soundnessVerdict === "PROVEN_SOUND" &&
    judicialReplay.converged;

  return {
    iteration,
    status: converged ? "CONVERGED" : "NEEDS_REFINEMENT",
    formalProof,
    judicialReplay,
    repairDirectives,
    autoFormalizerContract: {
      targetFormat: "law-coded .law DSL -> LCF 0.1",
      groundingSources: [
        "swisslaw-git (verbatim DE/FR/IT + future branch + consultations)",
        "OpenCaseLaw MCP (get_law, get_doctrine, cite, search_practice, attest_response)",
        "EUR-Lex CELLAR / ELI & UK legislation.gov.uk",
      ],
      stoppingCondition: "soundnessVerdict == PROVEN_SOUND && judicialFidelityPercent == 100 && zero unverified citations",
    },
  };
}
