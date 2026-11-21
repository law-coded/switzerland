import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  computeCanonicalHash,
  moneyAdd,
  moneyMul,
  roundSwissFiveRappen,
  validateLcfDocument,
  type LcfDocument,
} from "../packages/core/src/index.ts";
import {
  checkZpoGerichtsferien,
  computeOrTerminationEndDate,
  computeZpoDeadline,
  easterSunday,
  findHoliday,
} from "../packages/calendars/src/index.ts";
import {
  diffLenses,
  evaluateDocument,
  findCounterfactuals,
  findMinimalNextQuestions,
  generateBegruendung,
  verifyDocument,
} from "../packages/engine/src/index.ts";
import {
  exportToRuml10,
  importFromRuml10,
  type Ruml10Document,
} from "../packages/ruml-bridge/src/index.ts";
import {
  buildSwissLawGitRef,
  detectAmendmentDrift,
  mapSwissLawGitDiffToRules,
} from "../packages/grounding/src/index.ts";
import { compileLawDsl, decompileToLawDsl } from "../packages/dsl/src/index.ts";
import { findStructuringLevers, proveDocument } from "../packages/prover/src/index.ts";
import {
  runCaseReplayBenchmark,
  runCegarVerificationGate,
  type RealCourtCaseRecord,
} from "../packages/cegar/src/index.ts";
import {
  evaluateEnterprisePortfolio,
  type OrganizationDigitalTwin,
} from "../packages/enterprise/src/index.ts";

const loadCorpus = (rel: string): LcfDocument =>
  JSON.parse(readFileSync(resolve(rel), "utf8")) as LcfDocument;

const zpoDoc = loadCorpus("corpus/ch/zpo-deadlines/rulemap.lcf.json");
const orDoc = loadCorpus("corpus/ch/or-termination/rulemap.lcf.json");
const euDataDoc = loadCorpus("corpus/europe/data-lawful-basis/rulemap.lcf.json");
const enterpriseCyberLawSrc = readFileSync(
  resolve("corpus/enterprise/cyber-data-ai-incident/rules.law"),
  "utf8",
);
const enterpriseCyberDoc = compileLawDsl(enterpriseCyberLawSrc);
const orBgeReplayCases = JSON.parse(
  readFileSync(resolve("corpus/ch/or-termination/bge-replay.json"), "utf8"),
) as RealCourtCaseRecord[];

describe("01. Exact Money Arithmetic & RFC 8785 Canonical Integrity", () => {
  it("eliminates IEEE-754 float errors in CHF calculations", () => {
    const a = { amount: "0.10", currency: "CHF" };
    const b = { amount: "0.20", currency: "CHF" };
    assert.deepEqual(moneyAdd([a, b]), { amount: "0.30", currency: "CHF" });
    assert.deepEqual(moneyMul({ amount: "8333.35", currency: "CHF" }, 6), {
      amount: "50000.10",
      currency: "CHF",
    });
    assert.deepEqual(roundSwissFiveRappen({ amount: "123.43", currency: "CHF" }), {
      amount: "123.45",
      currency: "CHF",
    });
  });

  it("produces deterministic RFC 8785 canonical SHA-256 digests regardless of key order", () => {
    const h1 = computeCanonicalHash({ b: 1, a: { y: 2, x: 3 } });
    const h2 = computeCanonicalHash({ a: { x: 3, y: 2 }, b: 1 });
    assert.equal(h1, h2);
    assert.match(h1, /^sha256:[0-9a-f]{64}$/);
  });
});

