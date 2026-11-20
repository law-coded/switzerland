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

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(resolve(filePath), "utf8")) as T;
}

function findCorpusFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findCorpusFiles(full));
    } else if (entry.endsWith(".lcf.json")) {
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
  export-ruml <file.lcf.json> [--lang de] [--lens ...]      Compile to RUML 1.0.0 + Fidelity Report
  import-ruml <file.ruml>                                   Import RUML 1.0.0 JSON into LCF 0.1
  drift <file.lcf.json> [--as-of YYYY-MM-DD] [--git-diff a,b] Check Fedlex / swisslaw-git drift

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
      const doc = loadJson<LcfDocument>(positional[0]!);
      const res = validateLcfDocument(doc);
      console.log(JSON.stringify(res, null, 2));
      if (!res.valid) process.exit(1);
      return;
    }
    case "verify": {
      const doc = loadJson<LcfDocument>(positional[0]!);
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
        const doc = loadJson<LcfDocument>(f);
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
      const doc = loadJson<LcfDocument>(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      const res = evaluateDocument(doc, inputs, buildContext(flags));
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    case "explain": {
      const doc = loadJson<LcfDocument>(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      const res = evaluateDocument(doc, inputs, buildContext(flags));
      console.log(generateBegruendung(doc, res));
      return;
    }
    case "diff-lenses": {
      const doc = loadJson<LcfDocument>(positional[0]!);
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
      const doc = loadJson<LcfDocument>(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      console.log(JSON.stringify(findCounterfactuals(doc, inputs, buildContext(flags)), null, 2));
      return;
    }
    case "next-questions": {
      const doc = loadJson<LcfDocument>(positional[0]!);
      const inputs = flags["inputs"] ? (JSON.parse(flags["inputs"]) as Record<string, unknown>) : {};
      console.log(JSON.stringify(findMinimalNextQuestions(doc, inputs, buildContext(flags)), null, 2));
      return;
    }
    case "export-ruml": {
      const doc = loadJson<LcfDocument>(positional[0]!);
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
    case "drift": {
      const doc = loadJson<LcfDocument>(positional[0]!);
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
