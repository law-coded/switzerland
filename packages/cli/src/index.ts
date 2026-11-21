#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  validateLcfDocument,
  type EvaluationContext,
  type LcfDocument,
} from "../../core/src/index.ts";
import {
  diffLenses,
  evaluateDocument,
  findCounterfactuals,
  findMinimalNextQuestions,
  generateBegruendung,
  verifyDocument,
} from "../../engine/src/index.ts";
import {
  exportToRuml10,
  importFromRuml10,
  type Ruml10Document,
} from "../../ruml-bridge/src/index.ts";
import {
  detectAmendmentDrift,
  mapSwissLawGitDiffToRules,
} from "../../grounding/src/index.ts";
import { compileLawDsl, decompileToLawDsl } from "../../dsl/src/index.ts";
import { findStructuringLevers, proveDocument } from "../../prover/src/index.ts";
import { runCegarVerificationGate, type RealCourtCaseRecord } from "../../cegar/src/index.ts";
import {
  adviseMultiRegime,
  evaluateEnterprisePortfolio,
  type ClientFactGraph,
  type OrganizationDigitalTwin,
} from "../../enterprise/src/index.ts";

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(resolve(filePath), "utf8")) as T;
}

function loadLcfOrLaw(filePath: string): LcfDocument {
  const full = resolve(filePath);
  if (full.endsWith(".law")) {
    return compileLawDsl(readFileSync(full, "utf8"));
  }
  return JSON.parse(readFileSync(full, "utf8")) as LcfDocument;
}

function findCorpusFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findCorpusFiles(full));
    } else if (entry.endsWith(".lcf.json") || entry.endsWith(".law")) {
      out.push(full);
    }
  }
  return out;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function buildContext(flags: Record<string, string>): Partial<EvaluationContext> {
  const ctx: Partial<EvaluationContext> = {};
  if (flags["jurisdiction"]) ctx.jurisdiction = flags["jurisdiction"];
  if (flags["lang"]) ctx.language = flags["lang"];
  if (flags["fact-date"]) ctx.factDate = flags["fact-date"];
  if (flags["decision-date"]) ctx.decisionDate = flags["decision-date"];
  if (flags["law-version"]) ctx.lawVersion = flags["law-version"];
  if (flags["lens"]) ctx.lens = flags["lens"];
  if (flags["mode"] === "triage" || flags["mode"] === "adjudicate") ctx.mode = flags["mode"];
  return ctx;
}

function printHelp(): void {
  console.log(`law-coded CLI (LCF 0.1)

Commands:
  validate <file.lcf.json>                                  Validate LCF 0.1 structure & rules
  verify <file.lcf.json>                                    Run Digitalcheck verifier + golden court tests
  verify-all [corpusDir]                                    Verify every .lcf.json package in corpus/
  eval <file.lcf.json> --inputs '<json>' [ctx flags]        Evaluate rules & print LCF-Result JSON
  explain <file.lcf.json> --inputs '<json>' [ctx flags]     Generate multilingual Begründung memo
  diff-lenses <file.lcf.json> --inputs '<json>' [ctx flags] Compare outcomes across Streitstand lenses
  counterfactual <file.lcf.json> --inputs '<json>' [flags]  Find minimal factual flips
  next-questions <file.lcf.json> --inputs '<json>' [flags]  Minimal triage next-question solver
  export-ruml <file.lcf.json|file.law> [--lang de]          Compile to RUML 1.0.0 + Fidelity Report
  import-ruml <file.ruml>                                   Import RUML 1.0.0 JSON into LCF 0.1
  compile-dsl <file.law>                                    Compile literate .law DSL to LCF 0.1 JSON
  decompile-dsl <file.lcf.json>                             Decompile LCF 0.1 JSON to literate .law DSL
  prove <file.lcf.json|file.law>                            Run formal symbolic proof kernel (conflicts, coverage, cliffs)
  structuring <file> --inputs '<json>' --target <id> --want '<json>'  Find lawful structuring levers
  cegar <file> --cases <bge-replay.json>                    Run CEGAR formal + real court replay verification gate
  advise-enterprise <file> --twin <org.json> --inputs '<json>'  Evaluate multinational organization Digital Twin
  advise-multi [corpusDir] --twin <org.json> --facts <fg.json>  Cross-regime issue spotter + sovereign conflict + Living Advice
  drift <file.lcf.json|file.law> [--as-of YYYY-MM-DD]       Check Fedlex / swisslaw-git drift

Context flags: --jurisdiction CH-ZH --lang de|fr|it|en --fact-date YYYY-MM-DD --lens <id> --mode adjudicate|triage`);
}

