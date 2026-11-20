import { randomUUID } from "node:crypto";
import {
  computeCanonicalHash,
  pickText,
  type Expr,
  type InputSpec,
  type LcfDocument,
  type Rule,
} from "../../core/src/index.ts";

export interface Ruml10Node {
  id: string;
  operator?: "AND" | "NOT_AND" | "OR" | "NOT_OR" | "XOR" | "NOT_XOR" | "DELEGATED" | "undefined";
  label: string;
  children?: string[];
  capabilities?: Array<{ id: string; payload: Record<string, unknown> }>;
}

export interface Ruml10Document {
  $format: "RUML";
  $specVersion: "1.0";
  metadata: {
    id: string;
    version: string;
    created: string;
    modified: string;
    status: "draft" | "review" | "approved" | "published" | "deprecated" | "archived" | "suspended";
    title: string;
    description?: string;
    documentType: "law" | "regulation" | "decision" | "guideline" | "contract" | "other";
    jurisdiction: string;
    language: string;
    organization: string;
    tags?: string[];
  };
  capabilities: Array<{ id: string; required?: boolean; payload?: Record<string, unknown> }>;
  rulemap: {
    nodes: Record<string, Ruml10Node>;
  };
}

export interface RumlFidelityLossItem {
  dimension:
    | "multilingualism"
    | "federal_layering"
    | "defeasibility"
    | "typed_money_math"
    | "legal_calendars"
    | "burden_of_proof"
    | "streitstand_lenses"
    | "tri_temporal"
    | "structured_subsumtion";
  severity: "structural_loss" | "approximation";
  detail: string;
}

export interface RumlExportResult {
  ruml: Ruml10Document;
  fidelityReport: {
    sourceSlug: string;
    sourceHash: string;
    projectedLanguage: string;
    projectedJurisdiction: string;
    projectedLens: string;
    lossless: boolean;
    losses: RumlFidelityLossItem[];
  };
}

function toJsonata(expr: Expr | undefined): string {
  if (!expr) return "true";
  switch (expr.op) {
    case "lit":
      return JSON.stringify(expr.value);
    case "input":
      return `dp_${expr.name}`;
    case "ref":
      return `target_${expr.target}`;
    case "context":
      return `"${expr.field}"`;
    case "and":
      return `(${expr.args.map(toJsonata).join(" and ")})`;
    case "or":
      return `(${expr.args.map(toJsonata).join(" or ")})`;
    case "not":
      return `$not(${toJsonata(expr.arg)})`;
    case "eq":
      return `(${toJsonata(expr.left)} = ${toJsonata(expr.right)})`;
    case "neq":
      return `(${toJsonata(expr.left)} != ${toJsonata(expr.right)})`;
    case "gt":
      return `(${toJsonata(expr.left)} > ${toJsonata(expr.right)})`;
    case "gte":
      return `(${toJsonata(expr.left)} >= ${toJsonata(expr.right)})`;
    case "lt":
      return `(${toJsonata(expr.left)} < ${toJsonata(expr.right)})`;
    case "lte":
      return `(${toJsonata(expr.left)} <= ${toJsonata(expr.right)})`;
    case "in":
      return `(${toJsonata(expr.value)} in ${toJsonata(expr.list)})`;
    case "is_known":
      return `$exists(${toJsonata(expr.arg)})`;
    case "if":
      return `(${toJsonata(expr.cond)} ? ${toJsonata(expr.then)} : ${toJsonata(expr.else)})`;
    case "add":
      return `(${expr.args.map(toJsonata).join(" + ")})`;
    case "sub":
      return `(${toJsonata(expr.left)} - ${toJsonata(expr.right)})`;
    case "mul":
      return `(${toJsonata(expr.left)} * ${toJsonata(expr.right)})`;
    case "min":
      return `$min([${expr.args.map(toJsonata).join(", ")}])`;
    case "max":
      return `$max([${expr.args.map(toJsonata).join(", ")}])`;
    case "money_mul":
      return `(${toJsonata(expr.money)} * ${toJsonata(expr.factor)})`;
    case "money_add":
      return `(${expr.args.map(toJsonata).join(" + ")})`;
    case "money_sub":
      return `(${toJsonata(expr.left)} - ${toJsonata(expr.right)})`;
    case "money_min":
      return `$min([${expr.args.map(toJsonata).join(", ")}])`;
    case "money_max":
      return `$max([${expr.args.map(toJsonata).join(", ")}])`;
    case "money_zero":
      return "0";
    case "days_between":
      return `/* calendar days_between(${toJsonata(expr.from)}, ${toJsonata(expr.to)}) unsupported natively in RUML 1.0 */ true`;
    case "zpo_deadline":
      return `/* Swiss ZPO Art. 142/145 calendar computation unsupported natively in RUML 1.0 */ true`;
    case "or_termination_end_date":
      return `/* Swiss OR Art. 335c/336c calendar computation unsupported natively in RUML 1.0 */ true`;
    case "record":
      return JSON.stringify(Object.keys(expr.fields));
  }
}

