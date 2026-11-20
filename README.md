# law-coded

**The Open European Computational Law Stack (LCF 0.1).**  
**Switzerland first. Europe, EEA, and UK by design.**

Built as the executable counterpart to **[OpenCaseLaw](https://opencaselaw.ch)** (1.04M+ Swiss federal & cantonal decisions, ECtHR, CJEU, 28,100+ *Botschaften*, 13,000+ *Verwaltungspraxis* circulars) and **[swisslaw-git](https://github.com/jonashertner/swisslaw-git)** (5,338 federal laws, 16,440 cantonal laws, `adopted/`, `future` branch, and 609 federal *Vernehmlassungen* as versioned Git files), with full bidirectional interoperability with **RUML 1.0.0** ([ruml.org](https://ruml.org/)).

---

## Why `law-coded` Exists (10x Beyond Boolean Rulemaps)

First-generation legal rule formats (like RUML 1.0.0) represent law as monolingual, single-jurisdiction boolean trees (`AND` / `OR` / `XOR`). Real European law is far richer, and practicing lawyers, courts, lawmakers, and AI agents need an open standard built for legal reality:

1. **Typed Legal Consequences & Exact Math:** Arbitrary-precision decimal `Money` (CHF/Rappen, EUR/cents, GBP/pence via `BigInt`, zero floating-point drift), legal deadlines, caps, and deontic modalities (`validity`, `obligation`, `permission`, `prohibition`, `deadline`, `amount`, `discretion`).
2. **Defeasible Normative Logic:** First-class `base` -> `exception` -> `counter_exception` -> `overlay` rules with explicit `overrides[]`, *lex specialis*, *lex superior*, and *lex posterior* resolution (preserving 1:1 statutory isomorphism).
3. **Burden of Proof (`Art. 8 ZGB`) & *Non Liquet* Semantics:** Distinguishes open-world triage (`mode: "triage"`) from adjudication (`mode: "adjudicate"`), resolving unproven facts against the party bearing the burden of proof rather than blindly propagating `undefined`.
4. **Native Multilingualism & Federal / Supranational Layering:** Co-equal `DE / FR / IT / RM / EN` labels, explanations, and verbatim statutory anchors (`Art. 70 BV`), plus hierarchical jurisdiction inheritance (`EU` / `EEA` / `ECHR` -> `CH` / `DE` / `FR` / `UK` -> `CH-ZH` / `CH-GE` / `CH-TI` -> municipal -> administrative directives).
5. **Swiss & European Legal Calendar Engine:** Built-in Anonymous Gregorian Computus Easter, Swiss *Gerichtsferien* (`Art. 145 ZPO`), cantonal statutory holidays (`ZH`, `GE`, `TI`, `BE`, `VD`, `BS`), and `Art. 335c / 336c OR` notice & *Sperrfrist* calculators.
6. **Tri-Temporal Law (*Übergangsrecht*):** Independent `factDate`, `decisionDate`, and `lawVersion` evaluation per rule (e.g. seamlessly contrasting pre-2025 vs. post-2025 `Art. 142 Abs. 1bis` & `Art. 145 Abs. 4 ZPO`).
7. **Executable *Streitstand* Lenses & Multi-Lens Diff:** Toggle between settled Supreme Court practice (`bger_settled`), administrative circulars, strict statutory wording, or minority doctrine and compute exact outcome divergence diffs in milliseconds.
8. **Court-Grade Neuro-Symbolic *Subsumtion*:** Replaces bare LLM prompts with precedent-anchored weighted criteria, hard statutory disqualifiers (e.g. `Art. 337 Abs. 3 OR`), evidence pinpoints, and mandatory human-jurist escalation bands (`escalate_human`).
9. **Bidirectional Reasoning & Legislative *Digitalcheck*:** Minimal next-question triage, counterfactual boundary discovery, automated formal verification (`0..100` readiness score), and continuous `swisslaw-git` / Fedlex amendment drift detection.
10. **Audit-Grade Multilingual *Begründung* + RUML 1.0.0 Bridge:** Generates citable DE/FR/IT/EN legal memos with clickable Fedlex ELI and OpenCaseLaw BGE links, plus compiles cleanly to/from **RUML 1.0.0** with an explicit fidelity-loss report.

---

## The Three-Pillar Living Law Architecture

```
swisslaw-git (CH -> eurolaw-git)   : Versioned per-language statutory text, `future` branch, consultations
              │
              ▼  (git diff -> Law-CI drift mapping)
law-coded (LCF 0.1 Engine & Spec)  : Defeasible rules, exact math, calendars, Streitstand, verification, RUML bridge
              │
              ▼  (verified E. X.Y pinpoints, BBl, 13k Weisungen)
OpenCaseLaw (opencaselaw.ch)       : 1.04M+ CH decisions, ECtHR, CJEU, 9.65M citation graph, anti-hallucination attestation
```

---

## Repository Layout

| Path | Description |
|---|---|
| `spec/LAW-CODED-SPEC-0.1.md` | Normative RFC 2119 specification of the Law-Coded Format (LCF 0.1) |
| `spec/ARCHITECTURE-EUROPE.md` | Pan-European grounding matrix & 4-wave rollout (CH -> DACH -> EU/EEA -> UK) |
| `spec/RUML-COMPARISON.md` | Technical comparison & interoperability contract with RUML 1.0.0 |
| `spec/schema/` | JSON Schema Draft 2020-12 definitions (`lcf-document`, `lcf-result`) |
| `packages/core` | LCF types, exact `BigInt` Money arithmetic, RFC 8785 JCS canonical hashing, validator |
| `packages/calendars` | Swiss federal & cantonal holiday engine, ZPO *Gerichtsferien*, OR *Sperrfrist* calculators |
| `packages/engine` | Defeasible evaluator, *Streitstand* diff, bidirectional triage/counterfactuals, *Digitalcheck* verifier, *Begründung* generator |
| `packages/ruml-bridge` | Bidirectional RUML 1.0.0 exporter (with fidelity report) and lossless importer |
| `packages/grounding` | OpenCaseLaw, Fedlex SPARQL/ELI, `swisslaw-git` diff mapper, pan-European legal source registry |
| `packages/cli` | `law-coded` CLI (`validate`, `verify`, `eval`, `explain`, `diff-lenses`, `counterfactual`, `next-questions`, `export-ruml`, `import-ruml`, `drift`) |
| `packages/studio` | Zero-build interactive Web Studio (`http://127.0.0.1:4173`) |
| `corpus/ch/zpo-deadlines` | Flagship 1: SR 272 Art. 142–145 ZPO (2025 revision + cantons ZH/GE/TI + BGE 139 III 78 & 143 III 554) |
| `corpus/ch/or-termination` | Flagship 2: SR 220 Art. 335b–337c OR (notice, *Sperrfristen*, `Art. 8 ZGB`, BGE *Subsumtion*, exact CHF caps, *Streitstand*) |
| `corpus/europe/data-lawful-basis` | Flagship 3: Pan-European overlay (EU/EEA GDPR Art. 6 vs. Swiss DSG Art. 31 vs. UK GDPR divergence) |
| `conformance/runner.ts` | Conformance & golden court test runner |

---

## Quickstart (Node 22+ / 26+, Zero Runtime Dependencies)

```bash
# 1. Run the full conformance suite and golden BGE court tests
pnpm test

# 2. Run the Digitalcheck formal verifier across the entire corpus
pnpm verify:corpus

# 3. Launch the interactive Web Studio (DE/FR/IT/EN, Streitstand diff, RUML 1.0.0 bridge)
pnpm studio
# -> open http://127.0.0.1:4173

# 4. Generate a French audit-grade legal memo for Art. 337 OR summary dismissal
pnpm cli explain corpus/ch/or-termination/rulemap.lcf.json \
  --lang fr --jurisdiction CH --fact-date 2026-05-10 \
  --inputs '{"terminationType":"summary_employer","noticeReceivedDate":"2026-05-10","serviceYear":6,"inProbation":false,"monthlyGrossSalary":{"amount":"9200.00","currency":"CHF"},"daysBetweenKnowledgeAndSummaryDismissal":2,"severeLoyaltyBreachOrCrime":true}'

# 5. Diff Streitstand lenses on workplace-specific incapacity (Art. 336c OR)
pnpm cli diff-lenses corpus/ch/or-termination/rulemap.lcf.json \
  --inputs '{"terminationType":"ordinary_employer","noticeReceivedDate":"2026-03-15","serviceYear":4,"inProbation":false,"monthlyGrossSalary":{"amount":"8500.00","currency":"CHF"},"incapacitatedAtNotice":true,"workplaceSpecificIncapacityOnly":true,"pregnantOrPostpartum16w":false}'

# 6. Export to valid RUML 1.0.0 JSON + see the Fidelity & Loss Report
pnpm export:ruml
```

---

## Licensing

* **Code, JSON Schemas, Conformance Tests, CLI, Studio:** Apache License 2.0
* **Specification (`spec/*.md`):** Creative Commons Attribution 4.0 International (CC-BY-4.0)
* **Primary Legal Data:** Quotes and anchors preserve upstream statutory/court/open-access provenance (Fedlex, OpenCaseLaw CC0 1.0, OnlineKommentar.ch CC-BY-4.0).