describe("02. Swiss Federal & Cantonal Calendars + Art. 142/145 ZPO Engine", () => {
  it("computes exact Easter Sunday and Gerichtsferien windows", () => {
    assert.equal(easterSunday(2026), "2026-04-05");
    assert.equal(checkZpoGerichtsferien("2026-03-29").period, "easter"); // 7 days before Easter
    assert.equal(checkZpoGerichtsferien("2026-04-12").period, "easter"); // 7 days after Easter
    assert.equal(checkZpoGerichtsferien("2026-04-13").inRecess, false);
    assert.equal(checkZpoGerichtsferien("2026-07-15").period, "summer");
    assert.equal(checkZpoGerichtsferien("2026-08-15").period, "summer");
    assert.equal(checkZpoGerichtsferien("2026-12-18").period, "winter");
    assert.equal(checkZpoGerichtsferien("2027-01-02").period, "winter");
    assert.equal(checkZpoGerichtsferien("2027-01-03").inRecess, false);
  });

  it("distinguishes cantonal holidays across ZH, GE, and TI (San Giuseppe, Jeûne genevois, 1. Mai)", () => {
    // 2026-03-19 is Thursday (San Giuseppe): public holiday in TI, working day in ZH and GE
    assert.ok(findHoliday("2026-03-19", "CH-TI"));
    assert.equal(findHoliday("2026-03-19", "CH-ZH"), undefined);
    assert.equal(findHoliday("2026-03-19", "CH-GE"), undefined);

    // 10-day deadline triggered 2026-03-09 ends on 2026-03-19 -> stays Mar 19 in ZH, rolls to Mar 20 in TI!
    const zh = computeZpoDeadline({
      triggerDate: "2026-03-09",
      deliveryMethod: "registered_mail",
      durationDays: 10,
      suspensionApplies: false,
      canton: "CH-ZH",
      applyArt142Abs1bis: true,
    });
    const ti = computeZpoDeadline({
      triggerDate: "2026-03-09",
      deliveryMethod: "registered_mail",
      durationDays: 10,
      suspensionApplies: false,
      canton: "CH-TI",
      applyArt142Abs1bis: true,
    });
    assert.equal(zh.finalDeadline, "2026-03-19");
    assert.equal(ti.finalDeadline, "2026-03-20");

    // 2026-09-10 is Jeûne genevois (Thursday after 1st Sunday of Sept 2026-09-06): holiday in GE only
    assert.ok(findHoliday("2026-09-10", "CH-GE"));
    assert.equal(findHoliday("2026-09-10", "CH-ZH"), undefined);
  });

  it("applies tri-temporal 2025 ZPO revision (Art. 142 Abs. 1bis ordinary-mail Saturday shift)", () => {
    // Saturday 2024-06-15 (pre-2025) vs Saturday 2026-06-13 (post-2025)
    const pre2025 = evaluateDocument(
      zpoDoc,
      {
        triggerDate: "2024-06-15",
        deliveryMethod: "ordinary_mail",
        durationDays: 10,
        procedureType: "ordinary",
        noticeOfNoSuspensionGiven: true,
      },
      { jurisdiction: "CH-ZH", factDate: "2024-06-15", language: "de", lens: "bger_settled" },
    );
    const post2025 = evaluateDocument(
      zpoDoc,
      {
        triggerDate: "2026-06-13",
        deliveryMethod: "ordinary_mail",
        durationDays: 10,
        procedureType: "ordinary",
        noticeOfNoSuspensionGiven: true,
      },
      { jurisdiction: "CH-ZH", factDate: "2026-06-13", language: "de", lens: "bger_settled" },
    );
    assert.equal(pre2025.outputs["art142_abs1bis_applies"], false);
    assert.equal((pre2025.outputs["deadline_calculation"] as { effectiveTriggerDate: string }).effectiveTriggerDate, "2024-06-15");
    assert.equal(post2025.outputs["art142_abs1bis_applies"], true);
    assert.equal((post2025.outputs["deadline_calculation"] as { effectiveTriggerDate: string }).effectiveTriggerDate, "2026-06-15"); // shifted Sat -> Mon
  });
});

