# Pan-European Architecture: Switzerland First, Then Europe / EEA / UK

`law-coded` is engineered to win Switzerland completely first (building directly on top of **OpenCaseLaw** and **Fedlex**) and then scale cleanly across **all 27 EU Member States, the EEA (NO, IS, LI), the United Kingdom, and the Council of Europe (ECHR)** without changing a single core primitive.

---

## 1. The Asymmetric Moat: Living Authority Graph + Executable Law

Most "Rules as Code" projects fail for one reason: they hand-encode a few isolated statutes into disconnected code that rots the moment Parliament amends a paragraph or a supreme court issues a leading judgment.

Pairing **`law-coded`** with **OpenCaseLaw** (`opencaselaw.ch`) and **`swisslaw-git`** (`github.com/jonashertner/swisslaw-git`) closes the entire three-pillar loop:

1. **Pillar 1: Versioned Normative Text Substrate (`swisslaw-git` -> `eurolaw-git`):** 5,338 Swiss federal laws (11,674 versions since 2021) + 16,440 cantonal laws across 24 cantons + 145 adopted-not-yet-in-force statutes (`adopted/`, `future` branch) + 609 federal *Vernehmlassungen* (`consultations/`), stored as deterministic per-language Git files (`ch/2/220/de.md#art-336c`, `stand/YYYY-MM-01` tags). The exact same Git-native pattern extends cleanly to EUR-Lex CELLAR / ELI, `LegalDocML.de`, Légifrance, Austrian RIS, Italian Normattiva, and UK `legislation.gov.uk` (CLML XML).
2. **Pillar 2: Executable Living Law (`law-coded`, LCF 0.1):** Typed math, calendars, defeasibility, Art. 8 ZGB burden of proof, tri-temporal rules, *Streitstand* lenses, structured *Subsumtion*, counterfactuals, *Digitalcheck* verification, and RUML 1.0.0 interoperability.
3. **Pillar 3: Live Judicial & Administrative Authority Graph (`OpenCaseLaw` + `swiss-law-graph`):** 1,040,000+ Swiss decisions + ECtHR + CJEU + 28,100+ *Botschaften* + 13,000+ federal/cantonal *Verwaltungspraxis* circulars + 9.65M citation edges with verified pinpoint citations (`E. X.Y` / `consid. X.Y` / `para. X`).
4. **Continuous Drift Detection (Law-CI):** Whenever `swisslaw-git` receives a commit on `main`, `future`, `adopted/`, or `consultations/` (or a supreme court flags a new leading case), `mapSwissLawGitDiffToRules` immediately identifies every impacted LCF rule node, runs golden court regression tests, and simulates legislative impact *before* enactment.

---

## 2. Unified European Identifier & Grounding Matrix

Every LCF `authority` entry uses standard persistent European identifiers so a single rule graph can bridge national and supranational law seamlessly:

| Jurisdiction | Legislation Source & Format | Persistent Statute ID | Case Law & Interpretive Source | Persistent Case ID |
|---|---|---|---|---|
| **Switzerland (`CH`, `CH-*`)** | Fedlex (`LegalDocML.ch` / JOLux SPARQL) + Cantonal Portals / LexFind | `https://www.fedlex.admin.ch/eli/cc/...` + SR/LS number | **OpenCaseLaw** (BGer, BGE, BVGer, BStGer, 26 cantons, BBl, 13k *Weisungen*, OnlineKommentar) | `opencaselaw:<decision_id>#e-<pinpoint>` + ECLI |
| **European Union (`EU`)** | EUR-Lex CELLAR / Formex / Akoma Ntoso | ELI (`http://data.europa.eu/eli/...`) & CELEX | CJEU (`curia.europa.eu` + OpenCaseLaw `cjeu`), EDPB/ESMA/EBA guidelines, Commission recitals | `ECLI:EU:C:...` / `ECLI:EU:T:...` |
| **EEA (`EEA`, `NO`, `IS`, `LI`)** | EEA-Lex + Lovdata (`NO`), Althingi (`IS`), LILEX (`LI`) | EEA Annex ELI + national ELI | EFTA Court + national supreme courts | `ECLI:EFTA:...` + national IDs |
| **Council of Europe (`ECHR`)** | Treaty Office + HUDOC | `eli/treaty/echr/...` | **OpenCaseLaw** (`ecthr_grand_chamber`, `ecthr_chamber`, `hudoc_ch`) | `ECLI:CE:ECHR:...` |
| **Germany (`DE`, `DE-*`)** | `rechtsinformationen.bund.de` (`LegalDocML.de`) | `eli/bund/bgbl-1/...` | BVerfG, BGH, BVerwG, BAG, BFH, BSG (OpenLegalData / Rechtsprechung im Internet) | `ECLI:DE:...` |
| **France (`FR`)** | Légifrance / DILA | `eli/loi/...` / `eli/decret/...` | Cour de cassation (Judilibre API), Conseil d'État (Open Data), Conseil constitutionnel | `ECLI:FR:...` |
| **Austria (`AT`)** | RIS (`data.bka.gv.at`) | `eli/bgbl/...` | OGH, VfGH, VwGH (RIS Open Data) | `ECLI:AT:...` |
| **Italy (`IT`)** | Normattiva (`Akoma Ntoso` / NIR) | `urn:nir:stato:...` + ELI | Corte costituzionale, Corte di cassazione | `ECLI:IT:...` |
| **United Kingdom (`UK`, `UK-ENG`, `UK-SCT`, `UK-NIR`)** | `legislation.gov.uk` (Crown Legislation Markup Language / Akoma Ntoso) | `https://www.legislation.gov.uk/ukpga/...` | The National Archives Find Case Law (UKSC, EWCA, EWHC, UKUT), ICO/FCA guidance | Neutral Citations (`[2025] UKSC ...`) + TNA URI |

