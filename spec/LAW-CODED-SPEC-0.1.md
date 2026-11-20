# Law-Coded Format (LCF) Specification 0.1

**Status:** Draft Standard (v0.1.0, November 2026)  
**Maintainer:** `law-coded` Open Legal Infrastructure Initiative (`https://github.com/law-coded`)  
**License:** Specification text under CC-BY-4.0; JSON Schemas, reference engine, and conformance suites under Apache-2.0.  
**Normative Keywords:** The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

---

## 1. Purpose & Design Philosophy

The **Law-Coded Format (LCF)** is an open, vendor-neutral, machine-executable representation of **living law**: statutory norms, constitutional and federal hierarchies, binding judicial precedent, administrative directives, interpretive disputes (*Streitstand*), temporal transitions (*Übergangsrecht*), quantitative legal consequences, burden-of-proof allocations, and structured human-auditable neuro-symbolic *Subsumtion*.

Whereas first-generation rule-mapping formats (such as RUML 1.0.0) model law as monolingual, single-jurisdiction boolean trees, real European legal systems are:

1. **Multilingual and co-equal:** Swiss federal statutes are equally authentic in German, French, and Italian (Art. 70 BV; Art. 14 ParlG); EU legislation is authentic in 24 official languages; Belgium, Luxembourg, Finland, Ireland, and Wales operate multilingual legal regimes.
2. **Multi-layered and defeasible:** Law operates through *Stufenbau* (supranational treaty / EU law -> federal constitution -> statute -> ordinance -> cantonal / regional implementing act -> municipal bylaw -> administrative directive) and *Grundsatz / Ausnahme / Gegenausnahme* overrides (*lex superior*, *lex specialis*, *lex posterior*).
3. **Typed and quantitative:** Law computes exact monetary amounts (in CHF/Rappen, EUR/cents, GBP/pence using exact decimal arithmetic), statutory deadlines with court recess suspensions (*Gerichtsferien*) and regional public holidays, interest rates, caps, and deontic statuses (obligation, permission, prohibition, claim-right, power, discretion).
4. **Epistemically structured (Burden of Proof):** Missing facts do not merely produce `undefined`; legal systems resolve *non liquet* through explicit burden-of-proof rules (such as Art. 8 ZGB in Switzerland).
5. **Interpretively alive:** Statutes are operationalised through leading court decisions (BGE/BGer, CJEU, ECtHR, UKSC, BGH, Cour de cassation), *travaux préparatoires* (*Botschaften*, recitals, explanatory notes), administrative circulars (*Weisungen*, *Kreisschreiben*), and competing scholarly views (*Streitstand*).
6. **Tri-temporal:** Applying a rule requires distinguishing the date of the facts (*Sachverhaltszeitpunkt*), the date of the legal act or decision (*Entscheidungszeitpunkt*), and the active version of the legal corpus (*Rechtsstand*).

LCF 0.1 encodes all six properties natively while preserving deterministic export to **RUML 1.0.0** for pure-boolean subgraphs.

---

## 2. File Structure & Canonical Integrity

Every LCF document MUST be a valid UTF-8 JSON document (RFC 8259) conforming to `spec/schema/lcf-document.schema.json`.

### 2.1 Top-Level Fields

| Field | Required | Description |
|---|---|---|
| `$format` | MUST | Literal string `"LCF"`. |
| `$specVersion` | MUST | Semantic specification version (`"0.1"`). |
| `metadata` | MUST | Document identity, jurisdictions, languages, temporal bounds, governance, and provenance. |
| `authorities` | MUST | Structured registry of primary legislation (ELI / Akoma Ntoso / Fedlex / EUR-Lex / UK), leading case law (ECLI / OpenCaseLaw), *Materialien*, and administrative practice. |
| `inputs` | MUST | Typed input schema including exact decimal money, legal dates, enums, records, and default burden-of-proof metadata. |
| `lenses` | MAY | Named interpretive overlays (*Streitstand* lenses) enabling runtime comparison between judicial practice, administrative directives, prevailing doctrine, and minority views. |
| `rules` | MUST | Ordered map of typed, defeasible normative rules with explicit override edges, temporal windows, jurisdiction scopes, authority bindings, and optional neuro-symbolic *Subsumtion* contracts. |
| `outputs` | MUST | Primary exported legal consequences (boolean validity, exact monetary sums, computed deadlines, deontic obligations, remedies, escalations). |
| `tests` | MAY | Embedded golden test vectors distilled from leading court decisions and official administrative examples. |

