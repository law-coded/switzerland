export type LanguageCode = "de" | "fr" | "it" | "rm" | "en" | (string & {});

export type LocalizedText = Record<string, string>;

export type JurisdictionCode = string; // e.g. "CH", "CH-ZH", "EU", "EEA", "UK", "UK-SCT", "DE", "FR"

export type ValueType =
  | "boolean"
  | "integer"
  | "decimal"
  | "money"
  | "date"
  | "period"
  | "enum"
  | "string"
  | "list"
  | "object";

export type DeonticModality =
  | "fact"
  | "validity"
  | "obligation"
  | "permission"
  | "prohibition"
  | "claim_right"
  | "power"
  | "competence"
  | "deadline"
  | "amount"
  | "discretion";

export type AuthorityKind =
  | "statute"
  | "ordinance"
  | "treaty"
  | "eu_regulation"
  | "eu_directive"
  | "case_law"
  | "materialien"
  | "admin_directive"
  | "commentary"
  | "scholarship";

export type AuthorityLevel =
  | "supranational"
  | "constitutional"
  | "federal_statute"
  | "federal_ordinance"
  | "cantonal_statute"
  | "municipal"
  | "admin_directive"
  | "judicial_precedent"
  | "contractual";

export interface MoneyValue {
  amount: string; // Exact decimal string e.g. "8500.00"
  currency: string; // ISO 4217 e.g. "CHF", "EUR", "GBP"
}

export interface LegalPeriod {
  days?: number;
  weeks?: number;
  months?: number;
  years?: number;
}

export interface UnknownValue {
  $state: "unknown";
  reason?: string;
}

export function isUnknown(v: unknown): v is UnknownValue {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "object" &&
      v !== null &&
      "$state" in v &&
      (v as UnknownValue).$state === "unknown")
  );
}

export function isMoneyValue(v: unknown): v is MoneyValue {
  return (
    typeof v === "object" &&
    v !== null &&
    "amount" in v &&
    "currency" in v &&
    typeof (v as MoneyValue).amount === "string" &&
    typeof (v as MoneyValue).currency === "string"
  );
}

export interface LanguageDivergence {
  languages: string[];
  note: LocalizedText;
}

export interface Authority {
  kind: AuthorityKind;
  jurisdiction: JurisdictionCode;
  citation: LocalizedText;
  title?: LocalizedText;
  eli?: string;
  ecli?: string;
  opencaselawId?: string;
  swisslawGitPath?: LocalizedText;
  pinpoint?: string;
  url?: string;
  urls?: LocalizedText;
  consolidationDate?: string;
  decisionDate?: string;
  verbatimText?: LocalizedText;
  license?: string;
  languageDivergences?: LanguageDivergence[];
}

export interface BurdenOfProofSpec {
  party:
    | "claimant"
    | "respondent"
    | "employer"
    | "employee"
    | "controller"
    | "data_subject"
    | "authority"
    | "court_ex_officio";
  factRole:
    | "right_creating"
    | "right_hindering"
    | "right_extinguishing"
    | "procedural";
  standard?:
    | "full_proof"
    | "preponderance"
    | "prima_facie"
    | "beyond_reasonable_doubt";
  legalBasis?: string;
  onUnknown: "resolve_false" | "resolve_true" | "keep_unknown" | "escalate_human";
}

export interface InputSpec {
  type: ValueType;
  label: LocalizedText;
  description?: LocalizedText;
  required?: boolean;
  enumValues?: string[];
  enumLabels?: Record<string, LocalizedText>;
  unit?: string;
  defaultValue?: unknown;
  burdenOfProof?: BurdenOfProofSpec;
  counterfactualStep?: number | string | unknown[];
}

export interface LensSpec {
  id: string;
  label: LocalizedText;
  description: LocalizedText;
  default?: boolean;
  authorities?: string[];
}

