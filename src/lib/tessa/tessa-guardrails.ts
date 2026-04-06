// ============================================================
// TESSA™ Guardrails System
// Post-processes AI output: injects deterministic facts,
// validates sections, triggers one repair call if needed.
// Ported from tessa-enhanced-script-3.3.0-guardrails.js
// ============================================================

import type { PrelimFacts, ExtractedAnalysis } from './tessa-types'

// ── Section helpers ───────────────────────────────────────────

export function getSectionBlock(text: string, header: string): string | null {
  const re = new RegExp(`\\*\\*${header}\\*\\*[\\s\\S]*?(?=\\*\\*[A-Z]|$)`, 'i')
  const m = (text || '').match(re)
  return m ? m[0] : null
}

export function replaceSectionBlock(original: string, header: string, newBlock: string): string {
  const re = new RegExp(`\\*\\*${header}\\*\\*[\\s\\S]*?(?=\\*\\*[A-Z]|$)`, 'i')
  if (!re.test(original || '')) {
    return (original || '') + '\n\n' + newBlock.trim() + '\n'
  }
  return (original || '').replace(re, newBlock.trim() + '\n\n')
}

// ── Deterministic Tax Renderer ────────────────────────────────

export function renderTaxesMarkdown(facts: PrelimFacts): string {
  const taxes = facts?.taxes || {}
  const propertyTaxes = taxes.property_taxes || []
  const taxDefaults = taxes.tax_defaults || []
  const other = taxes.other_assessments || []

  let out = `**TAXES AND ASSESSMENTS**\n`

  if (typeof taxes.total_delinquent_amount === 'number' && taxes.total_delinquent_amount > 0) {
    out += `\n- Total delinquent tax amount (est.): $${taxes.total_delinquent_amount.toFixed(2)}\n`
  }
  if (typeof taxes.total_redemption_amount === 'number' && taxes.total_redemption_amount > 0) {
    out += `- Total current redemption (est., across parcels): $${taxes.total_redemption_amount.toFixed(2)}\n`
  }

  if (propertyTaxes.length) {
    out += `For Property Taxes:\n`
    for (const t of propertyTaxes) {
      out += `- Tax ID: ${t.tax_id || 'Not stated'}\n`
      out += `- Fiscal Year: ${t.fiscal_year || 'Not stated'}\n`
      out += `- 1st Installment: ${t.first_installment || 'Not stated'}\n`
      out += `- 1st Installment Penalty: ${t.first_penalty || 'Not stated'}\n`
      out += `- 2nd Installment: ${t.second_installment || 'Not stated'}\n`
      out += `- 2nd Installment Penalty: ${t.second_penalty || 'Not stated'}\n`
      out += `- Homeowners Exemption: ${t.homeowners_exemption ?? 'Not stated'}\n`
      out += `- Code Area: ${t.code_area || 'Not stated'}\n`
    }
  } else {
    out += `For Property Taxes:\n- Tax ID: Not stated\n- Fiscal Year: Not stated\n- 1st Installment: Not stated\n- 1st Installment Penalty: Not stated\n- 2nd Installment: Not stated\n- 2nd Installment Penalty: Not stated\n- Homeowners Exemption: Not stated\n- Code Area: Not stated\n`
  }

  if (taxDefaults.length) {
    out += `\nFor Tax Defaults / Redemptions:\n`
    for (const d of taxDefaults) {
      out += `- Default No.: ${d.default_no || 'Not stated'}\n`
      if (d.redemption_schedule?.length) {
        const lines = d.redemption_schedule.map((s) => `Amount: ${s.amount}, by ${s.by}`).join('; ')
        out += `- Redemption schedule: ${lines}\n`
      } else {
        out += `- Redemption schedule: Not stated\n`
      }
    }
  }

  if (other.length) {
    out += `\nFor Other Assessments:\n`
    for (const a of other) {
      out += `- Type: ${a.type || 'Not stated'}\n`
      out += `- Total Amount: ${(a as { total_amount?: string }).total_amount || 'Not stated'}\n`
      out += `- Details: ${a.details || 'Not stated'}\n`
    }
  } else {
    out += `\nFor Other Assessments:\n- Type: Supplemental taxes (if any)\n- Total Amount: Not stated\n- Details: Not stated\n`
  }

  return out
}