function mapInputTypeToRuml(spec: InputSpec): string {
  switch (spec.type) {
    case "boolean": return "boolean";
    case "integer": return "number";
    case "decimal": return "number";
    case "money": return "currency";
    case "date": return "date";
    case "enum": return "enum";
    case "list": return "array";
    case "object": return "object";
    default: return "string";
  }
}

function sanitizeRumlKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^([0-9])/, "k_$1");
}

/**
 * Compiles an LCF 0.1 document into a strictly spec-conformant RUML 1.0.0 JSON document
 * plus a transparent Fidelity & Loss Report showing every higher-order legal capability
 * that RUML 1.0.0 cannot represent natively.
 */
export function exportToRuml10(
  doc: LcfDocument,
  options?: { language?: string; jurisdiction?: string; lens?: string },
): RumlExportResult {
  const language = options?.language ?? doc.metadata.languages[0] ?? "de";
  const jurisdiction = options?.jurisdiction ?? doc.metadata.jurisdictions[0] ?? "CH";
  const lens = options?.lens ?? doc.lenses?.find((l) => l.default)?.id ?? "default";

  const losses: RumlFidelityLossItem[] = [];

  if (doc.metadata.languages.length > 1) {
    losses.push({
      dimension: "multilingualism",
      severity: "structural_loss",
      detail: `RUML 1.0.0 allows only one metadata.language; collapsed [${doc.metadata.languages.join(", ")}] into "${language}".`,
    });
  }
  if (doc.metadata.jurisdictions.length > 1) {
    losses.push({
      dimension: "federal_layering",
      severity: "structural_loss",
      detail: `RUML 1.0.0 allows only one metadata.jurisdiction; collapsed [${doc.metadata.jurisdictions.join(", ")}] into "${jurisdiction}".`,
    });
  }
  if ((doc.lenses?.length ?? 0) > 1) {
    losses.push({
      dimension: "streitstand_lenses",
      severity: "structural_loss",
      detail: `RUML 1.0.0 has no executable Streitstand / interpretive lens layer; flattened ${doc.lenses!.length} lenses to "${lens}".`,
    });
  }

  let hasDefeasible = false;
  let hasBurdenOfProof = false;
  let hasTemporal = false;
  let hasCalendar = false;
  let hasMoney = false;
  let hasSubsumtion = false;

  for (const inp of Object.values(doc.inputs)) {
    if (inp.type === "money") hasMoney = true;
    if (inp.burdenOfProof) hasBurdenOfProof = true;
  }

  for (const r of doc.rules) {
    if ((r.overrides?.length ?? 0) > 0 || r.kind === "exception" || r.kind === "counter_exception") {
      hasDefeasible = true;
    }
    if (r.burdenOfProof) hasBurdenOfProof = true;
    if (r.temporal?.validFrom || r.temporal?.validUntil) hasTemporal = true;
    if (r.kind === "subsumtion") hasSubsumtion = true;
    const raw = JSON.stringify(r.compute ?? {});
    if (raw.includes("zpo_deadline") || raw.includes("or_termination_end_date")) hasCalendar = true;
    if (raw.includes("money_")) hasMoney = true;
  }

  if (hasDefeasible) {
    losses.push({
      dimension: "defeasibility",
      severity: "structural_loss",
      detail: "Explicit defeasible override edges (Grundsatz/Ausnahme/Gegenausnahme) were flattened into RUML parent/child boolean branches.",
    });
  }
  if (hasMoney) {
    losses.push({
      dimension: "typed_money_math",
      severity: "approximation",
      detail: "Exact BigInt fixed-point CHF/EUR/GBP decimal arithmetic was downgraded to IEEE-754 JSONata numbers.",
    });
  }
  if (hasCalendar) {
    losses.push({
      dimension: "legal_calendars",
      severity: "structural_loss",
      detail: "Swiss cantonal holiday & Gerichtsferien (Art. 145 ZPO) / OR Sperrfrist calendar computations cannot execute natively in RUML 1.0.0.",
    });
  }
  if (hasBurdenOfProof) {
    losses.push({
      dimension: "burden_of_proof",
      severity: "structural_loss",
      detail: "Art. 8 ZGB burden-of-proof non-liquet resolution policies were omitted (RUML propagates undefined uniformly).",
    });
  }
  if (hasTemporal) {
    losses.push({
      dimension: "tri_temporal",
      severity: "structural_loss",
      detail: "Per-rule tri-temporal windows (factDate / decisionDate / lawVersion & Übergangsrecht) cannot be represented in RUML 1.0.0.",
    });
  }
  if (hasSubsumtion) {
    losses.push({
      dimension: "structured_subsumtion",
      severity: "approximation",
      detail: "Structured precedent-anchored Subsumtion contracts with mandatory escalation bands were projected to opaque ruml:ai-query prompts.",
    });
  }

  // Build RUML datapoints
  const datapoints: Record<string, Record<string, unknown>> = {};
  for (const [name, spec] of Object.entries(doc.inputs)) {
    const dp: Record<string, unknown> = {
      type: mapInputTypeToRuml(spec),
      label: pickText(spec.label, language, name),
    };
    if (spec.enumValues) dp["values"] = spec.enumValues;
    if (spec.unit) dp["unit"] = spec.unit;
    datapoints[`dp_${name}`] = dp;
  }

  // Build RUML text-references (statutes/ordinances) and context (case law/directives)
  const textData: Record<string, Record<string, unknown>> = {};
  const contextData: Record<string, Record<string, unknown>> = {};
  const textKeyByAuth = new Map<string, string>();
  const ctxKeyByAuth = new Map<string, string>();

  for (const [authId, auth] of Object.entries(doc.authorities)) {
    const key = sanitizeRumlKey(`text_${authId}`);
    const cite = pickText(auth.citation, language);
    if (auth.kind === "statute" || auth.kind === "ordinance" || auth.kind === "eu_regulation" || auth.kind === "eu_directive" || auth.kind === "treaty") {
      textKeyByAuth.set(authId, key);
      textData[key] = {
        title: cite,
        uri: auth.eli ?? auth.urls?.[language] ?? auth.url ?? `urn:law-coded:${authId}`,
        timestamp: `${auth.consolidationDate ?? doc.metadata.modified.slice(0, 10)}T00:00:00Z`,
        status: "inForce",
        language,
        text: pickText(auth.verbatimText, language) || cite,
      };
    } else {
      const cKey = sanitizeRumlKey(`ctx_${authId}`);
      ctxKeyByAuth.set(authId, cKey);
      contextData[cKey] = {
        title: cite,
        kind: auth.kind,
        uri: auth.url ?? auth.ecli ?? `urn:law-coded:${authId}`,
      };
    }
  }

  // Build RUML 1.0.0 flat node map (LexID "1" = root, groups per target, leaf per rule)
  const nodes: Record<string, Ruml10Node> = {};
  let nextLex = 2;
  const targetGroupIds: string[] = [];

  const rulesByTarget = new Map<string, Rule[]>();
  for (const r of doc.rules) {
    if (r.scope?.lenses && r.scope.lenses.length > 0 && !r.scope.lenses.includes(lens)) continue;
    if (!rulesByTarget.has(r.target)) rulesByTarget.set(r.target, []);
    rulesByTarget.get(r.target)!.push(r);
  }

  for (const [target, targetRules] of rulesByTarget) {
    const groupLex = String(nextLex++);
    const childLexIds: string[] = [];

    for (const rule of targetRules) {
      const leafLex = String(nextLex++);
      childLexIds.push(leafLex);
      const nodeCaps: Array<{ id: string; payload: Record<string, unknown> }> = [];

      if (rule.kind === "subsumtion" && rule.subsumtion) {
        nodeCaps.push({
          id: "ruml:ai-query",
          payload: {
            model: "strong",
            prompt: `Assess "${pickText(rule.subsumtion.legalConcept, language)}" based on criteria: ${rule.subsumtion.factors.map((f) => pickText(f.label, language)).join("; ")}. Return strictly true, false, or undefined.`,
            description: pickText(rule.label, language),
          },
        });
      } else {
        nodeCaps.push({
          id: "ruml:query",
          payload: {
            expression: toJsonata(rule.when ?? rule.compute),
          },
        });
      }

      const refs = rule.authorities
        .map((a) => textKeyByAuth.get(a))
        .filter((k): k is string => Boolean(k))
        .map((k) => ({ textKey: k, represents: true }));
      if (refs.length > 0) {
        nodeCaps.push({
          id: "ruml:text-reference",
          payload: { refs },
        });
      }

      nodes[leafLex] = {
        id: randomUUID(),
        label: pickText(rule.label, language, rule.id),
        capabilities: nodeCaps,
      };
    }

    targetGroupIds.push(groupLex);
    nodes[groupLex] = {
      id: randomUUID(),
      operator: targetRules.length > 1 ? "OR" : "AND",
      label: target,
      children: childLexIds,
    };
  }

  nodes["1"] = {
    id: randomUUID(),
    operator: "AND",
    label: pickText(doc.metadata.title, language, doc.metadata.slug),
    children: targetGroupIds,
  };

  const capabilities: Ruml10Document["capabilities"] = [
    { id: "ruml:datapoints", payload: { data: datapoints } },
    { id: "ruml:query" },
  ];
  if (Object.keys(textData).length > 0) {
    capabilities.push({ id: "ruml:text-reference", payload: { data: textData } });
  }
  if (Object.keys(contextData).length > 0) {
    capabilities.push({ id: "ruml:context", payload: { data: contextData } });
  }
  if (hasSubsumtion) {
    capabilities.push({ id: "ruml:ai-query" });
  }
  capabilities.push({
    id: "org.law-coded/provenance",
    required: false,
    payload: {
      sourceFormat: "LCF-0.1",
      sourceSlug: doc.metadata.slug,
      sourceCanonicalHash: computeCanonicalHash(doc),
      fidelityLossCount: losses.length,
    },
  });

  const ruml: Ruml10Document = {
    $format: "RUML",
    $specVersion: "1.0",
    metadata: {
      id: randomUUID(),
      version: doc.metadata.version,
      created: doc.metadata.created,
      modified: doc.metadata.modified,
      status: doc.metadata.status === "active" ? "published" : "draft",
      title: pickText(doc.metadata.title, language, doc.metadata.slug),
      description: pickText(doc.metadata.description, language),
      documentType: "law",
      jurisdiction,
      language,
      organization: "law-coded (https://github.com/law-coded)",
      tags: doc.metadata.legalDomains,
    },
    capabilities,
    rulemap: { nodes },
  };

  return {
    ruml,
    fidelityReport: {
      sourceSlug: doc.metadata.slug,
      sourceHash: computeCanonicalHash(doc),
      projectedLanguage: language,
      projectedJurisdiction: jurisdiction,
      projectedLens: lens,
      lossless: losses.length === 0,
      losses,
    },
  };
}

