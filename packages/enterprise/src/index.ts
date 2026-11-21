import {
  pickText,
  type EvaluationResult,
  type LcfDocument,
} from "../../core/src/index.ts";
import { diffLenses, evaluateDocument, generateBegruendung } from "../../engine/src/index.ts";
import { findStructuringLevers, type StructuringLever } from "../../prover/src/index.ts";

export interface CorporateEntityProfile {
  entityId: string;
  name: string;
  jurisdiction: string; // e.g. "CH-ZH", "DE", "FR", "NO", "UK"
  language?: string;
  attributes: Record<string, unknown>;
}

export interface OrganizationDigitalTwin {
  organizationId: string;
  organizationName: string;
  headquarters: string;
  entities: CorporateEntityProfile[];
}

export interface EntityAssessment {
  entityId: string;
  entityName: string;
  jurisdiction: string;
  outputs: Record<string, unknown>;
  hasStreitstandDivergence: boolean;
  escalationsCount: number;
  citationsUsed: string[];
  evaluation: EvaluationResult;
  structuringLevers?: StructuringLever[];
}

export interface CrossBorderAdvisoryDossier {
  organizationName: string;
  moduleSlug: string;
  evaluationDate: string;
  futureComparisonDate?: string;
  entityAssessments: EntityAssessment[];
  crossBorderSummary: {
    jurisdictionsEvaluated: string[];
    divergentOutputsAcrossGroup: Array<{
      outputId: string;
      valuesByEntity: Record<string, unknown>;
    }>;
    strictestDeadlineHours?: { entityId: string; jurisdiction: string; hours: number };
    entitiesRequiringEscalation: string[];
    futureLawImpacts: Array<{
      entityId: string;
      jurisdiction: string;
      changedOutputs: Record<string, { current: unknown; future: unknown }>;
    }>;
  };
  executiveMemoMarkdown: string;
}

/**
 * Enterprise Client Digital Twin & Cross-Border Advisory Engine:
 * Evaluates a multi-entity multinational organization across Switzerland, EU, EEA, and UK
 * in a single pass, computing:
 * - Side-by-side jurisdictional matrix (CH vs DE/FR/EU vs NO/EEA vs UK),
 * - Strictest regulatory clock / high-water mark across the corporate group,
 * - Streitstand exposure & human-jurist escalation flags,
 * - Pre-enactment future-law impact diff (current date vs. future consolidation date),
 * - Optional lawful structuring levers per entity,
 * - Board/GC-ready multilingual advisory dossier with verified citations.
 */