export interface RuleScope {
  jurisdictions?: JurisdictionCode[];
  authorityLevel?: AuthorityLevel;
  lenses?: string[];
}

export interface RuleTemporal {
  basis?: "factDate" | "decisionDate" | "lawVersion";
  validFrom?: string;
  validUntil?: string;
  transitionalNote?: LocalizedText;
}

/**
 * Typed declarative expression AST (strictly deterministic, statically inspectable,
 * compilable to SMT/counterfactual solvers and projectable to RUML 1.0.0).
 */
export type Expr =
  | { op: "lit"; value: unknown }
  | { op: "input"; name: string }
  | { op: "ref"; target: string }
  | { op: "context"; field: "jurisdiction" | "factDate" | "decisionDate" | "lawVersion" | "lens" }
  | { op: "and"; args: Expr[] }
  | { op: "or"; args: Expr[] }
  | { op: "not"; arg: Expr }
  | { op: "eq"; left: Expr; right: Expr }
  | { op: "neq"; left: Expr; right: Expr }
  | { op: "gt"; left: Expr; right: Expr }
  | { op: "gte"; left: Expr; right: Expr }
  | { op: "lt"; left: Expr; right: Expr }
  | { op: "lte"; left: Expr; right: Expr }
  | { op: "in"; value: Expr; list: Expr }
  | { op: "is_known"; arg: Expr }
  | { op: "if"; cond: Expr; then: Expr; else: Expr }
  | { op: "add"; args: Expr[] }
  | { op: "sub"; left: Expr; right: Expr }
  | { op: "mul"; left: Expr; right: Expr }
  | { op: "min"; args: Expr[] }
  | { op: "max"; args: Expr[] }
  | { op: "money_mul"; money: Expr; factor: Expr }
  | { op: "money_add"; args: Expr[] }
  | { op: "money_sub"; left: Expr; right: Expr }
  | { op: "money_min"; args: Expr[] }
  | { op: "money_max"; args: Expr[] }
  | { op: "money_zero"; currency: string }
  | { op: "days_between"; from: Expr; to: Expr }
  | { op: "zpo_deadline"; triggerDate: Expr; deliveryMethod: Expr; durationDays?: Expr; durationMonths?: Expr; suspensionApplies: Expr; canton: Expr; applyArt142Abs1bis: Expr }
  | { op: "or_termination_end_date"; noticeReceivedDate: Expr; noticeMonths: Expr; inProbation: Expr; probationDays?: Expr; incapacityDuringNoticeDays?: Expr; sperrfristCapDays?: Expr; extraParentalLeaveDays?: Expr; endOfMonthOnly?: Expr }
  | { op: "record"; fields: Record<string, Expr> };

export interface SubsumtionFactor {
  id: string;
  label: LocalizedText;
  direction: "pro" | "contra" | "disqualifying";
  weight: number;
  authorityRef: string;
  when: Expr;
  evidenceInput?: string;
}

export interface SubsumtionContract {
  legalConcept: LocalizedText;
  disqualifiers?: Array<{
    id: string;
    label: LocalizedText;
    authorityRef: string;
    when: Expr;
  }>;
  factors: SubsumtionFactor[];
  escalationBand: {
    low: number;
    high: number;
  };
  requiresHumanReviewLabel?: LocalizedText;
}

export type RuleKind =
  | "base"
  | "exception"
  | "counter_exception"
  | "overlay"
  | "derivation"
  | "subsumtion";

export interface Rule {
  id: string;
  target: string;
  kind: RuleKind;
  label: LocalizedText;
  explanation?: LocalizedText;
  authorities: string[];
  scope?: RuleScope;
  temporal?: RuleTemporal;
  priority?: number;
  overrides?: string[];
  burdenOfProof?: BurdenOfProofSpec;
  when?: Expr;
  compute?: Expr;
  subsumtion?: SubsumtionContract;
}

