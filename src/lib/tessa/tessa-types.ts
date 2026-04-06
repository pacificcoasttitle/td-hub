// ============================================================
// TESSA™ Type Definitions
// Shared interfaces for the prelim analysis engine
// ============================================================

// ── Tax Types ────────────────────────────────────────────────

export interface PropertyTax {
  item_no: number
  tax_id: string
  fiscal_year: string
  first_installment: string
  first_installment_status: 'DELINQUENT' | 'PAID' | 'OPEN'
  first_installment_amount: string | null
  first_penalty: string | null
  second_installment: string
  second_installment_status: 'DELINQUENT' | 'PAID' | 'OPEN'
  second_installment_amount: string | null
  second_penalty: string | null
  homeowners_exemption: string | null
  code_area: string | null
}

export interface TaxRedemptionScheduleEntry {
  amount: string
  by: string
  amount_numeric: number
}

export interface TaxDefault {
  item_no: number
  default_no: string | null
  apn: string | null
  message: string
  redemption_schedule: TaxRedemptionScheduleEntry[]
}

export interface OtherAssessment {
  item_no: number
  type: string
  total_amount?: string
  details: string
}

export interface TaxFacts {
  property_taxes: PropertyTax[]
  tax_defaults: TaxDefault[]
  other_assessments: OtherAssessment[]
  total_delinquent_amount: number
  total_redemption_amount: number
  has_delinquent_taxes: boolean
}

// ── Requirement Types ─────────────────────────────────────────

export type RequirementSeverity = 'blocker' | 'material' | 'informational'

export type RequirementType =
  | 'reconveyance_confirmation'
  | 'reconveyance_package'
  | 'statement_of_information'
  | 'statement_of_information_hits'
  | 'spousal_joinder'
  | 'corp_authority'
  | 'llc_authority'
  | 'trust_docs'
  | 'suspended_corp_cure'
  | 'hoa_clearance'
  | 'multi_beneficiary_demand'
  | 'unrecorded_docs_review'
  | 'survey_inspection'
  | 'underwriting_review'
  | 'unspecified'

export interface RequirementClassification {
  summary: string
  type: RequirementType
  severity: RequirementSeverity
}

export interface Requirement {
  item_no: number | null
  text: string
  classification: RequirementClassification
}

// ── Lien / DOT Types ─────────────────────────────────────────

export interface FractionalInterest {
  numerator: string
  denominator: string
}

export interface DotAssignment {
  assignee: string
  recording_no?: string
}

export interface DotSubstitution {
  new_trustee: string
  recording_no?: string
}

export interface DeedOfTrust {
  item_no: number
  position: number
  amount: string | null
  dated: string | null
  trustor: string | null
  trustee: string | null
  beneficiary: string | null
  loan_no: string | null
  recording_date: string | null
  recording_no: string | null
  assignments: DotAssignment[]
  substitutions: DotSubstitution[]
  has_notice_of_default: boolean
  has_notice_of_trustee_sale: boolean
  sale_date: string | null
  sale_time: string | null
  sale_location: string | null
  fractional_interests: FractionalInterest[]
}

export interface HOALien {
  item_no: number
  type: 'HOA Assessment Lien'
  association_name: string | null
  amount: string | null
  recording_date: string | null
  recording_no: string | null
  status: string
}

export interface AssignmentOfRents {
  item_no: number
  amount: string | null
  assigned_to: string | null
  assigned_by: string | null
  recording_date: string | null
  recording_no: string | null
}

export interface Easement {
  item_no: number
  purpose: string | null
  in_favor_of: string | null
  affects: string | null
  recording_no: string | null
}

export interface CCR {
  item_no: number
  recording_no: string | null
  recording_book_page: string | null
  modifications: string[]
  violation_clause: boolean
}

// ── Ownership / Property Types ────────────────────────────────

export type VestingType = 'individual' | 'trust' | 'corporate' | 'llc' | 'tic'

export interface TICInterest {
  party: string
  percentage: number
}

export interface OwnershipStructure {
  vesting_type: VestingType
  vestees: string[]
  is_trust: boolean
  trust_name: string | null
  trust_date: string | null
  is_tic: boolean
  tic_interests: TICInterest[]
  is_corporate: boolean
  is_llc: boolean
  requires_spousal_joinder: boolean
  married_persons: string[]
}

export interface RecentConveyance {
  grantor: string
  grantee: string
  recording_date: string
  recording_no: string
  days_ago: number | null
  is_recent: boolean
  seasoning_concern: boolean
}

export interface ForeclosureFlag {
  item_no: number
  type: 'us_redemption' | 'trustees_deed_exception' | 'notice_of_trustee_sale'
  text: string
  sale_date?: string | null
  sale_time?: string | null
  sale_location?: string | null
}

export interface SolarNotice {
  company: string
  recording_no: string | null
  recording_date: string | null
  context: string | null
}