// ── Deterministic Requirements Renderer ──────────────────────

export function renderCompanyRequirementsMarkdown(facts: PrelimFacts): string {
  const reqs = facts?.requirements || []

  if (!reqs.length) {
    return `REQUIREMENTS (Company stated)\n- No specific company-stated requirements found.\n`
  }

  const groups = new Map<string, { sample: (typeof reqs)[0]; items: typeof reqs }>()
  for (const r of reqs) {
    const type = r.classification?.type || 'unspecified'
    const key = type !== 'unspecified' ? type : (r.classification?.summary || (r.text || '').slice(0, 40))
    if (!groups.has(key)) groups.set(key, { sample: r, items: [] })
    groups.get(key)!.items.push(r)
  }

  let out = `REQUIREMENTS (Company stated)\n`
  for (const [, g] of groups) {
    const nums = g.items
      .map((x) => x.item_no)
      .filter(Boolean)
      .sort((a, b) => (a ?? 0) - (b ?? 0))
    const itemLabel =
      nums.length > 1
        ? `Items #${nums.join(' & #')}`
        : nums.length === 1
        ? `Item #${nums[0]}`
        : `Item`
    const label =
      g.sample.classification?.summary ||
      (g.sample.text || '').replace(/\s+/g, ' ').trim().slice(0, 100) ||
      'Company-stated requirement'
    const severity = g.sample.classification?.severity === 'blocker' ? '[BLOCKER]' : '[Material]'
    out += `- ${itemLabel}: ${label} ${severity}\n`
  }

  return out
}

// ── Deterministic Injections ──────────────────────────────────

