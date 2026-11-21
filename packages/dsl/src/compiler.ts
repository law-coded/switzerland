import {
  validateLcfDocument,
  type Authority,
  type AuthorityKind,
  type AuthorityLevel,
  type BurdenOfProofSpec,
  type DeonticModality,
  type GoldenTestCase,
  type InputSpec,
  type LcfDocument,
  type LensSpec,
  type OutputSpec,
  type Rule,
  type RuleKind,
  type ValueType,
} from "../../core/src/index.ts";
import { formatLawExpr, parseLawExpr } from "./expr-parser.ts";

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  return t;
}

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function parseJsonOrPrimitive(raw: string): unknown {
  const t = raw.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]")) || (t.startsWith('"') && t.endsWith('"'))) {
    return JSON.parse(t);
  }
  return t;
}

/**
 * Compiles human-legible, Git-diffable literate `.law` source directly into a validated LCF 0.1 document.
 * Designed so senior lawyers can review and sign off on 100 lines of `.law` in minutes,
 * and AI auto-formalizers generate concise, low-error normative specifications.
 */
export function compileLawDsl(source: string): LcfDocument {
  const rawLines = source.split(/\r?\n/);

  // First pass: discover all rule targets so expression parser distinguishes targets vs inputs cleanly
  const knownTargets = new Set<string>();
  for (const line of rawLines) {
    const trimmed = line.trim();
    const rm = /^rule\s+[a-zA-Z0-9_-]+\s*->\s*([a-zA-Z0-9_-]+)/.exec(trimmed);
    if (rm) knownTargets.add(rm[1]!);
  }

  let slug = "untitled-law";
  let version = "0.1.0";
  let status: LcfDocument["metadata"]["status"] = "active";
  let jurisdictions: string[] = ["CH"];
  let languages: string[] = ["de", "fr", "it", "en"];
  let legalDomains: string[] = [];
  const title: Record<string, string> = {};
  const description: Record<string, string> = {};
  const pendingChanges: NonNullable<LcfDocument["metadata"]["pendingChanges"]> = [];

  const authorities: Record<string, Authority> = {};
  const inputs: Record<string, InputSpec> = {};
  const lenses: LensSpec[] = [];
  const rules: Rule[] = [];
  const outputs: OutputSpec[] = [];
  const tests: GoldenTestCase[] = [];

  type BlockContext =
    | { kind: "header" }
    | { kind: "authority"; id: string; obj: Authority }
    | { kind: "input"; name: string; obj: InputSpec }
    | { kind: "lens"; obj: LensSpec }
    | { kind: "rule"; obj: Rule }
    | { kind: "output"; obj: OutputSpec }
    | { kind: "test"; obj: GoldenTestCase };

  let ctx: BlockContext = { kind: "header" };

  for (let lineNo = 0; lineNo < rawLines.length; lineNo++) {
    const raw = rawLines[lineNo]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const indented = /^\s+/.test(raw);
    if (!indented) {
      // Top-level declaration
      const modMatch = /^module\s+([a-z0-9-]+)(?:\s*@\s*(\S+))?/.exec(trimmed);
      if (modMatch) {
        slug = modMatch[1]!;
        if (modMatch[2]) version = modMatch[2];
        ctx = { kind: "header" };
        continue;
      }

      const authMatch = /^authority\s+([a-zA-Z0-9_-]+)\s+\[([a-z_]+)\s*,\s*([A-Z0-9-]+)\]/.exec(trimmed);
      if (authMatch) {
        const id = authMatch[1]!;
        const obj: Authority = {
          kind: authMatch[2] as AuthorityKind,
          jurisdiction: authMatch[3]!,
          citation: {},
        };
        authorities[id] = obj;
        ctx = { kind: "authority", id, obj };
        continue;
      }

      const inpMatch = /^input\s+([a-zA-Z0-9_-]+)\s*:\s*([a-z]+)(?:\(([^)]+)\))?(\s+required)?/.exec(trimmed);
      if (inpMatch) {
        const name = inpMatch[1]!;
        const type = inpMatch[2] as ValueType;
        const enumRaw = inpMatch[3];
        const req = Boolean(inpMatch[4]);
        const obj: InputSpec = {
          type,
          label: {},
          required: req || undefined,
          enumValues: enumRaw ? splitCsv(enumRaw) : undefined,
        };
        inputs[name] = obj;
        ctx = { kind: "input", name, obj };
        continue;
      }

      const lensMatch = /^lens\s+([a-zA-Z0-9_-]+)(\s+default)?/.exec(trimmed);
      if (lensMatch) {
        const obj: LensSpec = {
          id: lensMatch[1]!,
          label: {},
          description: {},
          default: Boolean(lensMatch[2]) || undefined,
        };
        lenses.push(obj);
        ctx = { kind: "lens", obj };
        continue;
      }

      const ruleMatch = /^rule\s+([a-zA-Z0-9_-]+)\s*->\s*([a-zA-Z0-9_-]+)\s*\[([^\]]+)\]/.exec(trimmed);
      if (ruleMatch) {
        const metaParts = splitCsv(ruleMatch[3]!);
        const kind = (metaParts[0] ?? "base") as RuleKind;
        const ruleJurs: string[] = [];
        let authorityLevel: AuthorityLevel | undefined;
        let priority: number | undefined;
        const ruleLenses: string[] = [];

        for (let idx = 1; idx < metaParts.length; idx++) {
          const part = metaParts[idx]!;
          if (part.startsWith("prio ")) {
            priority = Number(part.slice(5).trim());
          } else if (part.startsWith("lens ")) {
            ruleLenses.push(part.slice(5).trim());
          } else if (
            ["supranational", "constitutional", "federal_statute", "federal_ordinance", "cantonal_statute", "municipal", "admin_directive", "judicial_precedent", "contractual"].includes(part)
          ) {
            authorityLevel = part as AuthorityLevel;
          } else {
            ruleJurs.push(part);
          }
        }

        const obj: Rule = {
          id: ruleMatch[1]!,
          target: ruleMatch[2]!,
          kind,
          label: {},
          authorities: [],
          scope: {
            jurisdictions: ruleJurs.length > 0 ? ruleJurs : undefined,
            authorityLevel,
            lenses: ruleLenses.length > 0 ? ruleLenses : undefined,
          },
          priority,
        };
        rules.push(obj);
        ctx = { kind: "rule", obj };
        continue;
      }

      const outMatch = /^output\s+([a-zA-Z0-9_-]+)\s*:\s*([a-z]+)(?:\s+\[([a-z_]+)\])?(\s+primary)?/.exec(trimmed);
      if (outMatch) {
        const id = outMatch[1]!;
        const obj: OutputSpec = {
          id,
          target: id,
          label: {},
          valueType: outMatch[2] as ValueType,
          modality: outMatch[3] as DeonticModality | undefined,
          primary: Boolean(outMatch[4]) || undefined,
        };
        outputs.push(obj);
        ctx = { kind: "output", obj };
        continue;
      }

      const testMatch = /^test\s+([a-zA-Z0-9_-]+)\s+"([^"]+)"/.exec(trimmed);
      if (testMatch) {
        const obj: GoldenTestCase = {
          id: testMatch[1]!,
          name: testMatch[2]!,
          inputs: {},
          expected: {},
        };
        tests.push(obj);
        ctx = { kind: "test", obj };
        continue;
      }

      // Header key: value lines at column 0
      const kv = /^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
      if (kv && ctx.kind === "header") {
        const k = kv[1]!;
        const v = kv[2]!.trim();
        if (k === "jurisdictions") jurisdictions = splitCsv(v);
        else if (k === "languages") languages = splitCsv(v);
        else if (k === "domains") legalDomains = splitCsv(v);
        else if (k === "status") status = v as LcfDocument["metadata"]["status"];
        else if (k.startsWith("title.")) title[k.slice(6)] = stripQuotes(v);
        else if (k.startsWith("description.")) description[k.slice(12)] = stripQuotes(v);
        else if (k === "pending_change") {
          const pm = /^(\d{4}-\d{2}-\d{2})\s+"([^"]+)"(?:\s+(\S+))?/.exec(v);
          if (pm) {
            pendingChanges.push({
              effectiveDate: pm[1]!,
              summary: { en: pm[2]!, de: pm[2]! },
              sourceUri: pm[3],
            });
          }
        }
        continue;
      }

      throw new Error(`Unrecognized top-level directive at line ${lineNo + 1}: "${trimmed}"`);
    }

    // Indented body line
    const kv = /^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!kv) {
      throw new Error(`Expected key: value at line ${lineNo + 1}: "${trimmed}"`);
    }
    const key = kv[1]!;
    const val = kv[2]!.trim();

    if (ctx.kind === "authority") {
      if (["de", "fr", "it", "rm", "en"].includes(key)) ctx.obj.citation[key] = stripQuotes(val);
      else if (key.startsWith("verbatim.")) {
        ctx.obj.verbatimText = ctx.obj.verbatimText ?? {};
        ctx.obj.verbatimText[key.slice(9)] = stripQuotes(val);
      } else if (key.startsWith("url.")) {
        ctx.obj.urls = ctx.obj.urls ?? {};
        ctx.obj.urls[key.slice(4)] = stripQuotes(val);
      } else if (key.startsWith("git.")) {
        ctx.obj.swisslawGitPath = ctx.obj.swisslawGitPath ?? {};
        ctx.obj.swisslawGitPath[key.slice(4)] = stripQuotes(val);
      } else if (key === "eli") ctx.obj.eli = stripQuotes(val);
      else if (key === "ecli") ctx.obj.ecli = stripQuotes(val);
      else if (key === "url") ctx.obj.url = stripQuotes(val);
      else if (key === "opencaselaw") ctx.obj.opencaselawId = stripQuotes(val);
      else if (key === "pinpoint") ctx.obj.pinpoint = stripQuotes(val);
      else if (key === "consolidation") ctx.obj.consolidationDate = stripQuotes(val);
      else if (key === "decision_date") ctx.obj.decisionDate = stripQuotes(val);
    } else if (ctx.kind === "input") {
      if (["de", "fr", "it", "rm", "en"].includes(key)) ctx.obj.label[key] = stripQuotes(val);
      else if (key === "default") ctx.obj.defaultValue = parseJsonOrPrimitive(val);
      else if (key === "burden") {
        // Format: party (factRole, "legalBasis") -> onUnknown
        const bm = /^([a-z_]+)\s*\(([a-z_]+)(?:\s*,\s*"([^"]+)")?\)\s*->\s*([a-z_]+)/.exec(val);
        if (bm) {
          ctx.obj.burdenOfProof = {
            party: bm[1] as BurdenOfProofSpec["party"],
            factRole: bm[2] as BurdenOfProofSpec["factRole"],
            legalBasis: bm[3],
            onUnknown: bm[4] as BurdenOfProofSpec["onUnknown"],
          };
        }
      }
    } else if (ctx.kind === "lens") {
      if (["de", "fr", "it", "rm", "en"].includes(key)) ctx.obj.label[key] = stripQuotes(val);
      else if (key.startsWith("desc.")) ctx.obj.description[key.slice(5)] = stripQuotes(val);
      else if (key === "cite") ctx.obj.authorities = splitCsv(val);
    } else if (ctx.kind === "rule") {
      if (["de", "fr", "it", "rm", "en"].includes(key)) ctx.obj.label[key] = stripQuotes(val);
      else if (key.startsWith("explain.")) {
        ctx.obj.explanation = ctx.obj.explanation ?? {};
        ctx.obj.explanation[key.slice(8)] = stripQuotes(val);
      } else if (key === "cite") ctx.obj.authorities = splitCsv(val);
      else if (key === "overrides") ctx.obj.overrides = splitCsv(val);
      else if (key === "valid_from") {
        ctx.obj.temporal = ctx.obj.temporal ?? { basis: "factDate" };
        ctx.obj.temporal.validFrom = stripQuotes(val);
      } else if (key === "valid_until") {
        ctx.obj.temporal = ctx.obj.temporal ?? { basis: "factDate" };
        ctx.obj.temporal.validUntil = stripQuotes(val);
      } else if (key === "when") {
        ctx.obj.when = parseLawExpr(val, knownTargets);
      } else if (key === "then") {
        ctx.obj.compute = parseLawExpr(val, knownTargets);
      }
    } else if (ctx.kind === "output") {
      if (["de", "fr", "it", "rm", "en"].includes(key)) ctx.obj.label[key] = stripQuotes(val);
      else if (key === "target") ctx.obj.target = val;
    } else if (ctx.kind === "test") {
      if (key === "authority") ctx.obj.authorityRef = val;
      else if (key === "context") ctx.obj.context = JSON.parse(val);
      else if (key === "inputs") ctx.obj.inputs = JSON.parse(val);
      else if (key === "expect") ctx.obj.expected = JSON.parse(val);
    }
  }

  const now = "2026-11-21T00:00:00Z";
  const doc: LcfDocument = {
    $format: "LCF",
    $specVersion: "0.1",
    metadata: {
      id: `urn:law-coded:dsl:${slug}:${version}`,
      slug,
      version,
      status,
      title: Object.keys(title).length > 0 ? title : { en: slug },
      description: Object.keys(description).length > 0 ? description : undefined,
      jurisdictions,
      languages,
      legalDomains: legalDomains.length > 0 ? legalDomains : undefined,
      created: now,
      modified: now,
      license: "Apache-2.0",
      pendingChanges: pendingChanges.length > 0 ? pendingChanges : undefined,
    },
    authorities,
    inputs,
    lenses: lenses.length > 0 ? lenses : undefined,
    rules,
    outputs,
    tests: tests.length > 0 ? tests : undefined,
  };

  const check = validateLcfDocument(doc);
  if (!check.valid) {
    throw new Error(
      `Compiled .law DSL failed LCF 0.1 validation:\n${check.errors.map((e) => `- [${e.code}] ${e.path}: ${e.message}`).join("\n")}`,
    );
  }
  return doc;
}