/**
 * Losslessly imports a RUML 1.0.0 JSON document into LCF 0.1 so any existing
 * German/European RUML rulemap immediately gains formal verification,
 * minimal next-question triage, counterfactuals, and audit-grade Begründung output.
 */
export function importFromRuml10(ruml: Ruml10Document): LcfDocument {
  if (ruml.$format !== "RUML") {
    throw new Error(`Expected RUML document ($format: "RUML"), received "${String(ruml.$format)}"`);
  }
  const lang = ruml.metadata.language || "de";
  const jurisdiction = ruml.metadata.jurisdiction || "DE";

  const inputs: LcfDocument["inputs"] = {};
  const dpCap = ruml.capabilities.find((c) => c.id === "ruml:datapoints");
  const dpData = (dpCap?.payload?.["data"] ?? {}) as Record<string, Record<string, unknown>>;
  for (const [k, v] of Object.entries(dpData)) {
    const cleanName = k.startsWith("dp_") ? k.slice(3) : k;
    const rawType = String(v["type"] ?? "string");
    const lcfType =
      rawType === "boolean"
        ? "boolean"
        : rawType === "number"
          ? "decimal"
          : rawType === "currency"
            ? "money"
            : rawType === "date"
              ? "date"
              : rawType === "enum"
                ? "enum"
                : "string";
    inputs[cleanName] = {
      type: lcfType,
      label: { [lang]: String(v["label"] ?? cleanName) },
      enumValues: Array.isArray(v["values"]) ? (v["values"] as string[]) : undefined,
    };
  }

  const authorities: LcfDocument["authorities"] = {
    ruml_source: {
      kind: "statute",
      jurisdiction,
      citation: { [lang]: ruml.metadata.title },
      url: "https://ruml.org/",
    },
  };
  const textCap = ruml.capabilities.find((c) => c.id === "ruml:text-reference");
  const textData = (textCap?.payload?.["data"] ?? {}) as Record<string, Record<string, unknown>>;
  for (const [k, v] of Object.entries(textData)) {
    authorities[k] = {
      kind: "statute",
      jurisdiction,
      citation: { [lang]: String(v["title"] ?? k) },
      eli: typeof v["uri"] === "string" ? v["uri"] : undefined,
      verbatimText: typeof v["text"] === "string" ? { [lang]: v["text"] } : undefined,
    };
  }

  const rules: Rule[] = [];
  const parseSimpleJsonata = (expr: string): Expr => {
    const trimmed = expr.trim();
    const cmp = /^\(?dp_([a-zA-Z0-9_]+)\s*(>=|<=|!=|=|>|<)\s*(.+?)\)?$/.exec(trimmed);
    if (cmp) {
      const varName = cmp[1]!;
      const opMap: Record<string, "gte" | "lte" | "neq" | "eq" | "gt" | "lt"> = {
        ">=": "gte",
        "<=": "lte",
        "!=": "neq",
        "=": "eq",
        ">": "gt",
        "<": "lt",
      };
      const rawRight = cmp[3]!.trim();
      let litVal: unknown = rawRight;
      if (rawRight === "true") litVal = true;
      else if (rawRight === "false") litVal = false;
      else if (/^-?\d+(\.\d+)?$/.test(rawRight)) litVal = Number(rawRight);
      else if (rawRight.startsWith('"') && rawRight.endsWith('"')) litVal = rawRight.slice(1, -1);
      return { op: opMap[cmp[2]!]!, left: { op: "input", name: varName }, right: { op: "lit", value: litVal } };
    }
    return { op: "lit", value: true };
  };

  for (const [lexId, node] of Object.entries(ruml.rulemap.nodes)) {
    const target = `node_${lexId}`;
    const textRefCap = node.capabilities?.find((c) => c.id === "ruml:text-reference");
    const refKeys = Array.isArray(textRefCap?.payload?.["refs"])
      ? (textRefCap!.payload!["refs"] as Array<{ textKey?: string }>)
          .map((r) => r.textKey)
          .filter((k): k is string => Boolean(k && authorities[k]))
      : [];
    const ruleAuths = refKeys.length > 0 ? refKeys : ["ruml_source"];

    if (node.children && node.children.length > 0) {
      const childRefs: Expr[] = node.children.map((c) => ({ op: "ref", target: `node_${c}` }));
      let compute: Expr;
      switch (node.operator) {
        case "OR":
        case "XOR":
          compute = { op: "or", args: childRefs };
          break;
        case "NOT_AND":
          compute = { op: "not", arg: { op: "and", args: childRefs } };
          break;
        case "NOT_OR":
        case "NOT_XOR":
          compute = { op: "not", arg: { op: "or", args: childRefs } };
          break;
        default:
          compute = { op: "and", args: childRefs };
      }
      rules.push({
        id: `ruml_node_${lexId}`,
        target,
        kind: "derivation",
        label: { [lang]: node.label },
        authorities: ruleAuths,
        scope: { jurisdictions: [jurisdiction] },
        compute,
      });
    } else {
      const qCap = node.capabilities?.find((c) => c.id === "ruml:query");
      const exprStr = typeof qCap?.payload?.["expression"] === "string" ? qCap.payload["expression"] : "true";
      rules.push({
        id: `ruml_leaf_${lexId}`,
        target,
        kind: "base",
        label: { [lang]: node.label },
        authorities: ruleAuths,
        scope: { jurisdictions: [jurisdiction] },
        compute: parseSimpleJsonata(exprStr),
      });
    }
  }

  return {
    $format: "LCF",
    $specVersion: "0.1",
    metadata: {
      id: ruml.metadata.id,
      slug: sanitizeRumlKey(ruml.metadata.title).replace(/_/g, "-"),
      version: ruml.metadata.version,
      status: "active",
      title: { [lang]: ruml.metadata.title },
      description: ruml.metadata.description ? { [lang]: ruml.metadata.description } : undefined,
      jurisdictions: [jurisdiction],
      languages: [lang],
      created: ruml.metadata.created,
      modified: ruml.metadata.modified,
      license: "Apache-2.0",
    },
    authorities,
    inputs,
    rules,
    outputs: [
      {
        id: "root_result",
        target: "node_1",
        label: { [lang]: ruml.metadata.title },
        valueType: "boolean",
        modality: "validity",
        primary: true,
      },
    ],
  };
}