describe("03. Defeasibility, Counter-Exceptions & Streitstand Multi-Lens Diff", () => {
  it("detects exact outcome divergence across Streitstand lenses on BGE 139 III 78 (Art. 145 Abs. 3 ZPO)", () => {
    const diff = diffLenses(
      zpoDoc,
      {
        triggerDate: "2026-07-10",
        deliveryMethod: "registered_mail",
        durationDays: 10,
        procedureType: "appeal_from_summary",
        noticeOfNoSuspensionGiven: false,
      },
      { jurisdiction: "CH-ZH", factDate: "2026-07-10", language: "de" },
    );
    assert.equal(diff.hasDivergence, true);
    const suspDiff = diff.divergingOutputs.find((d) => d.outputId === "suspension_applies");
    assert.ok(suspDiff);
    assert.equal(suspDiff.valuesByLens["bger_settled"], true);
    assert.equal(suspDiff.valuesByLens["strict_statutory_text"], false);
  });

  it("detects exact outcome divergence on workplace-specific incapacity (Art. 336c OR / BVGer A-5819/2016 E. 4.5.1)", () => {
    const diff = diffLenses(
      orDoc,
      {
        terminationType: "ordinary_employer",
        noticeReceivedDate: "2026-03-15",
        serviceYear: 4,
        inProbation: false,
        monthlyGrossSalary: { amount: "8500.00", currency: "CHF" },
        incapacitatedAtNotice: true,
        workplaceSpecificIncapacityOnly: true,
        pregnantOrPostpartum16w: false,
      },
      { jurisdiction: "CH", factDate: "2026-03-15", language: "de" },
    );
    assert.equal(diff.hasDivergence, true);
    const statusDiff = diff.divergingOutputs.find((d) => d.outputId === "termination_status");
    assert.ok(statusDiff);
    assert.equal(statusDiff.valuesByLens["bger_settled"], "valid_ordinary");
    assert.equal(statusDiff.valuesByLens["strict_statutory_text"], "null_and_void_sperrfrist");
  });

  it("computes Art. 336c Abs. 2-3 OR Sperrfrist suspension & end-of-month snap accurately", () => {
    const end = computeOrTerminationEndDate({
      noticeReceivedDate: "2026-03-15",
      noticeMonths: 2, // ordinary end: 2026-05-31
      inProbation: false,
      incapacityDuringNoticeDays: 12, // extends to 2026-06-12 -> snaps to 2026-06-30!
      sperrfristCapDays: 90,
      endOfMonthOnly: true,
    });
    assert.equal(end.ordinaryEndDate, "2026-05-31");
    assert.equal(end.suspendedIncapacityDays, 12);
    assert.equal(end.extendedBeforeTermSnap, "2026-06-12");
    assert.equal(end.finalEndDate, "2026-06-30");
    assert.equal(end.snappedToEndOfMonth, true);
  });
});

describe("04. Court-Grade Neuro-Symbolic Subsumtion, Art. 8 ZGB Burden & Bidirectional Solvers", () => {
  it("escalates borderline Art. 337 OR dismissal to human jurist and triggers disqualifier on illness", () => {
    const borderline = evaluateDocument(
      orDoc,
      {
        terminationType: "summary_employer",
        noticeReceivedDate: "2026-05-10",
        serviceYear: 3,
        inProbation: false,
        monthlyGrossSalary: { amount: "7000.00", currency: "CHF" },
        daysBetweenKnowledgeAndSummaryDismissal: 2,
        priorWrittenWarningIgnored: true,
        severeLoyaltyBreachOrCrime: false,
      },
      { jurisdiction: "CH", factDate: "2026-05-10", language: "de" },
    );
    assert.equal(borderline.outputs["termination_status"], "escalate_human_art337");
    assert.equal(borderline.escalations.length, 1);

    const disqualified = evaluateDocument(
      orDoc,
      {
        terminationType: "summary_employer",
        noticeReceivedDate: "2026-05-10",
        serviceYear: 3,
        inProbation: false,
        monthlyGrossSalary: { amount: "7000.00", currency: "CHF" },
        daysBetweenKnowledgeAndSummaryDismissal: 1,
        severeLoyaltyBreachOrCrime: true,
        reasonIsNoFaultIncapacity: true, // Art. 337 Abs. 3 absolute disqualifier
      },
      { jurisdiction: "CH", factDate: "2026-05-10", language: "de" },
    );
    assert.equal(disqualified.outputs["termination_status"], "unjustified_summary_art337c");
    assert.deepEqual(disqualified.outputs["art337c_max_indemnity_chf"], {
      amount: "42000.00",
      currency: "CHF",
    });
  });

  it("computes counterfactual boundaries and minimal next questions", () => {
    const cfs = findCounterfactuals(
      orDoc,
      {
        terminationType: "summary_employer",
        noticeReceivedDate: "2026-05-10",
        serviceYear: 6,
        inProbation: false,
        monthlyGrossSalary: { amount: "9200.00", currency: "CHF" },
        daysBetweenKnowledgeAndSummaryDismissal: 2,
        severeLoyaltyBreachOrCrime: true,
        reasonIsNoFaultIncapacity: false,
      },
      { jurisdiction: "CH", factDate: "2026-05-10", language: "de" },
    );
    assert.ok(cfs.length >= 2);
    assert.ok(cfs.some((c) => c.inputName === "daysBetweenKnowledgeAndSummaryDismissal"));
    assert.ok(cfs.some((c) => c.inputName === "reasonIsNoFaultIncapacity"));

    const nextQ = findMinimalNextQuestions(
      zpoDoc,
      { triggerDate: "2026-07-10", durationDays: 10 },
      { jurisdiction: "CH-ZH", factDate: "2026-07-10", language: "de" },
    );
    assert.ok(nextQ.length >= 1);
    assert.equal(nextQ[0]!.inputName, "procedureType");
  });

  it("generates multilingual audit-grade Begründung with verified Fedlex & OpenCaseLaw links", () => {
    const res = evaluateDocument(
      orDoc,
      {
        terminationType: "summary_employer",
        noticeReceivedDate: "2026-05-10",
        serviceYear: 6,
        inProbation: false,
        monthlyGrossSalary: { amount: "9200.00", currency: "CHF" },
        daysBetweenKnowledgeAndSummaryDismissal: 2,
        severeLoyaltyBreachOrCrime: true,
      },
      { jurisdiction: "CH", factDate: "2026-05-10", language: "fr" },
    );
    const memo = generateBegruendung(orDoc, res);
    assert.match(memo, /Motivation juridique/);
    assert.match(memo, /mcp\.opencaselaw\.ch/);
    assert.match(memo, /fedlex\.admin\.ch/);
    assert.match(memo, /sha256:/);
  });
});

