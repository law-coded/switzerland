#!/usr/bin/env node
/**
 * Zero-dependency MCP (Model Context Protocol) STDIO server for law-coded (LCF 0.1).
 * Designed to run alongside OpenCaseLaw MCP (https://mcp.opencaselaw.ch) so AI agents
 * pair verified case-law retrieval with deterministic executable statutory reasoning.
 */
import { createInterface } from "node:readline";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeCanonicalHash,
  pickText,
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
import { exportToRuml10 } from "../../ruml-bridge/src/index.ts";
import { detectAmendmentDrift } from "../../grounding/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(__dirname, "../../../corpus");

function loadCorpus(): Record<string, LcfDocument> {
  const out: Record<string, LcfDocument> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".lcf.json")) {
        const doc = JSON.parse(readFileSync(full, "utf8")) as LcfDocument;
        out[doc.metadata.slug] = doc;
      }
    }
  };
  walk(CORPUS_DIR);
  return out;
}

const TOOLS = [
  {
    name: "list_modules",
    description: "List all loaded law-coded executable statute modules (CH & Europe/EEA/UK) with Digitalcheck readiness scores, jurisdictions, languages, and Streitstand lenses.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "evaluate_law",
    description: "Deterministically evaluate a law-coded LCF 0.1 statute module with exact math, Swiss/European calendars, Art. 8 ZGB burden of proof, defeasibility trace, and court-grade Subsumtion.",
    inputSchema: {
      type: "object",
      required: ["slug", "inputs"],
      properties: {
        slug: { type: "string" },
        inputs: { type: "object" },
        context: { type: "object" },
      },
    },
  },
  {
    name: "diff_streitstand",
    description: "Compare legal outcomes for the exact same facts across all Streitstand interpretive lenses (e.g. settled BGer practice vs. strict statutory wording).",
    inputSchema: {
      type: "object",
      required: ["slug", "inputs"],
      properties: {
        slug: { type: "string" },
        inputs: { type: "object" },
        context: { type: "object" },
      },
    },
  },
  {
    name: "find_counterfactuals",
    description: "Compute the closest factual perturbations (dates, amounts, booleans, service years) that flip the primary legal outcome.",
    inputSchema: {
      type: "object",
      required: ["slug", "inputs"],
      properties: {
        slug: { type: "string" },
        inputs: { type: "object" },
        context: { type: "object" },
      },
    },
  },
  {
    name: "find_next_questions",
    description: "Compute the minimal ranked set of unknown facts that actually decide the case.",
    inputSchema: {
      type: "object",
      required: ["slug", "inputs"],
      properties: {
        slug: { type: "string" },
        inputs: { type: "object" },
        context: { type: "object" },
      },
    },
  },
  {
    name: "explain_begruendung",
    description: "Generate an audit-grade multilingual Begründung / Motivation (de, fr, it, en) with verified Fedlex ELI and clickable OpenCaseLaw BGE links.",
    inputSchema: {
      type: "object",
      required: ["slug", "inputs"],
      properties: {
        slug: { type: "string" },
        inputs: { type: "object" },
        context: { type: "object" },
      },
    },
  },
  {
    name: "export_ruml",
    description: "Export a law-coded module to valid RUML 1.0.0 JSON alongside a Fidelity & Loss Report.",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string" },
        language: { type: "string" },
        jurisdiction: { type: "string" },
        lens: { type: "string" },
      },
    },
  },
];

function handleToolCall(name: string, args: Record<string, unknown>): unknown {
  const corpus = loadCorpus();
  if (name === "list_modules") {
    return Object.values(corpus).map((doc) => {
      const v = verifyDocument(doc);
      return {
        slug: doc.metadata.slug,
        version: doc.metadata.version,
        title: pickText(doc.metadata.title, "en"),
        jurisdictions: doc.metadata.jurisdictions,
        languages: doc.metadata.languages,
        lenses: (doc.lenses ?? []).map((l) => l.id),
        digitalcheckScore: v.readinessScore,
        canonicalHash: computeCanonicalHash(doc),
        driftAlerts: detectAmendmentDrift(doc, new Date().toISOString().slice(0, 10)),
      };
    });
  }

  const slug = String(args["slug"] ?? "");
  const doc = corpus[slug];
  if (!doc) throw new Error(`Unknown module "${slug}". Available: ${Object.keys(corpus).join(", ")}`);
  const inputs = (args["inputs"] ?? {}) as Record<string, unknown>;
  const context = (args["context"] ?? {}) as Partial<EvaluationContext>;

  switch (name) {
    case "evaluate_law":
      return evaluateDocument(doc, inputs, context);
    case "diff_streitstand":
      return diffLenses(doc, inputs, context);
    case "find_counterfactuals":
      return findCounterfactuals(doc, inputs, context);
    case "find_next_questions":
      return findMinimalNextQuestions(doc, inputs, context);
    case "explain_begruendung": {
      const res = evaluateDocument(doc, inputs, context);
      return { begruendung: generateBegruendung(doc, res), result: res };
    }
    case "export_ruml":
      return exportToRuml10(doc, {
        language: typeof args["language"] === "string" ? args["language"] : undefined,
        jurisdiction: typeof args["jurisdiction"] === "string" ? args["jurisdiction"] : undefined,
        lens: typeof args["lens"] === "string" ? args["lens"] : undefined,
      });
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const respond = (result: unknown, error?: { code: number; message: string }) => {
    if (req.id === undefined) return;
    const msg = error
      ? { jsonrpc: "2.0", id: req.id, error }
      : { jsonrpc: "2.0", id: req.id, result };
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  };

  try {
    if (req.method === "initialize") {
      respond({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "law-coded-mcp", version: "0.1.0" },
      });
    } else if (req.method === "tools/list") {
      respond({ tools: TOOLS });
    } else if (req.method === "tools/call") {
      const toolName = String(req.params?.["name"] ?? "");
      const toolArgs = (req.params?.["arguments"] ?? {}) as Record<string, unknown>;
      const data = handleToolCall(toolName, toolArgs);
      respond({
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      });
    } else if (req.method === "notifications/initialized") {
      return;
    } else {
      respond(undefined, { code: -32601, message: `Method not found: ${req.method}` });
    }
  } catch (err) {
    respond(undefined, { code: -32000, message: err instanceof Error ? err.message : String(err) });
  }
});