export function injectDeterministicRequirements(tessaResponse: string, facts: PrelimFacts): string {
  let trBlock = getSectionBlock(tessaResponse, 'TITLE REQUIREMENTS') || '**TITLE REQUIREMENTS**\n'
  const reqMd = renderCompanyRequirementsMarkdown(facts || ({} as PrelimFacts))

  if (/REQUIREMENTS\s*\(Company stated\)/i.test(trBlock)) {
    trBlock = trBlock.replace(
      /REQUIREMENTS\s*\(Company stated\)[\s\S]*?(?=\n[A-Z][A-Z ]+\(|\n\*\*|CLEARING ITEMS|$)/i,
      reqMd.trim() + '\n\n'
    )
  } else {
    if (/ACTION LIST/i.test(trBlock)) {
      trBlock = trBlock.replace(
        /(ACTION LIST[\s\S]*?)(\n\n|\nCLEARING|\nPRIORITY|\n\*\*|$)/i,
        `$1\n\n${reqMd.trim()}\n$2`
      )
    } else {
      trBlock = trBlock.trim() + '\n\n' + reqMd.trim() + '\n'
    }
  }

  return replaceSectionBlock(tessaResponse, 'TITLE REQUIREMENTS', trBlock)
}

export function injectPropertyInfoGuardrails(response: string, facts: PrelimFacts): string {
  const flags = facts?.special_flags || {}
  const prop = facts?.property || {}
  const state = prop.state || { code: 'UNKNOWN', name: 'Unknown', is_california: false }
  const own = facts?.ownership_structure || {}

  const block = getSectionBlock(response, 'PROPERTY INFORMATION')
  if (!block) return response

  let updated = block.trim()

  if (flags.easement_estate && !/easement parcel|parcel\s*2\s*easement|easement estate/i.test(updated)) {
    updated += `\n- Estate note: Includes an easement parcel (Parcel 2). Confirm access/right-of-way terms.`
  }
  if (flags.is_out_of_state && !/out[-\s]*of[-\s]*state|non[-\s]*california|\bAZ\b|\bNV\b|\bTX\b/i.test(updated)) {
    updated += `\n- State note: Property appears to be in ${state.name} (${state.code}). State-specific title and foreclosure rules apply.`
  }
  if (flags.has_tic_ownership && !/tenants in common|\bTIC\b/i.test(updated)) {
    let pct = ''
    if (own?.tic_interests && own.tic_interests.length) {
      pct = ' ' + own.tic_interests.map((x) => `${x.party} ${x.percentage}%`).join(', ')
    }
    updated += `\n- Ownership note: Tenants in Common (TIC). All TIC parties must sign to convey/encumber.${pct ? ' Interests:' + pct : ''}`
  }
  if (prop.property_type?.description && prop.property_type.description !== 'Unknown' && !/Property type:/i.test(updated)) {
    updated += `\n- Property type: ${prop.property_type.description}`
  }

  return replaceSectionBlock(response, 'PROPERTY INFORMATION', updated + '\n')
}

export function injectOtherFindingsGuardrails(response: string, _facts: PrelimFacts): string {
  return response
}

export function injectLiensGuardrails(response: string, facts: PrelimFacts): string {
  const flags = facts?.special_flags || {}
  const dots = facts?.deeds_of_trust || []
  const hoa = facts?.hoa_liens || []

  const block = getSectionBlock(response, 'LIENS AND JUDGMENTS') || '**LIENS AND JUDGMENTS**\n'
  let updated = block

  const hasHOA = /HOA|Homeowners Association|assessment lien/i.test(block)
  const dotMentions = (block.match(/Deed of Trust/gi) || []).length

  if (hoa.length && !hasHOA) {
    for (const l of hoa) {
      updated += `\n- Priority: Unclear\n- Type: HOA Assessment Lien\n- Beneficiary/Creditor: ${l.association_name || 'HOA'}\n- Recording ref: ${l.recording_no || 'Not stated'}${l.recording_date ? ', ' + l.recording_date : ''}\n- Amount: ${l.amount || 'Not stated'}\n- Status: ${l.status || 'Delinquent'}\n- Action: Obtain HOA payoff/clearance and release\n- Foreclosure/Default info: HOA lien may impact closing until cleared\n`
    }
  }

  if (dots.length && dotMentions < dots.length) {
    const already = new Set<string>()
    const rxRec = /Recording ref:\s*([0-9]{6,})/gi
    let m: RegExpExecArray | null
    while ((m = rxRec.exec(block)) !== null) already.add(m[1])

    for (const d of dots) {
      if (d.recording_no && already.has(d.recording_no)) continue
      updated += `\n- Priority: Unclear\n- Type: Deed of Trust\n- Beneficiary/Creditor: ${d.beneficiary || 'Not stated'}\n- Recording ref: ${d.recording_no || 'Not stated'}${d.recording_date ? ', ' + d.recording_date : ''}\n- Amount: ${d.amount || 'Not stated'}\n- Status: Open\n- Action: Obtain payoff demand and reconveyance\n- Foreclosure/Default info: ${d.has_notice_of_trustee_sale ? `Notice of Trustee's Sale${d.sale_date ? ' (' + d.sale_date + ')' : ''}` : 'None stated'}\n`
    }
  }

  if (flags.has_active_foreclosure && !/Notice of Trustee/i.test(updated)) {
    const nts = (facts?.foreclosure_flags || []).find((f) => f.type === 'notice_of_trustee_sale')
    if (nts) {
      updated += `\n- Foreclosure/Default info: ACTIVE Notice of Trustee's Sale${nts.sale_date ? ' — Sale ' + nts.sale_date : ''}${nts.sale_time ? ' at ' + nts.sale_time : ''}${nts.sale_location ? ' (' + nts.sale_location + ')' : ''}.\n`
    }
  }

  return replaceSectionBlock(response, 'LIENS AND JUDGMENTS', updated)
}

export function injectSummaryGuardrails(response: string, facts: PrelimFacts): string {
  const flags = facts?.special_flags || {}
  const state = facts?.property?.state || { code: 'UNKNOWN', name: 'Unknown', is_california: false }
  const recent = (facts?.recent_conveyances || []).filter((c) => c.is_recent)

  const block = getSectionBlock(response, 'SUMMARY')
  if (!block) return response

  let updated = block.trim()

  if (flags.has_active_foreclosure && !/trustee\W?s sale|foreclosure/i.test(updated)) {
    updated += `\n- Note: Active foreclosure language detected. Confirm sale status and coordinate payoff/postponement immediately.`
  }
  if (flags.has_tax_default && !/tax default|redemption/i.test(updated)) {
    updated += `\n- Note: Tax default / redemption amounts are present. Redemption payoff(s) must be cleared prior to closing.`
  }
  if (flags.has_delinquent_taxes && !/delinquent/i.test(updated)) {
    updated += `\n- Note: Delinquent tax installments are shown and include penalties.`
  }
  if (flags.is_out_of_state && !/out[-\s]*of[-\s]*state|non[-\s]*california|\bAZ\b|\bNV\b|\bTX\b/i.test(updated)) {
    updated += `\n- Note: Out-of-state property (${state.code}). State-specific requirements apply.`
  }
  if (recent.length && !/recent conveyance|seasoning/i.test(updated)) {
    updated += `\n- Note: Recent conveyance detected. Confirm lender seasoning requirements and review chain of title timing.`
  }

  return replaceSectionBlock(response, 'SUMMARY', updated + '\n')
}

// ── Validator ─────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean
  missing: {
    requirements_items: number[]
    tax_default_numbers: string[]
    tax_default_lines: Array<{ default_no: string; amount: string; by: string }>
    property_tax_ids: string[]
    foreclosure_flag: boolean
    missing_tax_defaults_section: boolean
    missing_solar_callout: boolean
    missing_ucc_callout: boolean
    missing_estate_note: boolean
    missing_trust_requirement: boolean
    missing_reconveyance_requirement: boolean
    missing_hoa_lien: boolean
    missing_out_of_state_note: boolean
    missing_tic_note: boolean
    missing_dot_count: boolean
    missing_assignment_of_rents: boolean
    missing_easements: boolean
    missing_ccrs: boolean
    missing_recent_conveyance_note: boolean
    missing_delinquent_tax_flag: boolean
    missing_fractional_beneficiaries_flag: boolean
  }
}