export function evaluateEnterprisePortfolio(
  twin: OrganizationDigitalTwin,
  doc: LcfDocument,
  scenarioFacts: Record<string, unknown>,
  options?: {
    factDate?: string;
    futureDate?: string;
    language?: string;
    lens?: string;
    structuringGoal?: { outputId: string; desiredValue: unknown; adjustableInputs?: string[] };
  },
): CrossBorderAdvisoryDossier {
  const factDate = options?.factDate ?? "2026-11-21";
  const lang = options?.language ?? "en";

  const entityAssessments: EntityAssessment[] = [];
  const futureLawImpacts: CrossBorderAdvisoryDossier["crossBorderSummary"]["futureLawImpacts"] = [];

  let strictestDeadlineHours: { entityId: string; jurisdiction: string; hours: number } | undefined;

  for (const entity of twin.entities) {
    const mergedInputs = { ...entity.attributes, ...scenarioFacts };
    const ctx = {
      jurisdiction: entity.jurisdiction,
      language: entity.language ?? lang,
      factDate,
      decisionDate: factDate,
      lawVersion: factDate,
      lens: options?.lens,
      mode: "adjudicate" as const,
    };

    const evaluation = evaluateDocument(doc, mergedInputs, ctx);
    const lensDiff = diffLenses(doc, mergedInputs, ctx);

    // Track strictest numeric hour-based reporting deadline if present
    const hoursVal = evaluation.outputs["reporting_deadline_hours"];
    if (typeof hoursVal === "number" && hoursVal > 0) {
      if (!strictestDeadlineHours || hoursVal < strictestDeadlineHours.hours) {
        strictestDeadlineHours = {
          entityId: entity.entityId,
          jurisdiction: entity.jurisdiction,
          hours: hoursVal,
        };
      }
    }

    let structuringLevers: StructuringLever[] | undefined;
    if (options?.structuringGoal) {
      structuringLevers = findStructuringLevers(
        doc,
        mergedInputs,
        ctx,
        options.structuringGoal.outputId,
        options.structuringGoal.desiredValue,
        options.structuringGoal.adjustableInputs,
      );
    }

    entityAssessments.push({
      entityId: entity.entityId,
      entityName: entity.name,
      jurisdiction: entity.jurisdiction,
      outputs: evaluation.outputs,
      hasStreitstandDivergence: lensDiff.hasDivergence,
      escalationsCount: evaluation.escalations.length,
      citationsUsed: evaluation.citationsUsed,
      evaluation,
      structuringLevers,
    });

    // Future-law impact radar (compare current factDate vs futureDate)
    if (options?.futureDate) {
      const futureEval = evaluateDocument(doc, mergedInputs, {
        ...ctx,
        factDate: options.futureDate,
        decisionDate: options.futureDate,
        lawVersion: options.futureDate,
      });
      const changed: Record<string, { current: unknown; future: unknown }> = {};
      for (const out of doc.outputs) {
        if (JSON.stringify(evaluation.outputs[out.id]) !== JSON.stringify(futureEval.outputs[out.id])) {
          changed[out.id] = { current: evaluation.outputs[out.id], future: futureEval.outputs[out.id] };
        }
      }
      if (Object.keys(changed).length > 0) {
        futureLawImpacts.push({
          entityId: entity.entityId,
          jurisdiction: entity.jurisdiction,
          changedOutputs: changed,
        });
      }
    }
  }

  // Detect divergent outputs across corporate group entities
  const divergentOutputsAcrossGroup: CrossBorderAdvisoryDossier["crossBorderSummary"]["divergentOutputsAcrossGroup"] = [];
  for (const out of doc.outputs) {
    const valuesByEntity: Record<string, unknown> = {};
    const distinct = new Set<string>();
    for (const ea of entityAssessments) {
      valuesByEntity[`${ea.entityName} (${ea.jurisdiction})`] = ea.outputs[out.id];
      distinct.add(JSON.stringify(ea.outputs[out.id]));
    }
    if (distinct.size > 1) {
      divergentOutputsAcrossGroup.push({ outputId: out.id, valuesByEntity });
    }
  }

  const entitiesRequiringEscalation = entityAssessments
    .filter((e) => e.escalationsCount > 0)
    .map((e) => `${e.entityName} (${e.jurisdiction})`);

  // Render Executive Board/GC Markdown Dossier
  const lines: string[] = [];
  lines.push(`# Cross-Border Regulatory Advisory Dossier: ${twin.organizationName}`);
  lines.push(`**Module:** ${pickText(doc.metadata.title, lang)} (\`${doc.metadata.slug}@${doc.metadata.version}\`)`);
  lines.push(`**Evaluation Date:** \`${factDate}\` | **Headquarters:** \`${twin.headquarters}\` | **Entities Analyzed:** ${twin.entities.length}`);
  lines.push("");

  if (strictestDeadlineHours) {
    lines.push(
      `> **HIGH-WATER MARK ALERT:** Strictest statutory notification clock across the group is **${strictestDeadlineHours.hours} hours** triggered by **${strictestDeadlineHours.entityId}** (\`${strictestDeadlineHours.jurisdiction}\`).`,
    );
    lines.push("");
  }

  lines.push("## I. Group Cross-Border Applicability Matrix");
  lines.push("");
  const outIds = doc.outputs.map((o) => o.id);
  lines.push(`| Entity | Jurisdiction | ${outIds.join(" | ")} | Streitstand |`);
  lines.push(`| --- | --- | ${outIds.map(() => "---").join(" | ")} | --- |`);
  for (const ea of entityAssessments) {
    const vals = outIds.map((id) => `\`${JSON.stringify(ea.outputs[id])}\``).join(" | ");
    lines.push(`| ${ea.entityName} | \`${ea.jurisdiction}\` | ${vals} | ${ea.hasStreitstandDivergence ? "YES" : "No"} |`);
  }
  lines.push("");

  if (futureLawImpacts.length > 0) {
    lines.push(`## II. Proactive Future-Law Change Radar (${factDate} -> ${options?.futureDate})`);
    lines.push("");
    for (const imp of futureLawImpacts) {
      lines.push(`- **${imp.entityId} (\`${imp.jurisdiction}\`)**: ${JSON.stringify(imp.changedOutputs)}`);
    }
    lines.push("");
  }

  lines.push("## III. Per-Entity Audit-Grade Begründungen");
  lines.push("");
  for (const ea of entityAssessments) {
    lines.push(`### ${ea.entityName} (\`${ea.jurisdiction}\`)`);
    lines.push("");
    lines.push(generateBegruendung(doc, ea.evaluation));
    lines.push("");
  }

  return {
    organizationName: twin.organizationName,
    moduleSlug: doc.metadata.slug,
    evaluationDate: factDate,
    futureComparisonDate: options?.futureDate,
    entityAssessments,
    crossBorderSummary: {
      jurisdictionsEvaluated: twin.entities.map((e) => e.jurisdiction),
      divergentOutputsAcrossGroup,
      strictestDeadlineHours,
      entitiesRequiringEscalation,
      futureLawImpacts,
    },
    executiveMemoMarkdown: lines.join("\n"),
  };
}
