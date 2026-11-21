import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeCanonicalHash,
  type EvaluationContext,
  type LcfDocument,
} from "../core/src/index.ts";
import {
  diffLenses,
  evaluateDocument,
  findCounterfactuals,
  findMinimalNextQuestions,
  generateBegruendung,
  verifyDocument,
} from "../engine/src/index.ts";
import { exportToRuml10 } from "../ruml-bridge/src/index.ts";
import {
  detectAmendmentDrift,
  EUROPEAN_LEGAL_SOURCES,
} from "../grounding/src/index.ts";
import { compileLawDsl } from "../dsl/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CORPUS_DIR = join(ROOT, "corpus");
const PUBLIC_INDEX = join(__dirname, "public/index.html");

function loadAllCorpus(): Record<string, LcfDocument> {
  const out: Record<string, LcfDocument> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".lcf.json")) {
        const doc = JSON.parse(readFileSync(full, "utf8")) as LcfDocument;
        out[doc.metadata.slug] = doc;
      } else if (entry.endsWith(".law")) {
        const doc = compileLawDsl(readFileSync(full, "utf8"));
        out[doc.metadata.slug] = doc;
      }
    }
  };
  walk(CORPUS_DIR);
  return out;
}

const PORT = Number(process.env["PORT"] ?? 4173);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const sendJson = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(PUBLIC_INDEX, "utf8"));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/corpus") {
    const corpus = loadAllCorpus();
    const list = Object.values(corpus).map((doc) => ({
      slug: doc.metadata.slug,
      canonicalHash: computeCanonicalHash(doc),
      verification: verifyDocument(doc),
      drift: detectAmendmentDrift(doc, new Date().toISOString().slice(0, 10)),
      document: doc,
    }));
    sendJson(200, { modules: list, europeanSources: EUROPEAN_LEGAL_SOURCES });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/evaluate") {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw) as {
          slug: string;
          inputs: Record<string, unknown>;
          context: Partial<EvaluationContext>;
        };
        const corpus = loadAllCorpus();
        const doc = corpus[body.slug];
        if (!doc) {
          sendJson(404, { error: `Unknown module "${body.slug}"` });
          return;
        }
        const evaluation = evaluateDocument(doc, body.inputs ?? {}, body.context ?? {});
        const lensDiff = diffLenses(doc, body.inputs ?? {}, body.context ?? {});
        const counterfactuals = findCounterfactuals(doc, body.inputs ?? {}, body.context ?? {});
        const nextQuestions = findMinimalNextQuestions(doc, body.inputs ?? {}, body.context ?? {});
        const begruendung = generateBegruendung(doc, evaluation);
        const rumlExport = exportToRuml10(doc, {
          language: evaluation.context.language,
          jurisdiction: evaluation.context.jurisdiction,
          lens: evaluation.context.lens,
        });
        sendJson(200, {
          evaluation,
          lensDiff: {
            lensesEvaluated: lensDiff.lensesEvaluated,
            hasDivergence: lensDiff.hasDivergence,
            divergingOutputs: lensDiff.divergingOutputs,
          },
          counterfactuals,
          nextQuestions,
          begruendung,
          rumlExport,
        });
      } catch (err) {
        sendJson(400, { error: err instanceof Error ? err.message : String(err) });
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`law-coded Studio running at http://127.0.0.1:${PORT}`);
});