function validateRequirementsInTitleSection(facts: PrelimFacts, fullOut: string): number[] {
  const tr = getSectionBlock(fullOut, 'TITLE REQUIREMENTS') || ''
  const missing: number[] = []
  for (const r of facts?.requirements || []) {
    if (!r.item_no) continue
    const re = new RegExp(`Item\\s*#?\\s*${r.item_no}\\b|Items?\\s*#?\\s*${r.item_no}\\b`, 'i')
    if (!re.test(tr)) missing.push(r.item_no)
  }
  return [...new Set(missing)]
}

export function validatePrelimOutput(facts: PrelimFacts, outputText: string): ValidationResult {
  const out = outputText || ''
  const missing: ValidationResult['missing'] = {
    requirements_items: [],
    tax_default_numbers: [],
    tax_default_lines: [],
    property_tax_ids: [],
    foreclosure_flag: false,
    missing_tax_defaults_section: false,
    missing_solar_callout: false,
    missing_ucc_callout: false,
    missing_estate_note: false,
    missing_trust_requirement: false,
    missing_reconveyance_requirement: false,
    missing_hoa_lien: false,
    missing_out_of_state_note: false,
    missing_tic_note: false,
    missing_dot_count: false,
    missing_assignment_of_rents: false,
    missing_easements: false,
    missing_ccrs: false,
    missing_recent_conveyance_note: false,
    missing_delinquent_tax_flag: false,
    missing_fractional_beneficiaries_flag: false,
  }

  missing.requirements_items = validateRequirementsInTitleSection(facts, out)

  for (const t of facts?.taxes?.property_taxes || []) {
    if (t.tax_id && t.tax_id !== 'Not stated' && !out.includes(t.tax_id)) {
      missing.property_tax_ids.push(t.tax_id)
    }
  }

  const taxDefaults = facts?.taxes?.tax_defaults || []
  if (taxDefaults.length) {
    if (!/For Tax Defaults\s*\/\s*Redemptions/i.test(out)) missing.missing_tax_defaults_section = true
    for (const d of taxDefaults) {
      const dn = (d.default_no || '').toString()
      if (dn && !out.includes(dn)) missing.tax_default_numbers.push(dn)
      for (const s of d.redemption_schedule || []) {
        const hasAmount = s.amount && out.includes(s.amount)
        const hasBy = s.by && new RegExp(s.by.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)
        if (!hasAmount || !hasBy) {
          missing.tax_default_lines.push({ default_no: dn || 'Not stated', amount: s.amount, by: s.by })
        }
      }
    }
  }

  const hasNTS = (facts?.foreclosure_flags || []).some((f) => f.type === 'notice_of_trustee_sale')
  if (hasNTS && !/Notice of Trustee['']?s Sale/i.test(out)) missing.foreclosure_flag = true

  missing.requirements_items = [...new Set(missing.requirements_items)]
  missing.tax_default_numbers = [...new Set(missing.tax_default_numbers)]
  missing.property_tax_ids = [...new Set(missing.property_tax_ids)]

  const flags = facts?.special_flags || {}
  const otherBlock = getSectionBlock(out, 'OTHER FINDINGS') || ''
  const propBlock = getSectionBlock(out, 'PROPERTY INFORMATION') || ''
  const trBlock = getSectionBlock(out, 'TITLE REQUIREMENTS') || ''
  const liensBlock = getSectionBlock(out, 'LIENS AND JUDGMENTS') || ''
  const summaryBlock = getSectionBlock(out, 'SUMMARY') || ''

  if (flags.solar_flag && !/solar|sunrun|solar energy/i.test(otherBlock)) missing.missing_solar_callout = true
  if (flags.ucc_flag && !/\bucc\b|financing statement|fixture filing/i.test(otherBlock)) missing.missing_ucc_callout = true
  if (flags.easement_estate && !/easement parcel|parcel\s*2\s*easement|easement estate/i.test(propBlock)) missing.missing_estate_note = true
  if (flags.trust_cert_required && !/18100\.5|certification\s+of\s+trust|trust certification/i.test(trBlock)) missing.missing_trust_requirement = true
  if (flags.reconveyance_package_required && !/original note|request for full reconveyance|reconveyance package|demands signed by all beneficiaries/i.test(trBlock)) missing.missing_reconveyance_requirement = true
  if (flags.has_hoa_lien && !/HOA|Homeowners Association|assessment lien/i.test(liensBlock)) missing.missing_hoa_lien = true
  if (flags.is_out_of_state && !(/out[-\s]*of[-\s]*state|non[-\s]*california|\bAZ\b|\bNV\b|\bTX\b/i.test(propBlock) || /out[-\s]*of[-\s]*state|non[-\s]*california|\bAZ\b|\bNV\b|\bTX\b/i.test(summaryBlock))) missing.missing_out_of_state_note = true
  if (flags.has_tic_ownership && !/tenants in common|\bTIC\b|all\s+TIC\s+parties\s+must\s+sign/i.test(propBlock)) missing.missing_tic_note = true
  if ((facts.deeds_of_trust || []).length > 0) {
    const dotMentions = (liensBlock.match(/Deed of Trust/gi) || []).length
    if (dotMentions < facts.deeds_of_trust.length) missing.missing_dot_count = true
  }
  if (flags.has_fractional_beneficiaries && !/fractional|undivided|multiple beneficiaries|all beneficiaries/i.test(out)) missing.missing_fractional_beneficiaries_flag = true
  if (flags.has_assignment_of_rents && !/assignment of rents/i.test(otherBlock) && !/assignment of rents/i.test(liensBlock)) missing.missing_assignment_of_rents = true
  if (flags.has_easements && !/\beasement\b|right of way|r\/?w/i.test(otherBlock)) missing.missing_easements = true
  if (flags.has_ccrs && !/cc&r|cc\&rs|covenants,? conditions/i.test(otherBlock)) missing.missing_ccrs = true
  if (flags.has_recent_conveyance && !/recent conveyance|seasoning/i.test(summaryBlock)) missing.missing_recent_conveyance_note = true
  if (flags.has_delinquent_taxes && !(/delinquent/i.test(getSectionBlock(out, 'TAXES AND ASSESSMENTS') || '') || /delinquent/i.test(summaryBlock))) missing.missing_delinquent_tax_flag = true

  const ok =
    missing.requirements_items.length === 0 &&
    missing.tax_default_numbers.length === 0 &&
    missing.tax_default_lines.length === 0 &&
    missing.property_tax_ids.length === 0 &&
    !missing.foreclosure_flag &&
    !missing.missing_tax_defaults_section &&
    !missing.missing_solar_callout &&
    !missing.missing_ucc_callout &&
    !missing.missing_estate_note &&
    !missing.missing_trust_requirement &&
    !missing.missing_reconveyance_requirement &&
    !missing.missing_hoa_lien &&
    !missing.missing_out_of_state_note &&
    !missing.missing_tic_note &&
    !missing.missing_dot_count &&
    !missing.missing_assignment_of_rents &&
    !missing.missing_easements &&
    !missing.missing_ccrs &&
    !missing.missing_recent_conveyance_note &&
    !missing.missing_delinquent_tax_flag &&
    !missing.missing_fractional_beneficiaries_flag

  return { ok, missing }
}

