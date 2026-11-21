# AlphaLaw Architecture: Solving Law 100x Smarter Than Legal RAG

Most legal AI products treat law like generic text summarization (`retrieve 5 chunks -> ask an LLM to write prose -> hope nothing was hallucinated`). That is the legal equivalent of asking a language model to improvise a proof of the Riemann Hypothesis in plain English without a formal proof assistant.

AI solves frontier mathematics by pairing **frontier search & synthesis** with a **small, sound formal proof kernel (e.g. Lean)**. **`law-coded` brings that exact paradigm to European law** by fusing three layers nobody else owns together:

```
  1. Versioned Statutory Text    : swisslaw-git (5,338 CH federal + 16,440 cantonal + future + 609 consultations)
  2. Live Judicial & Admin Oracle: OpenCaseLaw  (1.04M+ CH decisions, ECtHR, CJEU, 28k Botschaften, 13k Weisungen)
  3. Formal Proof & Advisory Core: law-coded    (.law DSL -> LCF 0.1 -> Symbolic Prover -> CEGAR Replay -> Enterprise Twin)
```

---

## The Five Loops That Make AI 100x Smarter in Law

### Loop 1: Auto-Formalization Into Literate `.law` Code (`@law-coded/dsl`)
Instead of hand-coding 1,000-line JSON trees or letting an LLM hallucinate raw answers on every client query, AI compiles statutes + administrative circulars + leading cases into **concise, human-auditable `.law` source files**:
* ~10x shorter than JSON, Git-diffable, and sign-off-ready for a senior partner or General Counsel in minutes.
* Compiles deterministically into **LCF 0.1** (typed exact decimal money, defeasible overrides, calendars, Art. 8 ZGB burden of proof, tri-temporal windows, *Streitstand* lenses) and projects cleanly to **RUML 1.0.0**.

### Loop 2: Formal Symbolic Proof Kernel (`@law-coded/prover`)
Every compiled `.law` module passes through `proveDocument(doc)` before reaching a client:
* **Extracts exact mathematical thresholds** directly from rule ASTs (`k-1, k, k+1`) and temporal transition dates (`validFrom - 1d`, `validFrom`, `validUntil`).
* **Mathematically proves:**
  1. **Zero silent normative conflicts** (no reachable state triggers equal-precedence contradicting rules),
  2. **Total primary output coverage** (no unhandled gaps producing silent `unknown`),
  3. **No permanently shadowed dead rules**,
  4. **Exact threshold cliffs** (pinpointing the exact day, year, or CHF amount where legal obligations jump),
  5. **Minimal cross-jurisdiction, temporal, and *Streitstand* divergence witnesses** (`CH` vs `EU`/`EEA` vs `UK`; pre- vs post-revision; settled court practice vs strict text).

### Loop 3: Empirical Judicial Backtesting / CEGAR (`@law-coded/cegar`)
In mathematics, axioms verify proofs. **In living law, the ground-truth oracle is statutory text PLUS 1,040,000+ real published court rulings in OpenCaseLaw.**

`runCegarVerificationGate(doc, realCourtCases)` executes compiled executable law directly against structured *Sachverhalt* facts from real Federal Supreme Court (BGE/BGer), BVGer, CJEU, and ECtHR decisions:
* Any mismatch between the formal rule engine and what the court actually held becomes a **machine-readable Counterexample Packet** (`missing_exception_or_rule_refinement`, `streitstand_resolved_by_alternate_lens`, or `escalation_calibration`).
* An AI refinement agent reads the exact *Erwägung* via OpenCaseLaw MCP, encodes the missing judge-made exception or *Streitstand* lens into `.law`, recompiles, re-proves, and re-replays until **judicial fidelity converges to 100%** (with genuine *Ermessen* explicitly isolated into `escalate_human` bands).

### Loop 4: Adversarial Legal Structuring Search (`findStructuringLevers`)
Large enterprise clients do not merely want to hear *"non-compliant."* They want **lawful structuring options**.

Given an undesired legal outcome (e.g., unlawful processing, CHF 50,000 indemnity exposure, mandatory 24h regulator filing), `findStructuringLevers` searches 1-step and 2-step combinations of adjustable factual, contractual, and jurisdictional variables to surface **every minimal lawful path** that flips the outcome to the client's target state, together with all secondary legal side effects.

### Loop 5: Enterprise Client Digital Twin & Proactive Change Radar (`@law-coded/enterprise`)
Represent a large multinational client once as a structured `OrganizationDigitalTwin` (entities across `CH-ZH`, `DE`, `FR`, `NO`, `UK`, regulated licenses, sector, headcount, turnover, data/AI footprint) and evaluate any encoded statutory suite across the entire group in milliseconds:
* **Cross-Border Applicability Matrix:** Pinpoints every jurisdictional divergence (`CH` vs `EU` vs `EEA` vs `UK`) and automatically identifies the group's **strictest high-water mark** (e.g., 4-hour EU DORA clock vs. 24-hour Swiss BACS/FINMA clock vs. 72-hour EU/UK GDPR clock).
* **Proactive Future-Law Radar:** Evaluates the same Client Digital Twin against `main` AND `swisslaw-git`'s `future` / `consultations/` branches, alerting clients *before* parliamentary amendments or FINMA circulars enter into force.
* **Proof-Carrying Advisory Dossier:** Every conclusion carries an RFC 8785 SHA-256 canonical hash, clickable Fedlex ELI + OpenCaseLaw BGE pinpoints, explicit *Streitstand* warnings, and zero unverified claims.