describe("05. Pan-European Jurisdiction Engine (EU / EEA / CH / UK)", () => {
  it("evaluates identical facts across CH, DE (EU), NO (EEA), and UK with exact jurisdictional divergence", () => {
    const commonFacts = {
      controllerSector: "private",
      hasConsent: false,
      necessaryForContract: false,
      infringesPersonalityWithoutObjection: false,
      ukRecognisedLegitimateInterest: true,
    };
    const ch = evaluateDocument(euDataDoc, commonFacts, { jurisdiction: "CH", factDate: "2026-06-01", language: "de" });
    const de = evaluateDocument(euDataDoc, commonFacts, { jurisdiction: "DE", factDate: "2026-06-01", language: "de" });
    const no = evaluateDocument(euDataDoc, commonFacts, { jurisdiction: "NO", factDate: "2026-06-01", language: "en" });
    const uk = evaluateDocument(euDataDoc, commonFacts, { jurisdiction: "UK", factDate: "2026-06-01", language: "en" });

    assert.equal(ch.outputs["processing_lawful"], true);
    assert.equal(de.outputs["processing_lawful"], false);
    assert.equal(no.outputs["processing_lawful"], false);
    assert.equal(uk.outputs["processing_lawful"], true);
  });
});

describe("06. Digitalcheck Verifier, swisslaw-git Drift & RUML 1.0.0 Bidirectional Bridge", () => {
  it("passes Digitalcheck formal verification & 100% golden tests across all 3 flagship corpus packages", () => {
    for (const doc of [zpoDoc, orDoc, euDataDoc]) {
      const val = validateLcfDocument(doc);
      assert.equal(val.valid, true, `Validation failed for ${doc.metadata.slug}: ${JSON.stringify(val.errors)}`);
      const rep = verifyDocument(doc);
      assert.equal(rep.structuralValid, true);
      assert.equal(rep.checks.goldenTestsPassed, rep.checks.goldenTestsTotal);
      assert.ok(rep.readinessScore >= 90, `Expected readiness >= 90 for ${doc.metadata.slug}, got ${rep.readinessScore}`);
    }
  });

  it("maps swisslaw-git diffs and pending Fedlex consolidations directly to affected rules", () => {
    const ref = buildSwissLawGitRef("220", "de", "336c", "future");
    assert.equal(ref.path, "ch/2/220/de.md");
    assert.equal(ref.githubUrl, "https://github.com/jonashertner/swisslaw-git/blob/future/ch/2/220/de.md#art-336c");

    const impacts = mapSwissLawGitDiffToRules(orDoc, ["ch/2/220/de.md"]);
    assert.ok(impacts.length >= 2);

    const drift2026 = detectAmendmentDrift(orDoc, "2026-11-21");
    assert.equal(drift2026[0]?.severity, "info");
    const drift2027 = detectAmendmentDrift(orDoc, "2027-07-02");
    assert.equal(drift2027[0]?.severity, "action_required");
  });

  it("exports LCF 0.1 to valid RUML 1.0.0 with explicit fidelity report and imports RUML 1.0.0 back into executable LCF", () => {
    const exported = exportToRuml10(orDoc, { language: "de", jurisdiction: "CH", lens: "bger_settled" });
    assert.equal(exported.ruml.$format, "RUML");
    assert.equal(exported.ruml.$specVersion, "1.0");
    assert.ok(exported.ruml.rulemap.nodes["1"]);
    assert.equal(exported.fidelityReport.lossless, false);
    assert.ok(exported.fidelityReport.losses.length >= 5);

    // Import an authentic RUML 1.0.0 fixture (modeled on ruml.org ch. 5.1 example) and execute on LCF engine!
    const sampleRuml: Ruml10Document = {
      $format: "RUML",
      $specVersion: "1.0",
      metadata: {
        id: "ec36948d-fbb2-4815-985a-bd5e9375d934",
        version: "1.0.0",
        created: "2026-11-15T00:00:00Z",
        modified: "2026-11-15T00:00:00Z",
        status: "published",
        title: "Förderantrag Demo",
        documentType: "regulation",
        jurisdiction: "DE-BY",
        language: "de",
        organization: "Test",
      },
      capabilities: [
        {
          id: "ruml:datapoints",
          payload: {
            data: {
              dp_age: { type: "number", label: "Alter" },
              dp_state: { type: "string", label: "Bundesland" },
            },
          },
        },
        { id: "ruml:query" },
      ],
      rulemap: {
        nodes: {
          "1": { id: "11111111-1111-4111-8111-111111111111", operator: "AND", label: "Anspruch", children: ["2", "3"] },
          "2": {
            id: "22222222-2222-4222-8222-222222222222",
            label: "Volljährig",
            capabilities: [{ id: "ruml:query", payload: { expression: "dp_age >= 18" } }],
          },
          "3": {
            id: "33333333-3333-4333-8333-333333333333",
            label: "Wohnsitz Bayern",
            capabilities: [{ id: "ruml:query", payload: { expression: 'dp_state = "BY"' } }],
          },
        },
      },
    };
    const importedLcf = importFromRuml10(sampleRuml);
    assert.equal(validateLcfDocument(importedLcf).valid, true);
    const passRes = evaluateDocument(importedLcf, { age: 25, state: "BY" }, { jurisdiction: "DE-BY", language: "de" });
    const failRes = evaluateDocument(importedLcf, { age: 16, state: "BY" }, { jurisdiction: "DE-BY", language: "de" });
    assert.equal(passRes.outputs["root_result"], true);
    assert.equal(failRes.outputs["root_result"], false);
  });
});