### 2.2 Canonical Hashing & Provenance

Canonical digests MUST be computed by serialising the document according to **RFC 8785 (JSON Canonicalization Scheme, JCS)** and hashing with **SHA-256** (`sha256:<hex>`). Every evaluation trace (`LCF-Result`) MUST embed the exact canonical digest of the evaluated LCF document and the active lens identifier, creating a cryptographically reproducible audit record.

---

## 3. Multilingual & Multi-Jurisdictional Core

### 3.1 Multilingual Text Map (`LocalizedText`)

All human-facing fields (titles, rule labels, explanation templates, criterion descriptions) MUST support an ISO 639-1 keyed map (`{ "de": "...", "fr": "...", "it": "...", "en": "..." }`).

* A Swiss federal module SHOULD provide at least `de`, `fr`, and `it` labels and statutory anchors; EU/EEA modules SHOULD provide `en` plus target member-state languages.
* An `authority` entry MAY attach `languageDivergences[]` documenting known semantic differences across authentic language texts (e.g., DE vs. FR wording discrepancies resolved by a court).

### 3.2 Jurisdiction Hierarchy (`JurisdictionCode`)

Jurisdictions follow ISO 3166-1 / ISO 3166-2 extended with supranational European scopes:

* Supranational: `EU`, `EEA`, `ECHR`
* National: `CH`, `DE`, `FR`, `AT`, `IT`, `UK`, `NL`, `BE`, `LI`, `NO`, `IS`, ...
* Sub-national / Cantonal / Devolved: `CH-ZH`, `CH-GE`, `CH-TI`, `CH-BE`, `DE-BY`, `UK-ENG`, `UK-SCT`, `UK-NIR`, ...
* Municipal / Local: `CH-ZH-261` (BFS municipality ID), etc.

Every rule carries a `scope.jurisdictions` array and an optional `scope.authorityLevel` (`supranational`, `constitutional`, `federal_statute`, `federal_ordinance`, `cantonal_statute`, `municipal`, `administrative_directive`, `judicial_precedent`, `contractual`). When multiple rules apply to the same target output, higher `authorityLevel` or more specific jurisdiction overrides according to explicit conflict resolution rules (Section 5).

---

## 4. Typed Data Model & Legal Primitives

LCF defines first-class legal value types:

| Type | Wire Representation | Semantics |
|---|---|---|
| `boolean` | `true` \| `false` | Exact boolean truth value. |
| `integer` | JSON integer | Exact integer (counts, days, service years). |
| `decimal` | String (`"0.0525"`) or `{ "value": "1234.50" }` | Arbitrary-precision decimal (scaled integer arithmetic; IEEE-754 binary floats MUST NOT be used for financial calculations). |
| `money` | `{ "amount": "6500.00", "currency": "CHF" }` | Exact decimal monetary value paired with ISO 4217 currency code. |
| `date` | ISO 8601 `"YYYY-MM-DD"` | Calendar date in legal jurisdiction timezone (no ambiguous UTC shift). |
| `period` | `{ "days"?: number, "weeks"?: number, "months"?: number, "years"?: number }` | Statutory duration with calendar-accurate month-end semantics (e.g. Art. 142 Abs. 2 ZPO). |
| `enum` | String constrained to declared variants | Closed legal classification (e.g. procedure type, notice type, lawful basis). |
| `string` | String | Free text, identifiers, or document excerpts. |
| `list` | Array of typed elements | Collections (e.g. incapacity intervals, evidence items). |
| `object` | Structured record | Composite domain facts. |
| `unknown` | `{ "$state": "unknown", "reason"?: string }` | Explicitly unproven or unsupplied fact, subject to Section 6 burden-of-proof resolution. |

