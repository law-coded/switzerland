import type { Authority, LcfDocument } from "../../core/src/index.ts";

export interface EuropeanLegalSourceDescriptor {
  jurisdiction: string;
  portalName: string;
  legislationStandard: string;
  endpoint: string;
  caseLawSource: string;
  identifierScheme: string;
}

/**
 * Registry of official European / Swiss / EEA / UK open legal data sources
 * targeted by law-coded's continuous grounding and drift-detection pipeline.
 */
export const EUROPEAN_LEGAL_SOURCES: EuropeanLegalSourceDescriptor[] = [
  {
    jurisdiction: "CH",
    portalName: "Fedlex (Swiss Federal Chancellery) + OpenCaseLaw.ch",
    legislationStandard: "LegalDocML.ch (Akoma Ntoso) + JOLux RDF/SPARQL + ELI",
    endpoint: "https://fedlex.data.admin.ch/sparqlendpoint",
    caseLawSource: "https://mcp.opencaselaw.ch (1.04M+ federal & cantonal decisions, BBl, 13k Weisungen)",
    identifierScheme: "Fedlex ELI + OpenCaseLaw decision_id#e-pinpoint",
  },
  {
    jurisdiction: "EU",
    portalName: "EUR-Lex CELLAR + CURIA",
    legislationStandard: "Formex / Akoma Ntoso + ELI + CELEX",
    endpoint: "https://publications.europa.eu/webapi/rdf/sparql",
    caseLawSource: "CURIA / OpenCaseLaw CJEU index",
    identifierScheme: "http://data.europa.eu/eli/... + ECLI:EU:C:...",
  },
  {
    jurisdiction: "ECHR",
    portalName: "HUDOC + OpenCaseLaw ECtHR Index",
    legislationStandard: "Council of Europe Treaty Series + HUDOC",
    endpoint: "https://mcp.opencaselaw.ch",
    caseLawSource: "ECtHR Grand Chamber & Chamber (importance 1-3)",
    identifierScheme: "ECLI:CE:ECHR:...",
  },
  {
    jurisdiction: "DE",
    portalName: "Rechtsinformationsportal des Bundes (BMJ)",
    legislationStandard: "LegalDocML.de (Akoma Ntoso) + ELI",
    endpoint: "https://testphase.rechtsinformationen.bund.de/v1",
    caseLawSource: "BVerfG / BGH / BVerwG / BAG / BFH / BSG",
    identifierScheme: "eli/bund/bgbl-1/... + ECLI:DE:...",
  },
  {
    jurisdiction: "FR",
    portalName: "Légifrance (DILA) + Judilibre",
    legislationStandard: "LEGI / ELI",
    endpoint: "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app",
    caseLawSource: "Cour de cassation (Judilibre) + Conseil d'État",
    identifierScheme: "eli/loi/... + ECLI:FR:...",
  },
  {
    jurisdiction: "AT",
    portalName: "RIS (Rechtsinformationssystem des Bundes)",
    legislationStandard: "RIS OGD JSON/XML + ELI",
    endpoint: "https://data.bka.gv.at/ris/api/v2.6",
    caseLawSource: "OGH / VfGH / VwGH (RIS)",
    identifierScheme: "eli/bgbl/... + ECLI:AT:...",
  },
  {
    jurisdiction: "IT",
    portalName: "Normattiva (IPZS)",
    legislationStandard: "Akoma Ntoso / URN:NIR + ELI",
    endpoint: "https://www.normattiva.it",
    caseLawSource: "Corte costituzionale / Corte di cassazione",
    identifierScheme: "urn:nir:stato:... + ECLI:IT:...",
  },
  {
    jurisdiction: "UK",
    portalName: "legislation.gov.uk + TNA Find Case Law",
    legislationStandard: "Crown Legislation Markup Language (CLML) / Akoma Ntoso",
    endpoint: "https://www.legislation.gov.uk",
    caseLawSource: "https://caselaw.nationalarchives.gov.uk (UKSC, EWCA, EWHC)",
    identifierScheme: "legislation.gov.uk URI + UK Neutral Citations",
  },
];

/**
 * Builds an OpenCaseLaw canonical decision URL with optional verified Erwägung pinpoint.
 */
export function buildOpenCaseLawUrl(decisionId: string, pinpoint?: string): string {
  const encoded = encodeURIComponent(decisionId);
  if (!pinpoint) return `https://mcp.opencaselaw.ch/entscheid/${encoded}`;
  const anchor = `e-${pinpoint.replace(/\./g, "-")}`;
  return `https://mcp.opencaselaw.ch/entscheid/${encoded}#${anchor}`;
}

/**
 * Builds deterministic swisslaw-git paths and GitHub URLs (jonashertner/swisslaw-git):
 * e.g. SR 220, lang "de", article "336c" -> "ch/2/220/de.md#art-336c"
 * Supports main, future (enacted not-yet-in-force), and stand/YYYY-MM-01 historical tags.
 */