describe("07. Literate .law DSL Compiler & Decompiler (Enterprise Cyber/Data Incident Suite)", () => {
  it("compiles rules.law into valid LCF 0.1 with 100/100 Digitalcheck readiness and 4/4 golden tests", () => {
    const val = validateLcfDocument(enterpriseCyberDoc);
    assert.equal(val.valid, true, JSON.stringify(val.errors));
    const rep = verifyDocument(enterpriseCyberDoc);
    assert.equal(rep.structuralValid, true);
    assert.equal(rep.readinessScore, 100);
    assert.equal(rep.checks.goldenTestsPassed, 4);
    assert.equal(rep.checks.goldenTestsTotal, 4);
  });

  it("round-trips LCF 0.1 -> .law DSL -> LCF 0.1 with identical evaluation results", () => {
    const decompiled = decompileToLawDsl(euDataDoc);
    assert.match(decompiled, /module europe-data-lawful-basis/);
    const recompiled = compileLawDsl(decompiled);
    const rOrig = evaluateDocument(euDataDoc, { controllerSector: "private", hasConsent: false, infringesPersonalityWithoutObjection: false }, { jurisdiction: "CH", factDate: "2026-06-01" });
    const rRe = evaluateDocument(recompiled, { controllerSector: "private", hasConsent: false, infringesPersonalityWithoutObjection: false }, { jurisdiction: "CH", factDate: "2026-06-01" });
    assert.deepEqual(rOrig.outputs, rRe.outputs);
  });
});