---

## 5. Defeasible Normative Rules & Conflict Resolution

Every rule in `rules` has a unique identifier, a `target` variable it defines or modifies, a `kind`, and an explicit priority/defeasibility specification:

* `base`: General statutory rule (*Grundsatz*).
* `exception`: Statutory or judicial carve-out (*Ausnahme*) that explicitly lists `overrides: [ruleId, ...]`.
* `counter_exception`: Restoration or refinement (*Gegenausnahme*) overriding an exception.
* `overlay`: Jurisdiction-specific or interpretive-lens rule overriding a base rule under a selected `jurisdiction` or `lens`.
* `subsumtion`: Structured neuro-symbolic evaluation contract for open-textured legal concepts (*unbestimmte Rechtsbegriffe*).
* `derivation`: Deterministic typed computation (exact math, calendar/deadline calculation, monetary cap).

### 5.1 Resolution Order

When multiple active rules target the same variable for the given `(jurisdiction, factDate, decisionDate, lens)`:

1. Filter rules by **temporal applicability** (Section 7), **jurisdictional match**, and **active lens**.
2. Evaluate preconditions (`when`). Discard rules whose preconditions evaluate to `false` (or resolve to `false` under burden-of-proof rules).
3. Apply explicit **defeat edges (`overrides`)**: if active rule `B` declares `overrides: ["A"]` and `B` fires, `A` is defeated (and recorded in the trace as `defeated_by: "B"`, never silently dropped).
4. If multiple undefeated rules remain, resolve deterministically by:
   a. **Lens overlay** over default rule (when explicitly selected by the user),
   b. **Explicit `priority` / `lex_specialis` rank** (higher wins),
   c. **Jurisdictional specificity** (e.g. `CH-ZH` over `CH` for cantonal holidays; `CH` federal over `CH-ZH` where `lex_superior` / Art. 49 BV applies via `authorityLevel`),
   d. **Temporal recency (`lex_posterior`)** if equal rank.
5. If two undefeated rules remain at identical precedence with conflicting values, the engine MUST emit a **Normative Conflict (`conflict`)** status and surface both authorities rather than choosing arbitrarily.

---

## 6. Burden of Proof (`Art. 8 ZGB`) & *Non Liquet* Resolution

Every input and rule precondition MAY declare a `burdenOfProof` policy:

```json
{
  "party": "claimant | respondent | employer | employee | authority | court_ex_officio",
  "factRole": "right_creating | right_hindering | right_extinguishing | procedural",
  "standard": "full_proof | preponderance | prima_facie | beyond_reasonable_doubt",
  "onUnknown": "resolve_false | resolve_true | keep_unknown | escalate_human"
}
```

* Under **open-world / triage mode** (`mode: "triage"`), missing facts remain `unknown` so the engine can compute minimal next questions.
* Under **adjudication / burden-of-proof mode** (`mode: "adjudicate"`), an unproven fact (`unknown`) resolves against the party bearing the burden of proof (e.g. under Art. 8 ZGB, an unproven *rechtserzeugende Tatsache* resolves `false` against the claimant; an unproven exception/defence resolves `false` against the party invoking the exception, leaving the base right intact). The trace MUST mark the status as `resolved_by_burden_of_proof` and cite the burden allocation rule.

---

## 7. Tri-Temporal Semantics & *Übergangsrecht*

Every evaluation context carries three independent temporal coordinates:

1. `factDate`: When the underlying legally relevant event occurred (e.g., notice received, service of judgment, contract formation).
2. `decisionDate`: When the procedural step or adjudication occurs (defaulting to `factDate` if omitted).
3. `lawVersion`: Snapshot date of the statutory & case-law corpus (defaulting to `decisionDate`).