export function buildSwissLawGitRef(
  srNumber: string,
  lang: "de" | "fr" | "it" | "en",
  article?: string,
  gitRef = "main",
): { path: string; anchor: string; githubUrl: string } {
  const bucket = srNumber.startsWith("0.") ? srNumber.slice(0, 3) : srNumber.slice(0, 1);
  const path = `ch/${bucket}/${srNumber}/${lang}.md`;
  const anchor = article ? `#art-${article.toLowerCase().replace(/\s+/g, "-")}` : "";
  return {
    path,
    anchor,
    githubUrl: `https://github.com/jonashertner/swisslaw-git/blob/${gitRef}/${path}${anchor}`,
  };
}

/**
 * Maps changed files from a `swisslaw-git` commit or `future` branch diff
 * (`git diff --name-only`) directly to impacted rules in an LCF document.
 */
export function mapSwissLawGitDiffToRules(
  doc: LcfDocument,
  changedPaths: string[],
): Array<{ changedPath: string; authorityId: string; affectedRuleIds: string[] }> {
  const normalized = changedPaths.map((p) => p.replace(/^\/+/, "").split("#")[0]!);
  const hits: Array<{ changedPath: string; authorityId: string; affectedRuleIds: string[] }> = [];

  for (const [authId, auth] of Object.entries<Authority>(doc.authorities)) {
    const gitPaths = auth.swisslawGitPath ? Object.values(auth.swisslawGitPath) : [];
    for (const gp of gitPaths) {
      const basePath = gp.split("#")[0]!;
      if (normalized.includes(basePath)) {
        const affectedRuleIds = doc.rules
          .filter((r) => r.authorities.includes(authId))
          .map((r) => r.id);
        hits.push({ changedPath: basePath, authorityId: authId, affectedRuleIds });
        break;
      }
    }
  }
  return hits;
}

/**
 * Generates a Fedlex SPARQL query to inspect the latest consolidation date
 * and pending future consolidations for any Swiss federal ELI work URI.
 */
export function buildFedlexConsolidationSparql(eliBase: string): string {
  return [
    "PREFIX jolux: <http://data.legilux.public.lu/resource/ontology/jolux#>",
    "SELECT ?consolidation ?dateApplicability ?dateEndApplicability WHERE {",
    `  <${eliBase}> jolux:isMemberOf|^jolux:isMemberOf ?consolidation .`,
    "  ?consolidation jolux:dateApplicability ?dateApplicability .",
    "  OPTIONAL { ?consolidation jolux:dateEndApplicability ?dateEndApplicability . }",
    "} ORDER BY DESC(?dateApplicability) LIMIT 5",
  ].join("\n");
}

export interface DriftAlert {
  severity: "info" | "warning" | "action_required";
  authorityId?: string;
  affectedRuleIds: string[];
  effectiveDate?: string;
  message: string;
}

/**
 * Continuous Law-CI Drift Detector:
 * Inspects an LCF document's authorities and pending statutory amendments against
 * an inspection date (or newly observed consolidation dates) to flag stale rule nodes.
 */
export function detectAmendmentDrift(
  doc: LcfDocument,
  asOfDate: string,
  observedConsolidations?: Record<string, string>,
): DriftAlert[] {
  const alerts: DriftAlert[] = [];

  // 1. Check declared pendingChanges (populated from Fedlex / OpenCaseLaw `pending_changes`)
  for (const pending of doc.metadata.pendingChanges ?? []) {
    const affectedRuleIds = doc.rules.map((r) => r.id);
    if (asOfDate >= pending.effectiveDate) {
      alerts.push({
        severity: "action_required",
        effectiveDate: pending.effectiveDate,
        affectedRuleIds,
        message: `Pending consolidation effective ${pending.effectiveDate} is now IN FORCE (as of ${asOfDate}): ${pending.summary["en"] ?? pending.summary["de"] ?? "review required"}.`,
      });
    } else {
      alerts.push({
        severity: "info",
        effectiveDate: pending.effectiveDate,
        affectedRuleIds,
        message: `Upcoming statutory consolidation scheduled for ${pending.effectiveDate}: ${pending.summary["en"] ?? pending.summary["de"] ?? "monitor"}.`,
      });
    }
  }

  // 2. Compare recorded authority consolidation dates against live observed dates
  for (const [authId, auth] of Object.entries<Authority>(doc.authorities)) {
    const liveDate = observedConsolidations?.[authId];
    if (liveDate && auth.consolidationDate && liveDate > auth.consolidationDate) {
      const affected = doc.rules.filter((r) => r.authorities.includes(authId)).map((r) => r.id);
      alerts.push({
        severity: "action_required",
        authorityId: authId,
        effectiveDate: liveDate,
        affectedRuleIds: affected,
        message: `Authority "${authId}" has newer consolidation ${liveDate} (rulemap pinned to ${auth.consolidationDate}). ${affected.length} rule(s) must be re-verified.`,
      });
    }
  }

  return alerts;
}
