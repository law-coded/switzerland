import {
  isMoneyValue,
  isUnknown,
  pickText,
  type Authority,
  type EvaluationResult,
  type LcfDocument,
} from "../../core/src/index.ts";

const HEADINGS: Record<string, Record<string, string>> = {
  de: {
    title: "Rechtliche Begründung und Subsumtionsprotokoll",
    meta: "Verfahrens- und Rechtsstandparameter",
    conclusions: "I. Ergebnis (Dispositiv)",
    reasoning: "II. Normative Subsumtion und Entscheidpfad",
    defeated: "Zurückgetretene / überlagerte Normen (Defeasibility)",
    escalations: "III. Vorbehalt richterlicher bzw. juristischer Ermessensprüfung",
    authorities: "IV. Verifizierte Rechtsgrundlagen und Rechtsprechung",
    provenance: "V. Kryptographische Nachprüfbarkeit",
  },
  fr: {
    title: "Motivation juridique et protocole de subsomption",
    meta: "Paramètres juridictionnels et temporels",
    conclusions: "I. Dispositif / Résultat",
    reasoning: "II. Subsomption normative et chemin décisionnel",
    defeated: "Normes écartées / primées (Défaisabilité)",
    escalations: "III. Réserve d'appréciation humaine / judiciaire",
    authorities: "IV. Bases légales et jurisprudence vérifiées",
    provenance: "V. Traçabilité cryptographique",
  },
  it: {
    title: "Motivazione giuridica e protocollo di sussunzione",
    meta: "Parametri giurisdizionali e temporali",
    conclusions: "I. Dispositivo / Esito",
    reasoning: "II. Sussunzione normativa e percorso decisionale",
    defeated: "Norme superate / derogate",
    escalations: "III. Riserva di apprezzamento giudiziario",
    authorities: "IV. Basi legali e giurisprudenza verificate",
    provenance: "V. Tracciabilità crittografica",
  },
  en: {
    title: "Legal Reasoning & Subsumtion Record",
    meta: "Jurisdictional & Temporal Parameters",
    conclusions: "I. Legal Conclusions (Operative Result)",
    reasoning: "II. Normative Subsumtion & Defeasibility Trace",
    defeated: "Overridden / Defeated Rules",
    escalations: "III. Mandatory Human Jurist Escalations",
    authorities: "IV. Verified Legal Authorities",
    provenance: "V. Cryptographic Provenance",
  },
};