---

## 3. Rollout Strategy: Four Waves to Pan-European Dominance

### Wave 1: Swiss Flagship Dominance (Months 0 to 3)
* Establish `law-coded` + **LCF 0.1 / 1.0** as the gold-standard Swiss computational law stack, anchored natively in **OpenCaseLaw** and **Fedlex**.
* Ship production-grade, BGE-tested flagship modules across high-pain Swiss legal domains:
  1. **Civil Procedure Deadlines & Costs (`ZPO` Art. 142–146 + `BGG` + 26 Cantonal Holiday & Tariff Overlays)**
  2. **Employment Termination & Protection (`OR` Art. 335–337d + `Art. 8 ZGB` + *Streitstand* Lenses)**
  3. **Tenancy Law (`OR` Art. 253–274g + `VMWG` + BWO Practice + *Referenzzinssatz*)**
  4. **Inheritance & Forced Heirship (`ZGB` Art. 457–471 + 2023 *Erbrechtsrevision* *Übergangsrecht*)**
  5. **Social Security & Tax Core (`ELG`, `AVIG`, `AHVG`, `StHG` + ZH/GE/VD/TI cantonal overlays + BSV/ESTV *Weisungen*)**
  6. **Swiss Data Protection (`DSG` SR 235.1)**
* Engage **EMBAG / Digitale Verwaltung Schweiz (DVS) / eCH / Federal Chancellery (Fedlex) / Swiss law faculties (UZH, UniBE, UNIGE, UNIL, USI, HSG)** with a working public studio and open eCH draft profile.

### Wave 2: DACH + Cross-Border Swiss-EU Bridge (Months 3 to 6)
* Ship lossless **RUML 1.0.0** bi-directional interoperability so every German ministry/agency testing RUML can upgrade to LCF capabilities (typed math, deadlines, defeasibility, BGH/BVerfG grounding, formal verification) without rewriting existing work.
* Encode high-value cross-border bilateral/EU-linked frameworks: **GDPR / Swiss DSG / UK GDPR**, **Lugano Convention / Brussels I bis**, **EU AI Act**, **DORA / FINMA**, **Schengen / Dublin / FZA**.
* Connect `LegalDocML.de` and Austrian RIS connectors.

### Wave 3: Full EU + EEA Core Regulations & Directives (Months 6 to 12)
* Model EU Regulations once at the `EU` base layer (`GDPR`, `AI Act`, `DSA`, `DMA`, `MiCA`, `EU Passenger Rights 261/2004`, `Consumer Rights`, `VAT Directive`, `CRD/CRR`), with **Member State & EEA transposition overlays** (`DE`, `FR`, `IT`, `NL`, `AT`, `BE`, `ES`, `PL`, `SE`, `NO`, `IS`, `LI`) inheriting the core graph and encoding national derogations and CJEU/national supreme court lenses.

### Wave 4: United Kingdom Divergence Engine (Months 9 to 18)
* Connect `legislation.gov.uk` + TNA Find Case Law + UK neutral citations (`UKSC`, `EWCA`, `EWHC`), modeling **assimilated EU law vs. UK divergence** (e.g., UK GDPR + DUAA vs. EU GDPR vs. Swiss DSG; UK FCA vs. EU MiCA/DORA vs. Swiss FINMA; UK devolved overlays for England & Wales, Scotland, and Northern Ireland).
* Result: **One unified executable law graph for the entire European legal space (Switzerland + EU-27 + EEA + UK + ECHR)**, searchable by humans, verifiable by formal solvers, and directly callable by AI agents via MCP.