export interface OutputSpec {
  id: string;
  target: string;
  label: LocalizedText;
  valueType: ValueType;
  modality?: DeonticModality;
  primary?: boolean;
}

export interface GoldenTestCase {
  id: string;
  name: string;
  authorityRef?: string;
  context?: Partial<EvaluationContext>;
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export interface PendingChangeNotice {
  effectiveDate: string;
  sourceUri?: string;
  summary: LocalizedText;
}

export interface LcfMetadata {
  id: string;
  slug: string;
  version: string;
  status: "draft" | "review" | "active" | "superseded" | "archived";
  title: LocalizedText;
  description?: LocalizedText;
  jurisdictions: JurisdictionCode[];
  languages: LanguageCode[];
  legalDomains?: string[];
  created: string;
  modified: string;
  license?: string;
  maintainers?: Array<{
    name: string;
    organization?: string;
    url?: string;
  }>;
  pendingChanges?: PendingChangeNotice[];
}

export interface LcfDocument {
  $format: "LCF";
  $specVersion: string;
  metadata: LcfMetadata;
  authorities: Record<string, Authority>;
  inputs: Record<string, InputSpec>;
  lenses?: LensSpec[];
  rules: Rule[];
  outputs: OutputSpec[];
  tests?: GoldenTestCase[];
}

export interface EvaluationContext {
  jurisdiction: JurisdictionCode;
  language: LanguageCode;
  factDate: string;
  decisionDate: string;
  lawVersion: string;
  lens: string;
  mode: "triage" | "adjudicate";
}

export type TraceStatus =
  | "applied"
  | "defeated"
  | "condition_false"
  | "condition_unknown"
  | "resolved_by_burden_of_proof"
  | "inactive_temporal"
  | "inactive_jurisdiction"
  | "inactive_lens"
  | "escalate_human"
  | "conflict";

export interface SubsumtionTraceDetail {
  legalConcept: string;
  disqualifiedBy?: { id: string; label: string; authorityRef: string };
  score: number;
  escalationBand: { low: number; high: number };
  verdict: "fulfilled" | "not_fulfilled" | "escalate_human";
  triggeredFactors: Array<{
    id: string;
    label: string;
    direction: "pro" | "contra" | "disqualifying";
    weight: number;
    authorityRef: string;
    evidenceValue?: unknown;
  }>;
}

export interface TraceEntry {
  ruleId: string;
  target: string;
  kind: RuleKind;
  label: string;
  status: TraceStatus;
  value?: unknown;
  defeatedBy?: string;
  explanation?: string;
  authorities: string[];
  missingInputs?: string[];
  burdenResolution?: {
    party: string;
    factRole: string;
    legalBasis?: string;
    resolvedTo: unknown;
  };
  subsumtionDetail?: SubsumtionTraceDetail;
}

export interface EscalationItem {
  ruleId: string;
  target: string;
  reason: string;
  authorities: string[];
  subsumtionDetail?: SubsumtionTraceDetail;
}

export interface ConflictItem {
  target: string;
  ruleIds: string[];
  values: unknown[];
  authorities: string[];
}

export interface EvaluationResult {
  $format: "LCF-Result";
  $specVersion: string;
  documentRef: {
    id: string;
    slug: string;
    version: string;
    canonicalHash: string;
  };
  context: EvaluationContext;
  outputs: Record<string, unknown>;
  resolvedTargets: Record<string, unknown>;
  trace: TraceEntry[];
  escalations: EscalationItem[];
  conflicts: ConflictItem[];
  citationsUsed: string[];
}

export function pickText(text: LocalizedText | undefined, lang: string, fallback = ""): string {
  if (!text) return fallback;
  if (text[lang] !== undefined) return text[lang];
  if (text["en"] !== undefined) return text["en"];
  if (text["de"] !== undefined) return text["de"];
  const firstKey = Object.keys(text)[0];
  return firstKey !== undefined ? (text[firstKey] ?? fallback) : fallback;
}