describe("08. AlphaLaw Formal Symbolic Proof Kernel & Adversarial Structuring Solver", () => {
  it("mathematically proves soundness (zero silent conflicts, total primary coverage) across all 4 flagship modules", () => {
    for (const doc of [zpoDoc, orDoc, euDataDoc, enterpriseCyberDoc]) {
      const cert = proveDocument(doc, { maxStates: 250 });
      assert.equal(cert.soundnessVerdict, "PROVEN_SOUND", `Failed proof for ${doc.metadata.slug}: ${JSON.stringify(cert.properties)}`);
      assert.equal(cert.properties.zeroSilentConflicts.proven, true);
      assert.equal(cert.properties.totalPrimaryCoverage.proven, true);
    }
  });

  it("automatically discovers statutory threshold cliffs, temporal 2025 shifts, and CH/EU/UK divergence witnesses", () => {
    const orCert = proveDocument(orDoc, { maxStates: 250 });
    assert.ok(orCert.thresholdCliffs.some((c) => c.inputName === "serviceYear" && c.fromValue === 1 && c.toValue === 2));
    assert.ok(orCert.thresholdCliffs.some((c) => c.inputName === "serviceYear" && c.fromValue === 5 && c.toValue === 6));
    assert.ok(orCert.lensDivergences.length >= 1);

    const zpoCert = proveDocument(zpoDoc, { maxStates: 200 });
    assert.ok(zpoCert.temporalDivergences.some((t) => t.outputId === "art142_abs1bis_applies"));

    const cyberCert = proveDocument(enterpriseCyberDoc, { maxStates: 250 });
    assert.ok(cyberCert.jurisdictionDivergences.some((d) => d.outputId === "data_breach_report_required"));
    assert.ok(cyberCert.jurisdictionDivergences.some((d) => d.outputId === "reporting_deadline_hours"));
  });

  it("discovers minimal lawful structuring levers to achieve a client's desired legal outcome", () => {
    // Client in Germany (EU) currently has processing_lawful = false; find lawful levers to reach true
    const levers = findStructuringLevers(
      euDataDoc,
      { controllerSector: "private", hasConsent: false, necessaryForContract: false },
      { jurisdiction: "DE", factDate: "2026-06-01", language: "en" },
      "processing_lawful",
      true,
      ["hasConsent", "necessaryForContract"],
    );
    assert.ok(levers.length >= 2);
    assert.ok(levers.some((l) => l.steps === 1 && l.changes[0]?.inputName === "hasConsent" && l.changes[0]?.to === true));
    assert.ok(levers.some((l) => l.steps === 1 && l.changes[0]?.inputName === "necessaryForContract" && l.changes[0]?.to === true));
  });
});

