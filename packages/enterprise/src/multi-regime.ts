import {
  computeCanonicalHash,
  pickText,
  type LcfDocument,
} from "../../core/src/index.ts";
import {
  evaluateDocument,
  findCounterfactuals,
  jurisdictionMatches,
} from "../../engine/src/index.ts";
import { findStructuringLevers, type StructuringLever } from "../../prover/src/index.ts";
import {
  evaluateEnterprisePortfolio,
  type CrossBorderAdvisoryDossier,
  type OrganizationDigitalTwin,
} from "./index.ts";

export interface EvidencePinpoint {
  evidenceId: string;
  sourceDoc: string; // e.g. "Cloud Outsourcing Agreement § 14.2" or "Incident Ticket #INC-2026-441"
  pinpoint?: string;
  factKeys: string[];
  verifiedAt?: string;
}

export interface ClientFactGraph {
  caseTitle: string;
  facts: Record<string, unknown>;
  evidence: EvidencePinpoint[];
}

export interface SovereignConflict {
  conflictId: string;
  severity: "critical_criminal_conflict" | "regulatory_conflict";
  obligatingEntityId: string;
  obligatingJurisdiction: string;
  obligatingModule: string;
  obligatingOutputId: string;
  prohibitingEntityId: string;
  prohibitingJurisdiction: string;
  prohibitingModule: string;
  prohibitingOutputId: string;
  summary: string;
  deconflictionLevers: StructuringLever[];
}

export interface AssumptionWatchItem {
  moduleSlug: string;
  entityId: string;
  inputName: string;
  assumedValue: unknown;
  flipBoundary: string;
  impactedOutputs: string[];
}

export interface LivingAdviceRecord {
  adviceId: string;
  issuedAt: string;
  organizationName: string;
  caseTitle: string;
  canonicalModuleHashes: Record<string, string>;
  swisslawGitWatchPaths: string[];
  opencaselawWatchIds: string[];
  pendingStatutoryDeadlines: Array<{
    moduleSlug: string;
    effectiveDate: string;
    summary: string;
  }>;
  assumptionWatchlist: AssumptionWatchItem[];
  evidencePinpoints: EvidencePinpoint[];
}

export interface MultiRegimeAdvisoryReport {
  organizationName: string;
  caseTitle: string;
  evaluationDate: string;
  triggeredModules: string[];
  dossiersByModule: Record<string, CrossBorderAdvisoryDossier>;
  sovereignConflicts: SovereignConflict[];
  livingAdvice: LivingAdviceRecord;
  executiveBriefMarkdown: string;
}

export interface LivingAdviceFreshnessResult {
  adviceId: string;
  status: "VALID" | "REVIEW_REQUIRED" | "INVALIDATED";
  checkedAt: string;
  triggeredGitPaths: string[];
  triggeredPendingAmendments: Array<{ moduleSlug: string; effectiveDate: string; summary: string }>;
  invalidatedAssumptions: Array<{ inputName: string; assumedValue: unknown; observedValue: unknown; impactedOutputs: string[] }>;
  reasons: string[];
}

/**
 * 4-Layer Cross-Regime Orchestrator:
 * Evaluates ONE Client Fact Graph + Organization Digital Twin across multiple legal modules
 * simultaneously, automatically spotting cross-statute issues, detecting sovereign conflicts
 * (e.g. EU DORA/GDPR disclosure obligation vs. Swiss Art. 271 StGB criminal prohibition),
 * computing lawful de-confliction levers (e.g. Art. 42c FINMAG), and issuing a machine-monitorable
 * Living Advice Contract bound to swisslaw-git paths, OpenCaseLaw IDs, and counterfactual assumptions.
 */
