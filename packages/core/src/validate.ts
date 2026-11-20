import type { LcfDocument } from "./types.ts";

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JURISDICTION_RE = /^(EU|EEA|ECHR|[A-Z]{2}(-[A-Z0-9]{1,8})*)$/;

export function validateLcfDocument(doc: LcfDocument): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (doc.$format !== "LCF") {
    issues.push({
      code: "LCF-FMT-01",
      severity: "error",
      path: "$format",
      message: `$format MUST be "LCF", received "${String(doc.$format)}".`,
    });
  }

  if (!doc.$specVersion || !/^0\.1(\.\d+)?$/.test(doc.$specVersion)) {
    issues.push({
      code: "LCF-FMT-02",
      severity: "error",
      path: "$specVersion",
      message: `$specVersion MUST match 0.1(.x), received "${String(doc.$specVersion)}".`,
    });
  }

  if (!doc.metadata?.id || !doc.metadata?.slug || !doc.metadata?.version) {
    issues.push({
      code: "LCF-META-01",
      severity: "error",
      path: "metadata",
      message: "metadata.id, metadata.slug, and metadata.version are required.",
    });
  }

  if (!Array.isArray(doc.metadata?.jurisdictions) || doc.metadata.jurisdictions.length === 0) {
    issues.push({
      code: "LCF-META-02",
      severity: "error",
      path: "metadata.jurisdictions",
      message: "At least one jurisdiction MUST be declared.",
    });
  } else {
    for (const j of doc.metadata.jurisdictions) {
      if (!JURISDICTION_RE.test(j)) {
        issues.push({
          code: "LCF-META-03",
          severity: "error",
          path: "metadata.jurisdictions",
          message: `Invalid jurisdiction code "${j}".`,
        });
      }
    }
  }

  const languages = doc.metadata?.languages ?? [];
  if (languages.length === 0) {
    issues.push({
      code: "LCF-META-04",
      severity: "error",
      path: "metadata.languages",
      message: "At least one language MUST be declared.",
    });
  }

  const authorityIds = new Set(Object.keys(doc.authorities ?? {}));
  if (authorityIds.size === 0) {
    issues.push({
      code: "LCF-AUTH-01",
      severity: "error",
      path: "authorities",
      message: "An LCF document MUST declare at least one authoritative legal source.",
    });
  }

  const lensIds = new Set((doc.lenses ?? []).map((l) => l.id));
  const ruleIds = new Set<string>();
  const targetNames = new Set<string>();

  for (const rule of doc.rules ?? []) {
    if (ruleIds.has(rule.id)) {
      issues.push({
        code: "LCF-RULE-01",
        severity: "error",
        path: `rules.${rule.id}`,
        message: `Duplicate rule id "${rule.id}".`,
      });
    }
    ruleIds.add(rule.id);
    targetNames.add(rule.target);

    if (!Array.isArray(rule.authorities) || rule.authorities.length === 0) {
      issues.push({
        code: "LCF-RULE-02",
        severity: "error",
        path: `rules.${rule.id}.authorities`,
        message: `Rule "${rule.id}" MUST cite at least one authority.`,
      });
    } else {
      for (const a of rule.authorities) {
        if (!authorityIds.has(a)) {
          issues.push({
            code: "LCF-RULE-03",
            severity: "error",
            path: `rules.${rule.id}.authorities`,
            message: `Rule "${rule.id}" cites unknown authority "${a}".`,
          });
        }
      }
    }

    if (rule.temporal?.validFrom && !ISO_DATE_RE.test(rule.temporal.validFrom)) {
      issues.push({
        code: "LCF-TEMP-01",
        severity: "error",
        path: `rules.${rule.id}.temporal.validFrom`,
        message: `Invalid ISO date "${rule.temporal.validFrom}".`,
      });
    }
    if (rule.temporal?.validUntil && !ISO_DATE_RE.test(rule.temporal.validUntil)) {
      issues.push({
        code: "LCF-TEMP-02",
        severity: "error",
        path: `rules.${rule.id}.temporal.validUntil`,
        message: `Invalid ISO date "${rule.temporal.validUntil}".`,
      });
    }
    if (
      rule.temporal?.validFrom &&
      rule.temporal?.validUntil &&
      rule.temporal.validUntil <= rule.temporal.validFrom
    ) {
      issues.push({
        code: "LCF-TEMP-03",
        severity: "error",
        path: `rules.${rule.id}.temporal`,
        message: `validUntil (${rule.temporal.validUntil}) MUST be later than validFrom (${rule.temporal.validFrom}).`,
      });
    }

    for (const lens of rule.scope?.lenses ?? []) {
      if (!lensIds.has(lens)) {
        issues.push({
          code: "LCF-LENS-01",
          severity: "error",
          path: `rules.${rule.id}.scope.lenses`,
          message: `Rule "${rule.id}" references undeclared lens "${lens}".`,
        });
      }
    }

    // Multilingual completeness warning
    for (const lang of languages) {
      if (!rule.label?.[lang]) {
        issues.push({
          code: "LCF-I18N-01",
          severity: "warning",
          path: `rules.${rule.id}.label`,
          message: `Rule "${rule.id}" is missing label translation for declared language "${lang}".`,
        });
      }
    }
  }

  // Validate override references and detect override cycles
  const overrideGraph = new Map<string, string[]>();
  for (const rule of doc.rules ?? []) {
    overrideGraph.set(rule.id, rule.overrides ?? []);
    for (const targetId of rule.overrides ?? []) {
      if (!ruleIds.has(targetId)) {
        issues.push({
          code: "LCF-OVR-01",
          severity: "error",
          path: `rules.${rule.id}.overrides`,
          message: `Rule "${rule.id}" overrides unknown rule "${targetId}".`,
        });
      }
      if (targetId === rule.id) {
        issues.push({
          code: "LCF-OVR-02",
          severity: "error",
          path: `rules.${rule.id}.overrides`,
          message: `Rule "${rule.id}" cannot override itself.`,
        });
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const detectCycle = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of overrideGraph.get(node) ?? []) {
      if (detectCycle(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const id of ruleIds) {
    if (detectCycle(id)) {
      issues.push({
        code: "LCF-OVR-03",
        severity: "error",
        path: `rules.${id}.overrides`,
        message: `Circular override cycle detected involving rule "${id}".`,
      });
      break;
    }
  }

  for (const out of doc.outputs ?? []) {
    if (!targetNames.has(out.target)) {
      issues.push({
        code: "LCF-OUT-01",
        severity: "error",
        path: `outputs.${out.id}`,
        message: `Output "${out.id}" references target "${out.target}" which no rule defines.`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