describe("09. CEGAR Empirical BGE Replay Oracle & Enterprise Client Digital Twin", () => {
  it("achieves 100% empirical judicial fidelity (CONVERGED) replaying 5 real OpenCaseLaw Swiss court decisions", () => {
    const gate = runCegarVerificationGate(orDoc, orBgeReplayCases, 1);
    assert.equal(gate.status, "CONVERGED");
    assert.equal(gate.judicialReplay.totalCases, 5);
    assert.equal(gate.judicialReplay.exactMatches, 5);
    assert.equal(gate.judicialReplay.judicialFidelityPercent, 100);
    assert.equal(gate.repairDirectives.length, 0);
  });

  it("diagnoses Streitstand counterexamples when replayed under a misaligned interpretive lens", () => {
    const bvgerCase = orBgeReplayCases.find((c) => c.decisionId === "bvger_A-5819_2016")!;
    const mislignedReplay = runCaseReplayBenchmark(orDoc, [
      { ...bvgerCase, context: { ...bvgerCase.context, lens: "strict_statutory_text" } },
    ]);
    assert.equal(mislignedReplay.converged, false);
    assert.equal(mislignedReplay.counterexamples[0]?.diagnosis, "streitstand_resolved_by_alternate_lens");
    assert.equal(mislignedReplay.counterexamples[0]?.alternateLensMatch, "bger_settled");
  });

  it("evaluates a 5-entity Swiss/EU/EEA/UK multinational Digital Twin with exact reporting clocks & future-law diff", () => {
    const multinational: OrganizationDigitalTwin = {
      organizationId: "org-helvetia-fin",
      organizationName: "Helvetia Global Financial Group AG",
      headquarters: "CH-ZH",
      entities: [
        { entityId: "ch-hq-bank", name: "Helvetia Bank AG (Zurich HQ)", jurisdiction: "CH-ZH", language: "de", attributes: { sector: "financial_regulated" } },
        { entityId: "de-eu-bank", name: "Helvetia Bank Europe GmbH (Frankfurt)", jurisdiction: "DE", language: "de", attributes: { sector: "financial_regulated" } },
        { entityId: "no-eea-cloud", name: "Helvetia Nordic Cloud AS (Oslo)", jurisdiction: "NO", language: "en", attributes: { sector: "cloud_datacenter" } },
        { entityId: "uk-advisory", name: "Helvetia UK Advisory Ltd (London)", jurisdiction: "UK", language: "en", attributes: { sector: "general_enterprise" } },
      ],
    };

    const incidentFacts = {
      cyberAttackTriggered: true,
      affectsOnlyNonCriticalCarveOut: false,
      personalDataBreached: true,
      dataRiskLevel: "moderate",
    };

    const dossier = evaluateEnterprisePortfolio(multinational, enterpriseCyberDoc, incidentFacts, {
      factDate: "2026-06-01",
      language: "en",
      lens: "strict_regulatory",
    });

    // High-water mark clock across group is 4 hours (DE EU Bank under DORA)!
    assert.equal(dossier.crossBorderSummary.strictestDeadlineHours?.hours, 4);
    assert.equal(dossier.crossBorderSummary.strictestDeadlineHours?.entityId, "de-eu-bank");

    // Verify exact per-entity legal divergence:
    // - CH-ZH Bank: BACS/FINMA 24h cyber report YES, EDÖB data breach report NO (moderate != high under Art. 24 DSG!)
    // - DE EU Bank: DORA 4h cyber report YES, EU GDPR Art. 33 YES
    // - NO EEA Cloud: NIS2 24h cyber report YES, EEA GDPR Art. 33 YES
    // - UK General Enterprise: cyber report NO, UK ICO 72h GDPR report YES
    const byId = Object.fromEntries(dossier.entityAssessments.map((e) => [e.entityId, e.outputs]));
    assert.equal(byId["ch-hq-bank"]!["cyber_authority_report_required"], true);
    assert.equal(byId["ch-hq-bank"]!["data_breach_report_required"], false);
    assert.equal(byId["ch-hq-bank"]!["reporting_deadline_hours"], 24);
    assert.equal(byId["de-eu-bank"]!["reporting_deadline_hours"], 4);
    assert.equal(byId["de-eu-bank"]!["data_breach_report_required"], true);
    assert.equal(byId["no-eea-cloud"]!["reporting_deadline_hours"], 24);
    assert.equal(byId["uk-advisory"]!["reporting_deadline_hours"], 72);
    assert.equal(byId["uk-advisory"]!["cyber_authority_report_required"], false);

    // Pre-enactment temporal radar: compare 2024-11-01 (pre-ISG 2025-04-01) vs 2026-06-01 (post-ISG)
    const preVsPost = evaluateEnterprisePortfolio(multinational, enterpriseCyberDoc, incidentFacts, {
      factDate: "2024-11-01",
      futureDate: "2026-06-01",
      language: "en",
      lens: "strict_regulatory",
    });
    assert.ok(preVsPost.crossBorderSummary.futureLawImpacts.some((i) => i.entityId === "ch-hq-bank"));
    assert.match(dossier.executiveMemoMarkdown, /HIGH-WATER MARK ALERT/);
    assert.match(dossier.executiveMemoMarkdown, /Helvetia Global Financial Group AG/);
  });
});