// ── Repair Prompt Builder ─────────────────────────────────────

export function buildRepairPrompt(facts: PrelimFacts, missing: ValidationResult['missing']): string {
  const req = JSON.stringify(facts?.requirements || [], null, 2)
  const pt = JSON.stringify(facts?.taxes?.property_taxes || [], null, 2)
  const td = JSON.stringify(facts?.taxes?.tax_defaults || [], null, 2)
  const ff = JSON.stringify(facts?.foreclosure_flags || [], null, 2)

  return `Your prior prelim summary is missing required closing data. Return ONLY the missing section blocks below using EXACT headers.

Missing:
- Requirements item numbers: ${missing.requirements_items.join(', ') || 'none'}
- Missing Tax Defaults section: ${missing.missing_tax_defaults_section ? 'YES' : 'no'}
- Missing Default Nos: ${missing.tax_default_numbers.join(', ') || 'none'}
- Missing tax schedule lines: ${missing.tax_default_lines.length ? 'YES' : 'no'}
- Missing property tax IDs: ${missing.property_tax_ids.join(', ') || 'none'}
- Missing foreclosure flag: ${missing.foreclosure_flag ? 'YES' : 'no'}
- Missing solar callout: ${missing.missing_solar_callout ? 'YES' : 'no'}
- Missing UCC callout: ${missing.missing_ucc_callout ? 'YES' : 'no'}
- Missing easement estate note: ${missing.missing_estate_note ? 'YES' : 'no'}
- Missing trust requirement: ${missing.missing_trust_requirement ? 'YES' : 'no'}
- Missing reconveyance requirement: ${missing.missing_reconveyance_requirement ? 'YES' : 'no'}
- Missing HOA lien: ${missing.missing_hoa_lien ? 'YES' : 'no'}
- Missing out-of-state note: ${missing.missing_out_of_state_note ? 'YES' : 'no'}
- Missing TIC note: ${missing.missing_tic_note ? 'YES' : 'no'}
- Missing DOT count: ${missing.missing_dot_count ? 'YES' : 'no'}
- Missing assignment of rents: ${missing.missing_assignment_of_rents ? 'YES' : 'no'}
- Missing easements: ${missing.missing_easements ? 'YES' : 'no'}
- Missing CC&Rs: ${missing.missing_ccrs ? 'YES' : 'no'}
- Missing recent conveyance note: ${missing.missing_recent_conveyance_note ? 'YES' : 'no'}
- Missing delinquent tax flag: ${missing.missing_delinquent_tax_flag ? 'YES' : 'no'}
- Missing fractional beneficiaries flag: ${missing.missing_fractional_beneficiaries_flag ? 'YES' : 'no'}

GROUND TRUTH JSON (do not contradict; do not summarize tax schedules):
requirements_json:
${req}

property_taxes_json:
${pt}

tax_defaults_json:
${td}

foreclosure_flags_json:
${ff}

OUTPUT RULES:
- If tax_defaults_json is non-empty, you MUST output the full block:
**TAXES AND ASSESSMENTS**
For Tax Defaults / Redemptions:
- Default No.: ...
- Redemption schedule: Amount: $X, by Month YYYY; Amount: $Y, by Month YYYY; ...

- If requirements are missing, output:
**TITLE REQUIREMENTS**
REQUIREMENTS (Company stated)
- Items #...: ...

- If foreclosure flag is missing, output:
**SUMMARY**
- TOP CLOSING RISKS (ranked) ... including Notice of Trustee's Sale
AND
**LIENS AND JUDGMENTS** ... include Notice of Trustee's Sale details
`
}