function formatVal(v: unknown): string {
  if (isUnknown(v)) return "unknown / unbewiesen";
  if (isMoneyValue(v)) return `${v.currency} ${v.amount}`;
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function formatAuthorityLink(auth: Authority, lang: string): string {
  const cite = pickText(auth.citation, lang);
  const url = auth.urls?.[lang] ?? auth.url ?? auth.eli;
  return url ? `[${cite}](${url})` : cite;
}

/**
 * Generates an audit-grade, multilingual legal reasoning document (Begründung / Motivation)
 * directly from an LCF evaluation trace with clickable Fedlex & OpenCaseLaw links.
 */
export function generateBegruendung(doc: LcfDocument, result: EvaluationResult): string {
  const lang = result.context.language;
  const h = HEADINGS[lang] ?? HEADINGS["en"]!;
  const lines: string[] = [];

  lines.push(`# ${h.title}: ${pickText(doc.metadata.title, lang)}`);
  lines.push("");
  lines.push(`**${h.meta}:** Jurisdiction \`${result.context.jurisdiction}\` | Fact date \`${result.context.factDate}\` | Decision date \`${result.context.decisionDate}\` | Law version \`${result.context.lawVersion}\` | Lens \`${result.context.lens}\` | Mode \`${result.context.mode}\``);
  lines.push("");

  lines.push(`## ${h.conclusions}`);
  lines.push("");
  for (const out of doc.outputs) {
    const val = result.outputs[out.id];
    const mod = out.modality ? ` _(${out.modality})_` : "";
    lines.push(`- **${pickText(out.label, lang)}**${mod}: \`${formatVal(val)}\``);
  }
  lines.push("");

  lines.push(`## ${h.reasoning}`);
  lines.push("");
  const applied = result.trace.filter(
    (t) =>
      t.status === "applied" ||
      t.status === "resolved_by_burden_of_proof" ||
      t.status === "escalate_human" ||
      t.status === "conflict",
  );
  for (const t of applied) {
    const authLinks = t.authorities
      .map((id) => doc.authorities[id])
      .filter((a): a is Authority => Boolean(a))
      .map((a) => formatAuthorityLink(a, lang))
      .join("; ");
    lines.push(`1. **${t.label}** (\`${t.ruleId}\` -> \`${t.target}\` = \`${formatVal(t.value)}\`, status: \`${t.status}\`)`);
    if (t.explanation) lines.push(`   - ${t.explanation}`);
    if (t.burdenResolution) {
      lines.push(
        `   - Burden of proof (${t.burdenResolution.legalBasis ?? "statutory"}): party \`${t.burdenResolution.party}\` (${t.burdenResolution.factRole}) -> resolved to \`${String(t.burdenResolution.resolvedTo)}\`.`,
      );
    }
    if (t.subsumtionDetail) {
      const sd = t.subsumtionDetail;
      lines.push(
        `   - Structured Subsumtion (${sd.legalConcept}): verdict \`${sd.verdict}\`, score \`${sd.score}\` (escalation band \`[${sd.escalationBand.low}, ${sd.escalationBand.high}]\`).`,
      );
      if (sd.disqualifiedBy) {
        lines.push(`   - Statutory disqualifier triggered: ${sd.disqualifiedBy.label} (\`${sd.disqualifiedBy.authorityRef}\`).`);
      }
      for (const f of sd.triggeredFactors) {
        lines.push(`   - Criterion (${f.weight >= 0 ? "+" : ""}${f.weight}): ${f.label}`);
      }
    }
    if (t.dialecticalDetail) {
      const dd = t.dialecticalDetail;
      lines.push(`   - Dialectical Fallgruppen Analysis (${dd.legalConcept}): verdict \`${dd.verdict}\`.`);
      if (dd.teleology) {
        const telAuth = doc.authorities[dd.teleology.authorityRef];
        const telCite = telAuth ? formatAuthorityLink(telAuth, lang) : dd.teleology.authorityRef;
        lines.push(`   - Ratio legis / Teleology (${telCite}): ${dd.teleology.summary}`);
      }
      if (dd.disqualifiedBy) {
        lines.push(`   - Hard Statutory Disqualifier: ${dd.disqualifiedBy.label} (\`${dd.disqualifiedBy.authorityRef}\`).`);
      }
      for (const p of dd.matchedAffirmingPoles) {
        const pAuth = doc.authorities[p.authorityRef];
        const pLink = pAuth ? formatAuthorityLink(pAuth, lang) : p.authorityRef;
        lines.push(`   - PRO / Affirming Precedent Pole (${pLink}): ${p.label} -> ${p.holdingSummary}`);
      }
      for (const p of dd.matchedDenyingPoles) {
        const pAuth = doc.authorities[p.authorityRef];
        const pLink = pAuth ? formatAuthorityLink(pAuth, lang) : p.authorityRef;
        lines.push(`   - CONTRA / Denying Precedent Pole (${pLink}): ${p.label} -> ${p.holdingSummary}`);
      }
      if (dd.distinguishingQuestions.length > 0 && dd.verdict.includes("escalate")) {
        lines.push(`   - Key Distinguishing Questions for Counsel: ${dd.distinguishingQuestions.join(" | ")}`);
      }
    }
    if (authLinks) lines.push(`   - Authorities: ${authLinks}`);
  }
  lines.push("");

  const defeated = result.trace.filter((t) => t.status === "defeated");
  if (defeated.length > 0) {
    lines.push(`### ${h.defeated}`);
    lines.push("");
    for (const d of defeated) {
      lines.push(`- \`${d.ruleId}\` (${d.label}) was defeated by \`${d.defeatedBy}\`.`);
    }
    lines.push("");
  }

  if (result.escalations.length > 0) {
    lines.push(`## ${h.escalations}`);
    lines.push("");
    for (const e of result.escalations) {
      lines.push(`- **${e.target}** (\`${e.ruleId}\`): ${e.reason}`);
    }
    lines.push("");
  }

  lines.push(`## ${h.authorities}`);
  lines.push("");
  for (const id of result.citationsUsed) {
    const auth = doc.authorities[id];
    if (!auth) continue;
    const link = formatAuthorityLink(auth, lang);
    const extra = auth.consolidationDate
      ? ` (consolidation: ${auth.consolidationDate})`
      : auth.decisionDate
        ? ` (${auth.decisionDate})`
        : "";
    lines.push(`- \`${id}\`: ${link}${extra}`);
  }
  lines.push("");

  lines.push(`## ${h.provenance}`);
  lines.push("");
  lines.push(`- Document: \`${result.documentRef.slug}@${result.documentRef.version}\` (\`${result.documentRef.id}\`)`);
  lines.push(`- Canonical Hash (RFC 8785 JCS + SHA-256): \`${result.documentRef.canonicalHash}\``);

  return lines.join("\n");
}