export interface SpecialFlags {
  solar_flag: boolean
  ucc_flag: boolean
  solar_notice: SolarNotice | null
  trust_flag: boolean
  trust_cert_required: boolean
  reconveyance_package_required: boolean
  easement_estate: boolean
  has_active_foreclosure: boolean
  has_hoa_lien: boolean
  has_tax_default: boolean
  has_delinquent_taxes: boolean
  is_out_of_state: boolean
  has_tic_ownership: boolean
  has_recent_conveyance: boolean
  has_multiple_dots: boolean
  has_fractional_beneficiaries: boolean
  has_assignment_of_rents: boolean
  has_easements: boolean
  has_ccrs: boolean
}

export interface PropertyState {
  code: string
  name: string
  is_california: boolean
}

export interface PropertyType {
  is_sfr: boolean
  is_multi_family: boolean
  is_commercial: boolean
  is_industrial: boolean
  is_land: boolean
  is_condo: boolean
  is_pud: boolean
  description: string
}

export interface PropertyInfo {
  address: string | null
  apn: string | null
  effective_date: string | null
  proposed_lender: string | null
  proposed_loan_amount: string | null
  state: PropertyState
  property_type: PropertyType
}

// ── Master Facts Object ───────────────────────────────────────

export interface PrelimFacts {
  property: PropertyInfo
  scheduleA_subject_to_items: number[]
  taxes: TaxFacts
  requirements: Requirement[]
  foreclosure_flags: ForeclosureFlag[]
  special_flags: SpecialFlags
  deeds_of_trust: DeedOfTrust[]
  hoa_liens: HOALien[]
  assignment_of_rents: AssignmentOfRents[]
  easements: Easement[]
  ccrs: CCR[]
  ownership_structure: OwnershipStructure
  recent_conveyances: RecentConveyance[]
}

// ── UI / Section Types ────────────────────────────────────────

export interface ParsedSection {
  title: string
  content: string
  icon: string
  colorClass: string
  borderColor: string
  itemCount: number
  preview: string
  order: number
}

export interface CheatSheetItem {
  itemNumbers: number[]
  label: string
  severity: RequirementSeverity
  whyItMatters: string
  who: string
  timing: string
  agentScript: string
}

// ── Analysis Hook State ───────────────────────────────────────

export type AnalysisStatus =
  | 'idle'
  | 'extracting'          // PDF.js pulling text
  | 'computing_facts'     // Pre-parser running (client-side, no LLM)
  | 'analyzing'           // LLM Call 1: structured JSON extraction
  | 'validating'          // Guardrails: validate extraction against pre-parser facts
  | 'summarizing'         // LLM Call 2: plain-English summary
  | 'complete'
  | 'error'

// ── Extracted Analysis Types (JSON pipeline) ─────────────────
// These match the JSON schema returned by the extraction LLM call.

export interface ExtractedRequirement {
  item_number: number | null
  description: string
  action: string
  severity: 'blocker' | 'material' | 'informational'
  type: string
  related_instrument: string | null
  assignee: string | null
}

export interface ExtractedPropertyInfo {
  apn: string | null
  address: string | null
  legal_description: string | null
  vesting: string | null
  property_type: string | null
  ownership_structure: string | null
}

export interface ExtractedLien {
  position: number
  type: string
  amount: string | null
  beneficiary: string
  trustor: string | null
  recording_ref: string | null
  recording_date: string | null
  assigned_to: string | null
  action_required: string | null
}

export interface ExtractedTaxInstallment {
  amount: string
  status: 'paid' | 'open' | 'delinquent' | 'defaulted'
}

export interface ExtractedTax {
  tax_id: string
  fiscal_year: string | null
  first_installment: ExtractedTaxInstallment
  second_installment: ExtractedTaxInstallment
  exemption: string | null
  code_area: string | null
  total_tax: string | null
  penalties: string | null
}

export interface ExtractedTaxDefault {
  tax_id: string
  default_year: string
  amount: string
  redemption_info: string | null
}

export interface ExtractedOtherFinding {
  item_number: number | null
  type: string
  description: string
  impact: 'high' | 'medium' | 'low'
  action: string | null
  recording_ref: string | null
}

export interface ExtractedDocumentStatus {
  appears_complete: boolean
  document_date: string | null
  order_number: string | null
  missing_sections: string[]
  notes: string | null
}

export interface ExtractedAnalysis {
  title_requirements: ExtractedRequirement[]
  property_info: ExtractedPropertyInfo
  liens: ExtractedLien[]
  taxes: ExtractedTax[]
  tax_defaults: ExtractedTaxDefault[]
  other_findings: ExtractedOtherFinding[]
  document_status: ExtractedDocumentStatus
  schedule_a_subjects: number[]
  foreclosure_detected: boolean
  recent_conveyance_detected: boolean
}
