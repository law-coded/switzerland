# Technical Comparison: LCF 0.1 (`law-coded`) vs. RUML 1.0.0 (`ruml.org`)

RUML 1.0.0 (published November 15, 2026 by Law as Code Institut GmbH / Rulemapping Group GmbH) is a clean first-generation JSON format for boolean decision trees over legislative texts. `law-coded` (LCF 0.1) is designed as a **strict semantic superset** for real-world European legal practice, judiciary, administration, and AI reasoning, while shipping a working **bidirectional RUML 1.0.0 bridge** (`@law-coded/ruml-bridge`).

---

## Side-by-Side Capability Matrix

| Capability | RUML 1.0.0 (`ruml.org`) | LCF 0.1 (`law-coded`) | Why It Matters in Practice |
|---|---|---|---|
| **Core Value Model** | Boolean / 4-status tree (`true`, `false`, `undefined`, `ignored`) | Typed values: exact decimal `Money` (CHF/EUR/GBP), `LegalDate`, `Period`, `Deadline`, `Enum`, `Boolean`, `List`, `Record`, Deontic outputs | Real law computes CHF amounts, statutory deadlines, caps, and legal consequences, not just yes/no checklists. |
| **Exceptions & Overrides** | Boolean `AND` / `NOT` tree rewriting | First-class defeasible rules (`base` -> `exception` -> `counter_exception` / `overlay`) with `overrides[]`, `lex_specialis`, `lex_superior`, `lex_posterior` | Mirrors statutory structure 1:1; cantonal or amending exceptions override cleanly without rewriting parent trees. |
| **Missing Facts & Burden of Proof** | Propagates `undefined` mechanically | Native `Art. 8 ZGB` / civil / administrative burden-of-proof semantics (*non liquet* resolution + triage mode vs. adjudication mode) | Litigation and administrative decisions turn on who bears the burden of an unproven fact. |
| **Multilingualism** | Single `metadata.language` string; single `label` per node | First-class `de` / `fr` / `it` / `rm` / `en` (+ any EU language) on every node, explanation, and text anchor, plus `languageDivergences[]` | Mandatory for Switzerland (Art. 70 BV), EU (24 languages), Belgium, Luxembourg, Finland. |
| **Federal & Supranational Layering** | Single `metadata.jurisdiction` string | Composable *Stufenbau* overlays: `EU` / `EEA` / `ECHR` -> `CH` / `DE` / `FR` / `UK` -> `CH-ZH` / `CH-GE` / `UK-SCT` -> Municipal -> Directives | Encode federal/EU frameworks once and override cleanly across 26 cantons or 27+ EU/EEA/UK states. |
| **Case Law, *Materialien* & *Streitstand*** | Passive attachments in `ruml:context` | Executable interpretive authority graph + toggleable **Streitstand Lenses** (`bger_settled`, `admin_practice`, `minority_doctrine`) with automated **Multi-Lens Diff** | Real legal outcomes often depend on judicial doctrine or contested views; lawyers need to see exact divergence. |
| **Temporal Law (*Übergangsrecht*)** | Single file-level `validFrom` / `validUntil` | Tri-temporal (`factDate`, `decisionDate`, `lawVersion`) per rule with explicit transitional-law basis | Essential for statutory revisions (e.g., 2025 ZPO revision, 2023 ZGB inheritance reform, post-Brexit UK divergence). |
| **Legal Calendars & Deadlines** | None (raw JSONata strings) | Built-in Swiss federal + cantonal holiday engine + *Gerichtsferien* (Art. 145 ZPO) + EU/UK business-day calendars | Eliminates silent calendar bugs on Easter, *Sechseläuten*, *Jeûne genevois*, *San Giuseppe*, and weekend service (`Art. 142 Abs. 1bis ZPO`). |
| **Open-Textured Terms / AI Layer** | Bare LLM prompt string (`ruml:ai-query`) returning `true/false/undefined` | Structured **Court-Grade *Subsumtion* Contract**: weighted BGE criteria, hard disqualifiers, mandatory evidence pinpoints, and mandatory human-jurist escalation band | Prevents hallucinated binary verdicts on *unbestimmte Rechtsbegriffe* (*wichtiger Grund*, *Härtefall*). |
| **Bidirectional Reasoning** | Forward evaluation only | Minimal next-question triage + counterfactual sensitivity boundary solver + static/symbolic legislative *Digitalcheck* verifier | Cuts intake friction, proves draft statutes free of contradictions/gaps, and exposes tipping points. |
| **Explanation Output** | Short debug string (`"Age 34 >= 18"`) | Audit-grade multilingual *Begründung* / *Subsumtion* memo with verified Fedlex ELI + clickable OpenCaseLaw BGE links | Ready for administrative *Verfügungen*, court briefs, and compliance audit trails. |
| **Governance & Licensing** | Trademark + rights held by Rulemapping Group GmbH; spec CC BY-SA 4.0; PRs closed | Vendor-neutral open initiative; code/schemas Apache-2.0; spec CC-BY-4.0; open RFC & PR process; EMBAG Art. 9 aligned | True public digital infrastructure without single-vendor lock-in. |

---

## Interoperability Contract (`@law-coded/ruml-bridge`)

We treat RUML 1.0.0 as a **supported interchange target**, not a wall:

1. **Export (`exportToRuml10(lcfDoc, options)`):**
   * Emits a strictly valid RUML 1.0.0 JSON document (`$format: "RUML"`, `$specVersion: "1.0"`, LexIDs starting at `"1"`, UUID v4 node IDs, `ruml:datapoints`, `ruml:query`, `ruml:text-reference`, `ruml:context`, `ruml:ai-query`).
   * Simultaneously emits a structured **Fidelity & Loss Report** enumerating every LCF feature that had to be flattened or approximated for RUML 1.0.0 (e.g. exact decimal money downgraded to JSONata numbers, defeasible override edges flattened to boolean gates, multilingual labels reduced to a single selected language, *Streitstand* lenses collapsed to one active lens, burden-of-proof resolution omitted).
2. **Import (`importFromRuml10(rumlDoc)`):**
   * Losslessly ingests any conformant RUML 1.0.0 file into LCF 0.1 so existing German or European RUML rulemaps run immediately on the `law-coded` engine and gain counterfactuals, minimal next-question triage, formal verification, and multilingual *Begründung* generation for free.