// ── Full Guardrails Pipeline ──────────────────────────────────

/**
 * Run the full guardrails pipeline on a Tessa response.
 * Returns { finalResponse, repairNeeded }
 * The caller is responsible for making the actual repair API call;
 * this function returns the repair prompt if needed.
 */
export function runGuardrailsStep1(response: string, facts: PrelimFacts): string {
  let r = response

  // Step 1: Inject deterministic requirements
  r = injectDeterministicRequirements(r, facts)

  // Step 2: Inject deterministic taxes
  const taxesBlock = renderTaxesMarkdown(facts)
  r = replaceSectionBlock(r, 'TAXES AND ASSESSMENTS', taxesBlock)

  // Step 3: Other injections
  r = injectOtherFindingsGuardrails(r, facts)
  r = injectPropertyInfoGuardrails(r, facts)
  r = injectLiensGuardrails(r, facts)
  r = injectSummaryGuardrails(r, facts)

  return r
}

export function runGuardrailsStep2(response: string, facts: PrelimFacts): string {
  // Re-inject after repair — final authority
  let r = response
  r = injectDeterministicRequirements(r, facts)
  r = replaceSectionBlock(r, 'TAXES AND ASSESSMENTS', renderTaxesMarkdown(facts))
  r = injectOtherFindingsGuardrails(r, facts)
  r = injectPropertyInfoGuardrails(r, facts)
  r = injectLiensGuardrails(r, facts)
  r = injectSummaryGuardrails(r, facts)

  // Fix spurious "Schedule A subject-to items" action if not present
  const sched = facts?.scheduleA_subject_to_items || []
  if (!sched.length) {
    r = r.replace(/^- .*Schedule A subject-to items.*$/gim, '')
  }

  return r
}