export function adviseMultiRegime(
  twin: OrganizationDigitalTwin,
  modules: LcfDocument[],
  factGraph: ClientFactGraph,
  options?: { factDate?: string; futureDate?: string; language?: string; lens?: string },
): MultiRegimeAdvisoryReport {
  const factDate = options?.factDate ?? "2026-11-21";
  const lang = options?.language ?? "en";

  const dossiersByModule: Record<string, CrossBorderAdvisoryDossier> = {};
  const triggeredModules: string[] = [];
  const canonicalModuleHashes: Record<string, string> = {};
  const gitWatchSet = new Set<string>();
  const oclWatchSet = new Set<string>();
  const pendingDeadlines: LivingAdviceRecord["pendingStatutoryDeadlines"] = [];
  const assumptionWatchlist: AssumptionWatchItem[] = [];

  for (const mod of modules) {
    // Filter entities whose jurisdiction falls within this module's declared jurisdictions
    const matchingEntities = twin.entities.filter((e) =>
      mod.metadata.jurisdictions.some((mj) => jurisdictionMatches(e.jurisdiction, mj)),
    );
    if (matchingEntities.length === 0) continue;

    // Only activate modules where at least one input is relevant or non-trivial output triggers
    const subTwin: OrganizationDigitalTwin = { ...twin, entities: matchingEntities };
    const dossier = evaluateEnterprisePortfolio(subTwin, mod, factGraph.facts, {
      factDate,
      futureDate: options?.futureDate,
      language: lang,
      lens: options?.lens,
    });

    dossiersByModule[mod.metadata.slug] = dossier;
    triggeredModules.push(mod.metadata.slug);
    canonicalModuleHashes[mod.metadata.slug] = computeCanonicalHash(mod);

    for (const p of mod.metadata.pendingChanges ?? []) {
      pendingDeadlines.push({
        moduleSlug: mod.metadata.slug,
        effectiveDate: p.effectiveDate,
        summary: pickText(p.summary, lang),
      });
    }

    // Gather swisslaw-git paths, OpenCaseLaw IDs, and counterfactual assumption watchlist
    for (const ea of dossier.entityAssessments) {
      for (const authId of ea.citationsUsed) {
        const auth = mod.authorities[authId];
        if (!auth) continue;
        if (auth.opencaselawId) oclWatchSet.add(auth.opencaselawId);
        if (auth.swisslawGitPath) {
          for (const gp of Object.values(auth.swisslawGitPath)) {
            gitWatchSet.add(gp.split("#")[0]!);
          }
        }
      }

      const entityObj = matchingEntities.find((e) => e.entityId === ea.entityId)!;
      const merged = { ...entityObj.attributes, ...factGraph.facts };
      const cfs = findCounterfactuals(mod, merged, {
        jurisdiction: ea.jurisdiction,
        factDate,
        language: lang,
        lens: options?.lens,
      });
      for (const cf of cfs) {
        assumptionWatchlist.push({
          moduleSlug: mod.metadata.slug,
          entityId: ea.entityId,
          inputName: cf.inputName,
          assumedValue: cf.originalValue,
          flipBoundary: cf.deltaDescription,
          impactedOutputs: cf.changedOutputs.map((c) => c.outputId),
        });
      }
    }
  }

  // Automated Sovereign Conflict Detection:
  // Detect active cross-border obligations colliding with active criminal/statutory prohibitions
  const activeObligations: Array<{
    entityId: string;
    jurisdiction: string;
    module: LcfDocument;
    outputId: string;
  }> = [];
  const activeProhibitions: Array<{
    entityId: string;
    jurisdiction: string;
    module: LcfDocument;
    outputId: string;
    mergedInputs: Record<string, unknown>;
  }> = [];

  for (const mod of modules) {
    const dossier = dossiersByModule[mod.metadata.slug];
    if (!dossier) continue;
    for (const ea of dossier.entityAssessments) {
      const entityObj = twin.entities.find((e) => e.entityId === ea.entityId)!;
      for (const out of mod.outputs) {
        const val = ea.outputs[out.id];
        if (out.modality === "obligation" && val === true) {
          activeObligations.push({
            entityId: ea.entityId,
            jurisdiction: ea.jurisdiction,
            module: mod,
            outputId: out.id,
          });
        }
        if (out.modality === "prohibition" && val === true) {
          activeProhibitions.push({
            entityId: ea.entityId,
            jurisdiction: ea.jurisdiction,
            module: mod,
            outputId: out.id,
            mergedInputs: { ...entityObj.attributes, ...factGraph.facts },
          });
        }
      }
    }
  }

  const sovereignConflicts: SovereignConflict[] = [];
  let conflictCounter = 1;

  for (const prohib of activeProhibitions) {
    for (const oblig of activeObligations) {
      // Cross-border collision: different root country jurisdictions (e.g. DE/EU/UK obligation vs CH prohibition)
      const rootP = prohib.jurisdiction.split("-")[0]!;
      const rootO = oblig.jurisdiction.split("-")[0]!;
      if (rootP === rootO) continue;

      const levers = findStructuringLevers(
        prohib.module,
        prohib.mergedInputs,
        { jurisdiction: prohib.jurisdiction, factDate, language: lang, mode: "adjudicate" },
        prohib.outputId,
        false,
      );

      sovereignConflicts.push({
        conflictId: `SC-${String(conflictCounter++).padStart(3, "0")}`,
        severity: prohib.module.metadata.legalDomains?.includes("criminal-law")
          ? "critical_criminal_conflict"
          : "regulatory_conflict",
        obligatingEntityId: oblig.entityId,
        obligatingJurisdiction: oblig.jurisdiction,
        obligatingModule: oblig.module.metadata.slug,
        obligatingOutputId: oblig.outputId,
        prohibitingEntityId: prohib.entityId,
        prohibitingJurisdiction: prohib.jurisdiction,
        prohibitingModule: prohib.module.metadata.slug,
        prohibitingOutputId: prohib.outputId,
        summary: `Sovereign Collision: ${oblig.entityId} (${oblig.jurisdiction}) faces mandatory obligation "${oblig.outputId}" (${oblig.module.metadata.slug}) while ${prohib.entityId} (${prohib.jurisdiction}) faces active prohibition "${prohib.outputId}" (${prohib.module.metadata.slug}).`,
        deconflictionLevers: levers,
      });
    }
  }

  const adviceId = `adv-${twin.organizationId}-${factDate}`;
  const livingAdvice: LivingAdviceRecord = {
    adviceId,
    issuedAt: factDate,
    organizationName: twin.organizationName,
    caseTitle: factGraph.caseTitle,
    canonicalModuleHashes,
    swisslawGitWatchPaths: Array.from(gitWatchSet).sort(),
    opencaselawWatchIds: Array.from(oclWatchSet).sort(),
    pendingStatutoryDeadlines: pendingDeadlines,
    assumptionWatchlist,
    evidencePinpoints: factGraph.evidence,
  };

  // Render Executive Cross-Regime Brief
  const lines: string[] = [];
  lines.push(`# Multi-Regime Living Legal Advisory Brief: ${twin.organizationName}`);
  lines.push(`**Matter:** ${factGraph.caseTitle} | **Evaluation Date:** \`${factDate}\` | **Regimes Spotted:** ${triggeredModules.map((m) => `\`${m}\``).join(", ")}`);
  lines.push("");

  if (sovereignConflicts.length > 0) {
    lines.push("## I. CRITICAL SOVEREIGN CONFLICTS DETECTED & LAWFUL DE-CONFLICTION BRIDGES");
    lines.push("");
    for (const sc of sovereignConflicts) {
      lines.push(`- **[${sc.conflictId} / ${sc.severity}]** ${sc.summary}`);
      if (sc.deconflictionLevers.length > 0) {
        lines.push(`  - **Lawful De-Confliction Paths (computed by Formal Structuring Solver):**`);
        for (const lev of sc.deconflictionLevers) {
          const desc = lev.changes.map((c) => `\`${c.inputName}\`: \`${JSON.stringify(c.from)}\` -> \`${JSON.stringify(c.to)}\``).join(" AND ");
          lines.push(`    - (${lev.steps}-step bridge) ${desc}`);
        }
      }
    }
    lines.push("");
  }

  lines.push("## II. Cross-Regime Obligations & High-Water Marks");
  lines.push("");
  for (const slug of triggeredModules) {
    const d = dossiersByModule[slug]!;
    const clock = d.crossBorderSummary.strictestDeadlineHours
      ? ` | Strictest clock: **${d.crossBorderSummary.strictestDeadlineHours.hours}h** (${d.crossBorderSummary.strictestDeadlineHours.jurisdiction})`
      : "";
    lines.push(`- **\`${slug}\`** (${d.entityAssessments.length} entities)${clock}`);
  }
  lines.push("");

  lines.push("## III. Living Advice Watchlist & Provenance Contract");
  lines.push("");
  lines.push(`- **Advice ID:** \`${livingAdvice.adviceId}\``);
  lines.push(`- **Watched \`swisslaw-git\` Paths:** ${livingAdvice.swisslawGitWatchPaths.map((p) => `\`${p}\``).join(", ") || "none"}`);
  lines.push(`- **Watched OpenCaseLaw Precedents:** ${livingAdvice.opencaselawWatchIds.map((id) => `\`${id}\``).join(", ") || "none"}`);
  lines.push(`- **Critical Factual Assumptions (${assumptionWatchlist.length}):**`);
  for (const a of assumptionWatchlist.slice(0, 8)) {
    lines.push(`  - \`${a.entityId}\` / \`${a.inputName}\` = \`${JSON.stringify(a.assumedValue)}\` (flips on \`${a.flipBoundary}\` -> alters ${a.impactedOutputs.map((o) => `\`${o}\``).join(", ")})`);
  }

  return {
    organizationName: twin.organizationName,
    caseTitle: factGraph.caseTitle,
    evaluationDate: factDate,
    triggeredModules,
    dossiersByModule,
    sovereignConflicts,
    livingAdvice,
    executiveBriefMarkdown: lines.join("\n"),
  };
}

/**
 * Checks whether a previously issued Living Advice Contract is still VALID,
 * requires legal REVIEW_REQUIRED (statute amended in swisslaw-git or pending effective date reached),
 * or is INVALIDATED (one of the watched factual assumptions flipped).
 */
export function checkLivingAdviceFreshness(
  record: LivingAdviceRecord,
  probe: {
    asOfDate: string;
    changedGitPaths?: string[];
    updatedFacts?: Record<string, unknown>;
  },
): LivingAdviceFreshnessResult {
  const reasons: string[] = [];

  // 1. Check factual assumption flips (highest severity -> INVALIDATED)
  const invalidatedAssumptions: LivingAdviceFreshnessResult["invalidatedAssumptions"] = [];
  if (probe.updatedFacts) {
    for (const item of record.assumptionWatchlist) {
      if (item.inputName in probe.updatedFacts) {
        const obs = probe.updatedFacts[item.inputName];
        if (JSON.stringify(obs) !== JSON.stringify(item.assumedValue)) {
          invalidatedAssumptions.push({
            inputName: item.inputName,
            assumedValue: item.assumedValue,
            observedValue: obs,
            impactedOutputs: item.impactedOutputs,
          });
          reasons.push(
            `Factual assumption "${item.inputName}" changed from ${JSON.stringify(item.assumedValue)} to ${JSON.stringify(obs)} (impacts: ${item.impactedOutputs.join(", ")}).`,
          );
        }
      }
    }
  }

  // 2. Check swisslaw-git commits impacting watched statutory files
  const normalizedChanged = new Set((probe.changedGitPaths ?? []).map((p) => p.replace(/^\/+/, "").split("#")[0]!));
  const triggeredGitPaths = record.swisslawGitWatchPaths.filter((wp) => normalizedChanged.has(wp));
  for (const gp of triggeredGitPaths) {
    reasons.push(`Watched swisslaw-git statutory file "${gp}" was modified since advice issue date ${record.issuedAt}.`);
  }

  // 3. Check pending statutory consolidations that have now entered into force
  const triggeredPendingAmendments = record.pendingStatutoryDeadlines.filter(
    (p) => probe.asOfDate >= p.effectiveDate && p.effectiveDate > record.issuedAt,
  );
  for (const pa of triggeredPendingAmendments) {
    reasons.push(`Pending statutory consolidation for "${pa.moduleSlug}" entered into force on ${pa.effectiveDate}: ${pa.summary}`);
  }

  const status: LivingAdviceFreshnessResult["status"] =
    invalidatedAssumptions.length > 0
      ? "INVALIDATED"
      : triggeredGitPaths.length > 0 || triggeredPendingAmendments.length > 0
        ? "REVIEW_REQUIRED"
        : "VALID";

  return {
    adviceId: record.adviceId,
    status,
    checkedAt: probe.asOfDate,
    triggeredGitPaths,
    triggeredPendingAmendments,
    invalidatedAssumptions,
    reasons,
  };
}