Each rule MAY specify:
* `temporal.basis`: `"factDate" | "decisionDate" | "lawVersion"` (for instance, procedural rules like Art. 142 Abs. 1bis ZPO use `factDate` / `decisionDate` per ZPO transitional law; substantive inheritance rules follow date of death).
* `temporal.validFrom` / `temporal.validUntil`: Inclusive start, exclusive end ISO dates.
* `temporal.transitionalNote`: Localized explanation of the applicable *Übergangsrecht* provision.

---

## 8. Interpretive Authority & *Streitstand* Lenses

Unlike RUML, where court decisions are passive attachments, LCF elevates judicial precedent, *Materialien*, and administrative circulars to executable overlays:

* Every rule MUST cite at least one verified authority ID from `authorities[]` (ELI URI for legislation, OpenCaseLaw / ECLI URI with verified `pinpoint` for case law, BBl / EUR-Lex CELEX for preparatory works, official reference for administrative directives).
* A document MAY define named `lenses[]` (e.g., `bger_settled`, `strict_statutory_text`, `employer_favorable_doctrine`, `admin_directive_estv`).
* Conformant engines MUST support **`diffLenses(doc, inputs, context, [lensA, lensB, ...])`**, evaluating the exact same factual scenario across multiple interpretive lenses and returning the exact outputs and rule nodes where the legal outcome diverges.

---

## 9. Court-Grade Neuro-Symbolic *Subsumtion* Contracts

Open-textured legal concepts (*unbestimmte Rechtsbegriffe* such as *wichtiger Grund* in Art. 337 OR or *überwiegendes Interesse* in Art. 31 DSG) MUST NOT be encoded as unconstrained free-text prompts.

An LCF `subsumtion` rule MUST specify:

1. `legalConcept`: Localized term and statutory + leading-case anchors.
2. `factors[]`: Structured, weighted legal criteria derived from binding precedent (each criterion linked to its BGE/CJEU/ECtHR/UKSC pinpoint, direction `pro | contra | disqualifying`, and required factual evidence inputs).
3. `disqualifiers[]`: Hard statutory/precedent cutoffs that deterministically preclude a positive finding (e.g. Art. 337 Abs. 3 OR: unverschuldete Verhinderung can *never* constitute a *wichtiger Grund*).
4. `escalationBand`: Explicit lower/upper score or certainty thresholds (`[low, high]`). Any evaluation falling inside the borderline band MUST return `status: "escalate_human"` with a structured judicial balancing matrix rather than fabricating a binary `true`/`false`.
5. `evidencePinpoints`: Every factor assessment MUST bind to concrete input facts or exhibits.

---

## 10. Bidirectional Reasoning, Verification & RUML 1.0.0 Interoperability

A conformant LCF Level-2 engine MUST provide:

1. **Minimal Next-Question Triage:** Given partial inputs, compute the minimal subset of unknown inputs that can still alter any target output, ranked by decisive impact.
2. **Counterfactual & Sensitivity Analysis:** Given evaluated inputs, perturb decisive factual variables (dates, amounts, booleans, enums) to identify the closest factual boundaries that flip the legal outcome.
3. **Formal Legislative Verification (*Digitalcheck*):** Static and symbolic inspection reporting:
   * Uncited normative rules (violation of grounding discipline),
   * Missing trilingual/multilingual labels or anchors,
   * Temporal overlaps or uncovered gaps between rule versions,
   * Circular override dependencies,
   * Unreachable / dead rules,
   * Missing golden BGE/court test coverage.
4. **Multilingual Audit-Grade *Begründung* Generation:** Produce a structured legal reasoning report in the requested language (`de`, `fr`, `it`, `en`) citing exact statutory articles, verified court *Erwägungen* with clickable URLs, defeated rules, burden-of-proof resolutions, and clear demarcation between deterministic and discretionary/neuro-symbolic steps.
5. **RUML 1.0.0 Bridge:** Losslessly project boolean decision subgraphs to valid **RUML 1.0.0** (`.ruml` JSON) with a machine-readable fidelity report documenting every LCF capability (typed math, calendars, defeasibility, burden of proof, *Streitstand* lenses, tri-temporal rules) that RUML 1.0.0 cannot represent natively, and import existing RUML 1.0.0 files into LCF 0.1.