// ── JSON Extraction Validator ─────────────────────────────────

/**
 * Validates the LLM's JSON extraction against the deterministic pre-parser facts.
 * Injects any missing items and overrides tax data with ground-truth facts.
 */
export function validateAndRepairExtraction(
  extracted: ExtractedAnalysis,
  facts: PrelimFacts
): ExtractedAnalysis {
  // 1. Ensure all pre-parser requirements are represented
  for (const req of facts?.requirements ?? []) {
    const needle = (req.text || '').toLowerCase().slice(0, 30)
    const found = extracted.title_requirements.some(
      (r) =>
        r.description.toLowerCase().includes(needle) ||
        (r.item_number !== null && r.item_number === req.item_no)
    )
    if (!found) {
      extracted.title_requirements.push({
        item_number: req.item_no ?? null,
        description: req.text || '',
        action: 'Review',
        severity:
          (req.classification?.severity as 'blocker' | 'material' | 'informational') ||
          'material',
        type: req.classification?.type || 'other',
        related_instrument: null,
        assignee: null,
      })
    }
  }

  // 2. Ensure all pre-parser DOTs appear in liens
  for (const dot of facts?.deeds_of_trust ?? []) {
    const found = extracted.liens.some(
      (l) =>
        (dot.recording_no && l.recording_ref === dot.recording_no) ||
        (l.amount === dot.amount &&
          dot.beneficiary &&
          l.beneficiary?.toLowerCase().includes(dot.beneficiary.slice(0, 15).toLowerCase()))
    )
    if (!found) {
      extracted.liens.push({
        position: extracted.liens.length + 1,
        type: 'deed_of_trust',
        amount: dot.amount || null,
        beneficiary: dot.beneficiary || 'Unknown',
        trustor: dot.trustor || null,
        recording_ref: dot.recording_no || null,
        recording_date: dot.recording_date || null,
        assigned_to:
          dot.assignments?.length
            ? dot.assignments[dot.assignments.length - 1].assignee
            : null,
        action_required: 'payoff',
      })
    }
  }

  // 3. Replace AI tax data with deterministic pre-parser taxes (ground truth)
  const propertyTaxes = facts?.taxes?.property_taxes ?? []
  if (propertyTaxes.length > 0) {
    extracted.taxes = propertyTaxes.map((tax) => ({
      tax_id: tax.tax_id || '',
      fiscal_year: tax.fiscal_year || null,
      first_installment: {
        amount:
          tax.first_installment_amount || tax.first_installment || 'Not stated',
        status: normalizeInstallmentStatus(tax.first_installment_status),
      },
      second_installment: {
        amount:
          tax.second_installment_amount || tax.second_installment || 'Not stated',
        status: normalizeInstallmentStatus(tax.second_installment_status),
      },
      exemption: tax.homeowners_exemption || null,
      code_area: tax.code_area || null,
      total_tax: null,
      penalties:
        [tax.first_penalty, tax.second_penalty].filter(Boolean).join('; ') || null,
    }))
  }

  // 4. Inject tax defaults from pre-parser
  const taxDefaults = facts?.taxes?.tax_defaults ?? []
  if (taxDefaults.length > 0) {
    extracted.tax_defaults = taxDefaults.map((td) => ({
      tax_id: td.apn || '',
      default_year: td.default_no || '',
      amount: td.redemption_schedule?.[0]?.amount || '',
      redemption_info: td.message || null,
    }))
  }

  // 5. Enforce foreclosure flag from pre-parser
  if ((facts?.foreclosure_flags ?? []).some((f) => f.type === 'notice_of_trustee_sale')) {
    extracted.foreclosure_detected = true
  }

  return extracted
}

function normalizeInstallmentStatus(
  status: string | undefined
): 'paid' | 'open' | 'delinquent' | 'defaulted' {
  if (!status) return 'open'
  const s = status.toUpperCase()
  if (s === 'PAID') return 'paid'
  if (s === 'DELINQUENT') return 'delinquent'
  if (s === 'DEFAULTED' || s === 'DEFAULT') return 'defaulted'
  return 'open'
}

export function stitchRepairSections(original: string, repairText: string): string {
  let r = original
  const tr = getSectionBlock(repairText, 'TITLE REQUIREMENTS')
  const sm = getSectionBlock(repairText, 'SUMMARY')
  const lj = getSectionBlock(repairText, 'LIENS AND JUDGMENTS')
  const tx = getSectionBlock(repairText, 'TAXES AND ASSESSMENTS')

  if (tr) r = replaceSectionBlock(r, 'TITLE REQUIREMENTS', tr)
  if (sm) r = replaceSectionBlock(r, 'SUMMARY', sm)
  if (lj) r = replaceSectionBlock(r, 'LIENS AND JUDGMENTS', lj)
  if (tx) r = replaceSectionBlock(r, 'TAXES AND ASSESSMENTS', tx)

  return r
}
