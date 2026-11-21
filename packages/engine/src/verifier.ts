import {
  validateLcfDocument,
  type LcfDocument,
  type ValidationIssue,
} from "../../core/src/index.ts";
import { collectExprDependencies, evaluateDocument } from "./evaluator.ts";

export interface GoldenTestRun {
  id: string;
  name: string;
  passed: boolean;
  mismatches: Array<{ outputId: string; expected: unknown; actual: unknown }>;
}

export interface VerificationReport {
  documentSlug: string;
  documentVersion: string;
  readinessScore: number; // 0..100 Digitalcheck score
  structuralValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  checks: {
    multilingualCoveragePercent: number;
    authorityGroundingPercent: number;
    temporalGaps: string[];
    unusedInputs: string[];
    untestedOutputs: string[];
    goldenTestsPassed: number;
    goldenTestsTotal: number;
  };
  goldenTestResults: GoldenTestRun[];
}

/**
 * Swiss / European Digitalcheck Formal Verifier:
 * Checks structural conformance, multilingual parity, authority provenance,
 * temporal continuity, unused inputs, and executes all embedded golden court tests.
 */
export function verifyDocument(doc: LcfDocument): VerificationReport {
  const structural = validateLcfDocument(doc);
  const warnings = [...structural.warnings];
  const errors = [...structural.errors];

  // 1. Multilingual coverage across metadata, inputs, rules, outputs
  const langs = doc.metadata.languages;
  let totalLocalizedSlots = 0;
  let filledLocalizedSlots = 0;
  const countLoc = (loc: Record<string, string> | undefined) => {
    for (const l of langs) {
      totalLocalizedSlots += 1;
      if (loc && loc[l] && loc[l].trim().length > 0) filledLocalizedSlots += 1;
    }
  };
  countLoc(doc.metadata.title);
  for (const inp of Object.values(doc.inputs)) countLoc(inp.label);
  for (const r of doc.rules) countLoc(r.label);
  for (const o of doc.outputs) countLoc(o.label);
  const multilingualCoveragePercent =
    totalLocalizedSlots === 0 ? 100 : Math.round((filledLocalizedSlots / totalLocalizedSlots) * 100);

  // 2. Authority grounding quality (ELI / URL / opencaselawId)
  const authorities = Object.entries(doc.authorities);
  let richAuthorities = 0;
  for (const [id, auth] of authorities) {
    const hasLink = Boolean(auth.eli || auth.url || auth.urls || auth.opencaselawId || auth.ecli);
    if (hasLink) {
      richAuthorities += 1;
    } else {
      warnings.push({
        code: "DC-AUTH-01",
        severity: "warning",
        path: `authorities.${id}`,
        message: `Authority "${id}" lacks a verifiable URI (eli, ecli, opencaselawId, or url).`,
      });
    }
  }
  const authorityGroundingPercent =
    authorities.length === 0 ? 0 : Math.round((richAuthorities / authorities.length) * 100);

  // 3. Temporal continuity per target (detect gaps between validUntil and next validFrom)
  const temporalGaps: string[] = [];
  const rulesByTarget = new Map<string, typeof doc.rules>();
  for (const r of doc.rules) {
    if (!rulesByTarget.has(r.target)) rulesByTarget.set(r.target, []);
    rulesByTarget.get(r.target)!.push(r);
  }
  for (const [target, targetRules] of rulesByTarget) {
    const bounded = targetRules
      .filter((r) => r.temporal?.validFrom || r.temporal?.validUntil)
      .sort((a, b) => (a.temporal?.validFrom ?? "0000-01-01").localeCompare(b.temporal?.validFrom ?? "0000-01-01"));
    for (let i = 0; i < bounded.length - 1; i++) {
      const curEnd = bounded[i]!.temporal?.validUntil;
      const nextStart = bounded[i + 1]!.temporal?.validFrom;
      if (curEnd && nextStart && nextStart > curEnd) {
        const msg = `Target "${target}" has a temporal gap between ${curEnd} and ${nextStart}.`;
        temporalGaps.push(msg);
        warnings.push({ code: "DC-TEMP-GAP", severity: "warning", path: `rules.${target}`, message: msg });
      }
    }
  }

  // 4. Unused declared inputs
  const referencedInputs = new Set<string>();
  const referencedTargets = new Set<string>();
  for (const r of doc.rules) {
    collectExprDependencies(r.when, referencedTargets, referencedInputs);
    collectExprDependencies(r.compute, referencedTargets, referencedInputs);
    if (r.subsumtion) {
      for (const dq of r.subsumtion.disqualifiers ?? []) {
        collectExprDependencies(dq.when, referencedTargets, referencedInputs);
      }
      for (const f of r.subsumtion.factors) {
        collectExprDependencies(f.when, referencedTargets, referencedInputs);
        if (f.evidenceInput) referencedInputs.add(f.evidenceInput);
      }
    }
    if (r.dialectical) {
      for (const dq of r.dialectical.disqualifiers ?? []) {
        collectExprDependencies(dq.when, referencedTargets, referencedInputs);
      }
      for (const p of r.dialectical.poles) {
        collectExprDependencies(p.when, referencedTargets, referencedInputs);
        if (p.evidenceInput) referencedInputs.add(p.evidenceInput);
      }
    }
  }
  const unusedInputs = Object.keys(doc.inputs).filter((k) => !referencedInputs.has(k));
  for (const u of unusedInputs) {
    warnings.push({
      code: "DC-INPUT-UNUSED",
      severity: "warning",
      path: `inputs.${u}`,
      message: `Declared input "${u}" is never referenced by any rule.`,
    });
  }

  // 5. Execute all embedded golden tests
  const goldenTestResults: GoldenTestRun[] = [];
  const testedOutputs = new Set<string>();
  for (const tc of doc.tests ?? []) {
    const res = evaluateDocument(doc, tc.inputs, tc.context);
    const mismatches: GoldenTestRun["mismatches"] = [];
    for (const [outId, expectedVal] of Object.entries(tc.expected)) {
      testedOutputs.add(outId);
      const actualVal = res.outputs[outId];
      if (JSON.stringify(actualVal) !== JSON.stringify(expectedVal)) {
        mismatches.push({ outputId: outId, expected: expectedVal, actual: actualVal });
      }
    }
    goldenTestResults.push({
      id: tc.id,
      name: tc.name,
      passed: mismatches.length === 0,
      mismatches,
    });
  }

  const untestedOutputs = doc.outputs.map((o) => o.id).filter((id) => !testedOutputs.has(id));
  const goldenTestsPassed = goldenTestResults.filter((t) => t.passed).length;
  const goldenTestsTotal = goldenTestResults.length;

  // Compute Digitalcheck Readiness Score (0..100)
  let score = 100;
  score -= errors.length * 25;
  score -= temporalGaps.length * 10;
  score -= unusedInputs.length * 3;
  score -= Math.round((100 - multilingualCoveragePercent) * 0.2);
  score -= Math.round((100 - authorityGroundingPercent) * 0.25);
  if (goldenTestsTotal === 0) {
    score -= 20;
  } else {
    const failed = goldenTestsTotal - goldenTestsPassed;
    score -= failed * 15;
  }
  const readinessScore = Math.max(0, Math.min(100, score));

  return {
    documentSlug: doc.metadata.slug,
    documentVersion: doc.metadata.version,
    readinessScore,
    structuralValid: structural.valid && goldenTestsPassed === goldenTestsTotal,
    errors,
    warnings,
    checks: {
      multilingualCoveragePercent,
      authorityGroundingPercent,
      temporalGaps,
      unusedInputs,
      untestedOutputs,
      goldenTestsPassed,
      goldenTestsTotal,
    },
    goldenTestResults,
  };
}