function main(): void {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  const { positional, flags } = parseFlags(rest);

  switch (cmd) {
    case "validate": {
      const doc = loadLcfOrLaw(positional[0]!);
      const res = validateLcfDocument(doc);
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exit(1);
      return;
    }
    case "verify": {
      const doc = loadLcfOrLaw(positional[0]!);
      const rep = verifyDocument(doc);
      console.log(JSON.stringify(rep, null, 2));
      if (!rep.structuralValid) process.exit(1);
      return;
    }
    case "verify-all": {
      const root = resolve(positional[0] ?? "corpus");
      const files = findCorpusFiles(root);
      let allOk = true;
      for (const f of files) {
        const doc = loadLcfOrLaw(f);
        const rep = verifyDocument(doc);
        const status = rep.structuralValid ? "PASS" : "FAIL";
        console.log(
          `[${status}] ${rep.documentSlug}@${rep.documentVersion} | Digitalcheck ${rep.readinessScore}/100 | i18n ${rep.checks.multilingualCoveragePercent}% | grounding ${rep.checks.authorityGroundingPercent}% | golden tests ${rep.checks.goldenTestsPassed}/${rep.checks.goldenTestsTotal}`,
        );
        if (!rep.structuralValid) {
          allOk = false;
          console.error(JSON.stringify({ errors: rep.errors, failedTests: rep.goldenTestResults.filter((t) => !t.passed) }, null, 2));
        }
      }
      if (!allOk) process.exit(1);
      return;
    }
    case "eval": {
      const doc = loadLcfOrLaw(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      const res = evaluateDocument(doc, inputs, buildContext(flags));
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    case "explain": {
      const doc = loadLcfOrLaw(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      const res = evaluateDocument(doc, inputs, buildContext(flags));
      console.log(generateBegruendung(doc, res));
      return;
    }
    case "diff-lenses": {
      const doc = loadLcfOrLaw(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      const diff = diffLenses(doc, inputs, buildContext(flags));
      console.log(JSON.stringify({
        lensesEvaluated: diff.lensesEvaluated,
        hasDivergence: diff.hasDivergence,
        divergingOutputs: diff.divergingOutputs,
      }, null, 2));
      return;
    }
    case "counterfactual": {
      const doc = loadLcfOrLaw(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      console.log(JSON.stringify(findCounterfactuals(doc, inputs, buildContext(flags)), null, 2));
      return;
    }
    case "next-questions": {
      const doc = loadLcfOrLaw(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      console.log(JSON.stringify(findMinimalNextQuestions(doc, inputs, buildContext(flags)), null, 2));
      return;
    }
    case "export-ruml": {
      const doc = loadLcfOrLaw(positional[0]!);
      const exported = exportToRuml10(doc, {
        language: flags["lang"],
        jurisdiction: flags["jurisdiction"],
        lens: flags["lens"],
      });
      console.log(JSON.stringify(exported, null, 2));
      return;
    }
    case "import-ruml": {
      const ruml = loadJson<Ruml10Document>(positional[0]!);
      console.log(JSON.stringify(importFromRuml10(ruml), null, 2));
      return;
    }
    case "compile-dsl": {
      const doc = compileLawDsl(readFileSync(resolve(positional[0]!), "utf8"));
      console.log(JSON.stringify(doc, null, 2));
      return;
    }
    case "decompile-dsl": {
      const doc = loadLcfOrLaw(positional[0]!);
      console.log(decompileToLawDsl(doc));
      return;
    }
    case "prove": {
      const doc = loadLcfOrLaw(positional[0]!);
      const cert = proveDocument(doc);
      console.log(JSON.stringify(cert, null, 2));
      if (cert.soundnessVerdict !== "PROVEN_SOUND") process.exit(1);
      return;
    }
    case "structuring": {
      const doc = loadLcfOrLaw(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      const target = flags["target"] ?? doc.outputs[0]!.id;
      const want = flags["want"] ? JSON.parse(flags["want"]) : true;
      console.log(JSON.stringify(findStructuringLevers(doc, inputs, buildContext(flags), target, want), null, 2));
      return;
    }
    case "cegar": {
      const doc = loadLcfOrLaw(positional[0]!);
      const cases = loadJson<RealCourtCaseRecord[]>(flags["cases"]!);
      const packet = runCegarVerificationGate(doc, cases);
      console.log(JSON.stringify(packet, null, 2));
      if (packet.status !== "CONVERGED") process.exit(1);
      return;
    }
    case "advise-enterprise": {
      const doc = loadLcfOrLaw(positional[0]!);
      const twin = loadJson<OrganizationDigitalTwin>(flags["twin"]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      const dossier = evaluateEnterprisePortfolio(twin, doc, inputs, {
        factDate: flags["fact-date"],
        futureDate: flags["future-date"],
        language: flags["lang"],
        lens: flags["lens"],
      });
      console.log(flags["format"] === "markdown" ? dossier.executiveMemoMarkdown : JSON.stringify(dossier, null, 2));
      return;
    }
    case "advise-multi": {
      const root = resolve(positional[0] ?? "corpus");
      const mods = findCorpusFiles(root).map((f) => loadLcfOrLaw(f));
      const twin = loadJson<OrganizationDigitalTwin>(flags["twin"]!);
      const factGraph = loadJson<ClientFactGraph>(flags["facts"]!);
      const report = adviseMultiRegime(twin, mods, factGraph, {
        factDate: flags["fact-date"],
        futureDate: flags["future-date"],
        language: flags["lang"],
        lens: flags["lens"],
      });
      console.log(flags["format"] === "markdown" ? report.executiveBriefMarkdown : JSON.stringify(report, null, 2));
      return;
    }
    case "drift": {
      const doc = loadLcfOrLaw(positional[0]!);
      const asOf = flags["as-of"] ?? new Date().toISOString().slice(0, 10);
      const alerts = detectAmendmentDrift(doc, asOf);
      const gitHits = flags["git-diff"]
        ? mapSwissLawGitDiffToRules(doc, flags["git-diff"].split(","))
        : [];
      console.log(JSON.stringify({ asOf, alerts, swisslawGitImpacts: gitHits }, null, 2));
      return;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main();