/**
 * Pretty-prints an LCF 0.1 document into clean, lawyer-readable `.law` DSL source.
 */
export function decompileToLawDsl(doc: LcfDocument): string {
  const lines: string[] = [];
  lines.push(`module ${doc.metadata.slug} @ ${doc.metadata.version}`);
  lines.push(`jurisdictions: ${doc.metadata.jurisdictions.join(", ")}`);
  lines.push(`languages: ${doc.metadata.languages.join(", ")}`);
  if (doc.metadata.legalDomains?.length) lines.push(`domains: ${doc.metadata.legalDomains.join(", ")}`);
  for (const [l, t] of Object.entries(doc.metadata.title)) lines.push(`title.${l}: ${JSON.stringify(t)}`);
  lines.push("");

  for (const [id, auth] of Object.entries(doc.authorities)) {
    lines.push(`authority ${id} [${auth.kind}, ${auth.jurisdiction}]`);
    for (const [l, c] of Object.entries(auth.citation)) lines.push(`  ${l}: ${JSON.stringify(c)}`);
    if (auth.eli) lines.push(`  eli: ${JSON.stringify(auth.eli)}`);
    if (auth.url) lines.push(`  url: ${JSON.stringify(auth.url)}`);
    if (auth.swisslawGitPath) {
      for (const [l, p] of Object.entries(auth.swisslawGitPath)) lines.push(`  git.${l}: ${JSON.stringify(p)}`);
    }
    lines.push("");
  }

  for (const [name, inp] of Object.entries(doc.inputs)) {
    const enumPart = inp.enumValues ? `(${inp.enumValues.join(", ")})` : "";
    const reqPart = inp.required ? " required" : "";
    lines.push(`input ${name}: ${inp.type}${enumPart}${reqPart}`);
    for (const [l, t] of Object.entries(inp.label)) lines.push(`  ${l}: ${JSON.stringify(t)}`);
    if (inp.defaultValue !== undefined) lines.push(`  default: ${JSON.stringify(inp.defaultValue)}`);
    lines.push("");
  }

  for (const lens of doc.lenses ?? []) {
    lines.push(`lens ${lens.id}${lens.default ? " default" : ""}`);
    for (const [l, t] of Object.entries(lens.label)) lines.push(`  ${l}: ${JSON.stringify(t)}`);
    for (const [l, d] of Object.entries(lens.description)) lines.push(`  desc.${l}: ${JSON.stringify(d)}`);
    lines.push("");
  }

  for (const rule of doc.rules) {
    const tags: string[] = [rule.kind];
    if (rule.scope?.jurisdictions?.length) tags.push(...rule.scope.jurisdictions);
    if (rule.scope?.authorityLevel) tags.push(rule.scope.authorityLevel);
    if (rule.priority !== undefined) tags.push(`prio ${rule.priority}`);
    for (const l of rule.scope?.lenses ?? []) tags.push(`lens ${l}`);
    lines.push(`rule ${rule.id} -> ${rule.target} [${tags.join(", ")}]`);
    for (const [l, t] of Object.entries(rule.label)) lines.push(`  ${l}: ${JSON.stringify(t)}`);
    lines.push(`  cite: ${rule.authorities.join(", ")}`);
    if (rule.overrides?.length) lines.push(`  overrides: ${rule.overrides.join(", ")}`);
    if (rule.temporal?.validFrom) lines.push(`  valid_from: ${rule.temporal.validFrom}`);
    if (rule.temporal?.validUntil) lines.push(`  valid_until: ${rule.temporal.validUntil}`);
    if (rule.when) lines.push(`  when: ${formatLawExpr(rule.when)}`);
    if (rule.compute) lines.push(`  then: ${formatLawExpr(rule.compute)}`);
    lines.push("");
  }

  for (const out of doc.outputs) {
    const mod = out.modality ? ` [${out.modality}]` : "";
    lines.push(`output ${out.id}: ${out.valueType}${mod}${out.primary ? " primary" : ""}`);
    for (const [l, t] of Object.entries(out.label)) lines.push(`  ${l}: ${JSON.stringify(t)}`);
  }

  return lines.join("\n");
}
