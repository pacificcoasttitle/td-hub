// ============================================================
// TESSA™ Pre-Parser
// Extracts structured hard facts from raw prelim PDF text
// BEFORE the AI ever sees the document — these become ground truth.
// Ported from tessa-enhanced-script-3.3.0-guardrails.js
// ============================================================

import type {
  PrelimFacts,
  TaxFacts,
  PropertyTax,
  TaxDefault,
  OtherAssessment,
  Requirement,
  RequirementClassification,
  ForeclosureFlag,
  DeedOfTrust,
  HOALien,
  AssignmentOfRents,
  Easement,
  CCR,
  OwnershipStructure,
  TICInterest,
  RecentConveyance,
  PropertyState,
  PropertyType,
  PropertyInfo,
  SpecialFlags,
} from './tessa-types'

// ── Utility: text normalization ───────────────────────────────

export function normalizeBullets(str: string | null | undefined): string {
  if (!str) return str ?? ''
  return str
    .replace(/(\s{2,})(\d{1,3})\.\s/g, '\n$2. ')
    .replace(/([:;])\s*(\d{1,3})\.\s/g, '$1\n$2. ')
}

export function splitNumberedItems(
  sectionText: string | null | undefined
): Array<{ num: number; raw: string }> {
  if (!sectionText) return []
  const text = normalizeBullets(sectionText)
  const items: Array<{ num: number; raw: string }> = []
  const re = /(?:^|\n)\s*(\d{1,3})\.\s+([\s\S]*?)(?=(?:\n\s*\d{1,3}\.\s+)|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    items.push({ num: parseInt(m[1], 10), raw: m[2].trim() })
  }
  return items
}

export function extractBetweenInclusive(
  text: string,
  startPattern: RegExp,
  endPattern: RegExp
): string | null {
  const start = text.search(startPattern)
  const end = text.search(endPattern)
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end)
}

function getLine(raw: string, rx: RegExp): string | null {
  const m = raw.match(rx)
  return m ? m[1].trim() : null
}

// ── Tax Parser ────────────────────────────────────────────────

export function parseTaxesFromItems(
  items: Array<{ num: number; raw: string }>
): TaxFacts {
  const out: TaxFacts = {
    property_taxes: [],
    tax_defaults: [],
    other_assessments: [],
    total_delinquent_amount: 0,
    total_redemption_amount: 0,
    has_delinquent_taxes: false,
  }

  for (const it of items) {
    const t = it.raw || ''

    if (/Property taxes/i.test(t) && /Tax Identification No\./i.test(t)) {
      const tax_id = getLine(t, /Tax Identification No\.?\s*:\s*([^\n]+)/i)
      const fiscal_year = getLine(t, /Fiscal Year:\s*([^\n]+)/i)
      const first_installment_raw = getLine(t, /1st Installment:\s*([^\n]+)/i)
      const second_installment_raw = getLine(t, /2nd Installment:\s*([^\n]+)/i)
      const exemption = (t.match(/Exemption:\s*\$?([0-9,]+\.[0-9]{2})/i) || [])[1] || null
      const code_area = getLine(t, /Code Area:\s*([^\n]+)/i)

      const first_status = /delinquent/i.test(first_installment_raw ?? '')
        ? 'DELINQUENT'
        : /paid/i.test(first_installment_raw ?? '')
        ? 'PAID'
        : 'OPEN'
      const second_status = /delinquent/i.test(second_installment_raw ?? '')
        ? 'DELINQUENT'
        : /paid/i.test(second_installment_raw ?? '')
        ? 'PAID'
        : 'OPEN'

      const first_amount =
        (first_installment_raw?.match(/\$?([\d,]+\.\d{2})/) || [])[1] || null
      const second_amount =
        (second_installment_raw?.match(/\$?([\d,]+\.\d{2})/) || [])[1] || null

      if (first_status === 'DELINQUENT' && first_amount) {
        out.total_delinquent_amount += parseFloat(first_amount.replace(/,/g, ''))
        out.has_delinquent_taxes = true
      }
      if (second_status === 'DELINQUENT' && second_amount) {
        out.total_delinquent_amount += parseFloat(second_amount.replace(/,/g, ''))
        out.has_delinquent_taxes = true
      }

      const tax: PropertyTax = {
        item_no: it.num,
        tax_id: tax_id || 'Not stated',
        fiscal_year: fiscal_year || 'Not stated',
        first_installment: first_installment_raw || 'Not stated',
        first_installment_status: first_status as 'DELINQUENT' | 'PAID' | 'OPEN',
        first_installment_amount: first_amount ? `$${first_amount}` : null,
        first_penalty:
          (t.match(/1st Installment[^$]*\$[\d,]+\.\d{2}[^$]*(\$[\d,]+\.\d{2})/i) || [])[1] ||
          null,
        second_installment: second_installment_raw || 'Not stated',
        second_installment_status: second_status as 'DELINQUENT' | 'PAID' | 'OPEN',
        second_installment_amount: second_amount ? `$${second_amount}` : null,
        second_penalty:
          (t.match(/2nd Installment[^$]*\$[\d,]+\.\d{2}[^$]*(\$[\d,]+\.\d{2})/i) || [])[1] ||
          null,
        homeowners_exemption: exemption || null,
        code_area: code_area || null,
      }
      out.property_taxes.push(tax)
      continue
    }

    if (/declared tax defaulted/i.test(t) || /Amounts to redeem/i.test(t)) {
      const flat = t.replace(/\s+/g, ' ').trim()
      const default_no = (flat.match(/Default No\.?\s*([0-9-]+)/i) || [])[1] || null
      const apn_match = flat.match(/(\d{4}-\d{3}-\d{3}|\d{4}-\d{3}-\d{2}-\d{2})/)
      const apn = apn_match ? apn_match[1] : null

      const schedule: TaxDefault['redemption_schedule'] = []
      const rx = /Amount:\s*\$?([0-9,]+\.[0-9]{2})\s*,\s*by\s*([A-Za-z]+\s+\d{4})/gi
      let m: RegExpExecArray | null
      while ((m = rx.exec(flat)) !== null) {
        const amt = parseFloat(m[1].replace(/,/g, ''))
        schedule.push({ amount: `$${m[1]}`, by: m[2], amount_numeric: amt })
        if (schedule.length === 1) out.total_redemption_amount += amt
      }

      out.tax_defaults.push({ item_no: it.num, default_no, apn, message: flat, redemption_schedule: schedule })
      continue
    }

    if (/supplemental taxes|lien of supplemental taxes/i.test(t)) {
      out.other_assessments.push({
        item_no: it.num,
        type: 'Supplemental taxes (if any)',
        details: t.replace(/\s+/g, ' ').trim(),
      })
    }

    if (/special district|community facility|mello-roos|assessment district/i.test(t)) {
      out.other_assessments.push({
        item_no: it.num,
        type: 'Special District Assessment',
        details: t.replace(/\s+/g, ' ').trim(),
      })
    }
  }

  return out
}

// ── Requirement Classifier ────────────────────────────────────

export function classifyRequirement(text: string): RequirementClassification {
  const t = text.replace(/\s+/g, ' ').trim()

  if (/full reconveyance|reconvey.*requirement.*furnished.*confirmation/i.test(t))
    return { summary: 'Confirm and process full reconveyance.', type: 'reconveyance_confirmation', severity: 'blocker' }
  if (/original note|original deed of trust|request for full reconveyance/i.test(t))
    return { summary: 'Provide original note/DOT and signed request for full reconveyance.', type: 'reconveyance_package', severity: 'blocker' }
  if (/Statement of Information/i.test(t)) {
    if (/various Liens and Judgments|similar.*name/i.test(t))
      return { summary: 'Complete SOI - NAME SEARCH HITS FOUND against similar names.', type: 'statement_of_information_hits', severity: 'blocker' }
    return { summary: 'Complete Statement of Information for named parties.', type: 'statement_of_information', severity: 'blocker' }
  }
  if (/spouse.*join.*conveyance|spouse of the vestee/i.test(t))
    return { summary: 'Spousal joinder required prior to conveyance.', type: 'spousal_joinder', severity: 'blocker' }
  if (/The Company will require.*(corporation|Name of Corporation)/i.test(t))
    return { summary: 'Corporation authority package required.', type: 'corp_authority', severity: 'material' }
  if (/Limited Liability Company|member-managed|Articles of Organization/i.test(t))
    return { summary: 'LLC authority package required.', type: 'llc_authority', severity: 'material' }
  if (/Probate Code\s*Section\s*18100\.5|Certification.*trust/i.test(t))
    return { summary: 'Trust certification required per Prob. Code §18100.5.', type: 'trust_docs', severity: 'material' }
  if (/suspended corporation|Certificate of Revivor|Relief from Voidability/i.test(t))
    return { summary: 'Suspended corporation cure required.', type: 'suspended_corp_cure', severity: 'blocker' }
  if (/homeowner['']?s? association|assessment.*current|association.*paid/i.test(t))
    return { summary: 'Provide HOA clearance letter showing all assessments paid current.', type: 'hoa_clearance', severity: 'blocker' }
  if (/demands.*signed by all beneficiaries/i.test(t))
    return { summary: 'Payoff demands must be signed by ALL beneficiaries (multiple lenders).', type: 'multi_beneficiary_demand', severity: 'blocker' }
  if (/Matters which may be disclosed by an inspection|inspection.*ordered|inspection of said Land/i.test(t))
    return { summary: 'Survey/inspection ordered or required.', type: 'survey_inspection', severity: 'material' }
  if (/ALTA\/ACSM|Land Title Survey/i.test(t))
    return { summary: 'ALTA/ACSM land title survey required.', type: 'survey_inspection', severity: 'material' }
  if (/review and approval of the Company|Corporate Underwriting Department/i.test(t))
    return { summary: 'Underwriting review and approval required.', type: 'underwriting_review', severity: 'material' }
  if (/unrecorded.*lease|unrecorded.*agreement|parties in possession/i.test(t))
    return { summary: 'Provide copies of all unrecorded leases/agreements.', type: 'unrecorded_docs_review', severity: 'material' }

  return { summary: 'Company-stated requirement.', type: 'unspecified', severity: 'material' }
}

export function parseRequirements(
  items: Array<{ num: number; raw: string }>,
  criticalText: string
): Requirement[] {
  const reqs: Requirement[] = []

  for (const it of items) {
    const t = it.raw
    if (
      /The Company will require|requirement that this Company be furnished|spouse of the vestee|Statement of Information|suspended corporation|ALTA\/ACSM|Land Title Survey|Matters which may be disclosed by an inspection|inspection of said Land has been ordered|Corporate Underwriting Department|review and approval of the Company|Probate Code\s*Section\s*18100\.5|Certification.*trust|original note|request for full reconveyance|demands signed by all beneficiaries/i.test(
        t
      )
    ) {
      reqs.push({ item_no: it.num, text: t, classification: classifyRequirement(t) })
    }
  }

  if (reqs.length === 0 && criticalText) {
    const block = normalizeBullets(criticalText)
    const patterns: RegExp[] = [
      /The Company will require[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /spouse of the vestee[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /Statement of Information[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /suspended corporation[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /requirement that this Company be furnished[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /Matters which may be disclosed by an inspection[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /inspection of said Land has been ordered[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /review and approval of the Company[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /Probate Code\s*Section\s*18100\.5[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /original note[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
      /request for full reconveyance[\s\S]*?(?=(?:\n\s*\d{1,3}\.\s)|$)/gi,
    ]
    const found: Requirement[] = []
    for (const rx of patterns) {
      let m: RegExpExecArray | null
      while ((m = rx.exec(block)) !== null) {
        const text = m[0].trim()
        const head = block.slice(0, m.index)
        const prev = head.match(/(\d{1,3})\.\s[^\n]*$/i)
        const num = prev ? parseInt(prev[1], 10) : null
        found.push({ item_no: num, text, classification: classifyRequirement(text) })
      }
    }
    const seen = new Set<string>()
    for (const f of found) {
      const key = `${f.item_no}|${f.text.slice(0, 60)}`
      if (!seen.has(key)) {
        seen.add(key)
        reqs.push(f)
      }
    }
  }

  return reqs
}

// ── Foreclosure Flags ─────────────────────────────────────────

export function parseForeclosureFlags(
  items: Array<{ num: number; raw: string }>
): ForeclosureFlag[] {
  const out: ForeclosureFlag[] = []

  const us = items.find((i) => /United States.*redeem.*2410/i.test(i.raw))
  if (us) out.push({ item_no: us.num, type: 'us_redemption', text: us.raw })

  const td = items.find((i) => /Trustee.*Deed|insufficiency of the proceedings/i.test(i.raw))
  if (td) out.push({ item_no: td.num, type: 'trustees_deed_exception', text: td.raw })

  const ntsItems = items.filter((i) => /Notice of Trustee['']s Sale|Trustee['']s Sale/i.test(i.raw))
  for (const it of ntsItems) {
    const flat = (it.raw || '').replace(/\s+/g, ' ').trim()
    const sale_date =
      (flat.match(/(?:scheduled|sale)\s*(?:to be held\s*)?on\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i) || [])[1] || null
    const sale_time = (flat.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i) || [])[1] || null
    const sale_location = (flat.match(/(?:at|location:)\s*([^\.]{10,200})(?:\.|$)/i) || [])[1] || null
    out.push({ item_no: it.num, type: 'notice_of_trustee_sale', text: it.raw, sale_date, sale_time, sale_location })
  }

  return out
}

// ── v3.3.0 Parsers ────────────────────────────────────────────

export function parseDeedsOfTrust(
  items: Array<{ num: number; raw: string }>,
  _fullText: string
): DeedOfTrust[] {
  const dots: DeedOfTrust[] = []

  for (const it of items) {
    const t = it.raw || ''
    if (!/Deed of Trust to secure an indebtedness/i.test(t)) continue

    const dot: DeedOfTrust = {
      item_no: it.num,
      position: dots.length + 1,
      amount: null,
      dated: null,
      trustor: null,
      trustee: null,
      beneficiary: null,
      loan_no: null,
      recording_date: null,
      recording_no: null,
      assignments: [],
      substitutions: [],
      has_notice_of_default: false,
      has_notice_of_trustee_sale: false,
      sale_date: null,
      sale_time: null,
      sale_location: null,
      fractional_interests: [],
    }

    const rawAmt = (t.match(/Amount:\s*\$?([\d,]+(?:\.\d{2})?)/i) || [])[1]
    dot.amount = rawAmt ? `$${rawAmt}` : null
    dot.dated = (t.match(/Dated:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i) || [])[1] || null
    dot.trustor = (t.match(/Trustor(?:\/Grantor)?:\s*([^\n]+?)(?=\s*Trustee:|$)/i) || [])[1]?.trim() || null
    dot.trustee = (t.match(/Trustee:\s*([^\n]+?)(?=\s*Beneficiary:|$)/i) || [])[1]?.trim() || null
    dot.beneficiary = (t.match(/Beneficiary:\s*([^\n]+?)(?=\s*Loan No|Recording|$)/i) || [])[1]?.trim() || null
    dot.loan_no = (t.match(/Loan No\.?:\s*([^\n]+)/i) || [])[1]?.trim() || null
    dot.recording_date = (t.match(/Recording Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i) || [])[1] || null
    dot.recording_no = (t.match(/Recording No\.?:\s*(\d+)/i) || [])[1] || null

    const fractionalMatches = [...t.matchAll(/as to an undivided\s+\$?([\d,]+(?:\.\d{2})?)\s*\/\s*\$?([\d,]+(?:\.\d{2})?)\s+interest/gi)]
    for (const fm of fractionalMatches) {
      dot.fractional_interests.push({ numerator: fm[1], denominator: fm[2] })
    }

    const assignmentMatch = t.match(/assignment of the beneficial interest[\s\S]*?Assignee:\s*([^\n]+?)(?=\s*Loan No|Recording|$)/i)
    if (assignmentMatch) {
      dot.assignments.push({
        assignee: assignmentMatch[1].trim(),
        recording_no: (t.match(/assignment[\s\S]*?Recording No\.?:\s*(\d+)/i) || [])[1],
      })
    }

    const subMatch = t.match(/Substitution of Trustee[\s\S]*?Trustee:\s*([^\n]+?)(?=\s*Recording|$)/i)
    if (subMatch) {
      dot.substitutions.push({
        new_trustee: subMatch[1].trim(),
        recording_no: (t.match(/Substitution[\s\S]*?Recording No\.?:\s*(\d+)/i) || [])[1],
      })
    }

    if (/notice of default/i.test(t)) dot.has_notice_of_default = true
    if (/notice of trustee['']?s sale/i.test(t)) {
      dot.has_notice_of_trustee_sale = true
      dot.sale_date = (t.match(/(?:Date.*?Sale|Sale.*?Date):\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i) || [])[1] || null
      dot.sale_time = (t.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i) || [])[1] || null
      dot.sale_location = (t.match(/(?:at|Place.*?Sale):\s*([^\.]{10,200})/i) || [])[1]?.trim() || null
    }

    dots.push(dot)
  }

  dots.sort((a, b) => {
    if (!a.recording_date) return 1
    if (!b.recording_date) return -1
    return new Date(a.recording_date).getTime() - new Date(b.recording_date).getTime()
  })
  dots.forEach((d, i) => (d.position = i + 1))

  return dots
}

export function parseHOALiens(items: Array<{ num: number; raw: string }>): HOALien[] {
  const liens: HOALien[] = []
  for (const it of items) {
    const t = it.raw || ''
    if (!/delinquent assessments|notice of.*lien|homeowner['']?s? association/i.test(t)) continue
    const amtMatch = t.match(/Amount:\s*\$?([\d,]+(?:\.\d{2})?)/i)
    const assocMatch = t.match(/(?:payable to|Owners Association|Homeowners Association|HOA):\s*([^\n]+)/i)
    liens.push({
      item_no: it.num,
      type: 'HOA Assessment Lien',
      association_name: assocMatch ? assocMatch[1].trim() : null,
      amount: amtMatch ? `$${amtMatch[1]}` : null,
      recording_date: (t.match(/Recording Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i) || [])[1] || null,
      recording_no: (t.match(/Recording No\.?:\s*(\d+)/i) || [])[1] || null,
      status: 'Delinquent',
    })
  }
  return liens
}

export function parseAssignmentOfRents(items: Array<{ num: number; raw: string }>): AssignmentOfRents[] {
  const assignments: AssignmentOfRents[] = []
  for (const it of items) {
    const t = it.raw || ''
    if (!/assignment of all moneys due.*rental|assignment of rents/i.test(t)) continue
    const rawAmt = (t.match(/Amount:\s*\$?([\d,]+(?:\.\d{2})?)/i) || [])[1]
    assignments.push({
      item_no: it.num,
      amount: rawAmt ? `$${rawAmt}` : null,
      assigned_to: (t.match(/Assigned to:\s*([^\n]+)/i) || [])[1]?.trim() || null,
      assigned_by: (t.match(/Assigned By:\s*([^\n]+)/i) || [])[1]?.trim() || null,
      recording_date: (t.match(/Recording Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i) || [])[1] || null,
      recording_no: (t.match(/Recording No\.?:\s*(\d+)/i) || [])[1] || null,
    })
  }
  return assignments
}

export function parseEasements(items: Array<{ num: number; raw: string }>, _fullText: string): Easement[] {
  const easements: Easement[] = []
  for (const it of items) {
    const t = it.raw || ''
    if (!/easement(?:s)?\s+(?:for|in favor)/i.test(t) && !/right of way/i.test(t)) continue
    let affects = (t.match(/Affects:\s*([^\n]+)/i) || [])[1]?.trim() || null
    if (!affects) {
      const m = t.match(/(?:The|affecting)\s+((?:North|South|East|West)(?:erly)?\s+\d+\s*feet)/i)
      if (m) affects = m[1]
    }
    easements.push({
      item_no: it.num,
      purpose: (t.match(/Purpose:\s*([^\n]+)/i) || [])[1]?.trim() || null,
      in_favor_of: (t.match(/(?:in favor of|Granted to):\s*([^\n]+)/i) || [])[1]?.trim() || null,
      affects,
      recording_no: (t.match(/Recording No\.?:\s*([^\n,]+)/i) || [])[1]?.trim() || null,
    })
  }
  return easements
}

export function parseCCRs(items: Array<{ num: number; raw: string }>): CCR[] {
  const ccrs: CCR[] = []
  for (const it of items) {
    const t = it.raw || ''
    if (!/covenants,?\s*conditions\s*and\s*restrictions|CC&Rs?|declaration/i.test(t)) continue
    const bookPageMatch = t.match(/(?:in|recorded in)\s*Book\s+(\d+)\s+Page\s+(\d+)/i)
    ccrs.push({
      item_no: it.num,
      recording_no: (t.match(/Recording No\.?:\s*(\d+)/i) || [])[1] || null,
      recording_book_page: bookPageMatch ? `Book ${bookPageMatch[1]} Page ${bookPageMatch[2]}` : null,
      modifications: [],
      violation_clause: /violation.*shall not defeat.*lien/i.test(t),
    })
  }
  return ccrs
}

export function parseOwnershipStructure(fullText: string): OwnershipStructure {
  const structure: OwnershipStructure = {
    vesting_type: 'individual',
    vestees: [],
    is_trust: false,
    trust_name: null,
    trust_date: null,
    is_tic: false,
    tic_interests: [],
    is_corporate: false,
    is_llc: false,
    requires_spousal_joinder: false,
    married_persons: [],
  }

  const vestingMatch = fullText.match(
    /TITLE TO SAID ESTATE[\s\S]*?VESTED IN:\s*([\s\S]*?)(?=\n\s*\d\.|THE LAND REFERRED)/i
  )
  if (vestingMatch) {
    const vesting = vestingMatch[1].trim()
    structure.vestees.push(vesting)

    if (/trustee|trust/i.test(vesting)) {
      structure.is_trust = true
      structure.vesting_type = 'trust'
      const trustMatch = vesting.match(/(?:of|under)\s+(?:the\s+)?([^,]+trust[^,]*)/i)
      if (trustMatch) structure.trust_name = trustMatch[1].trim()
      const dateMatch = vesting.match(/dated\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
      if (dateMatch) structure.trust_date = dateMatch[1]
    }
    if (/tenants in common|as to an undivided/i.test(vesting)) {
      structure.is_tic = true
      structure.vesting_type = 'tic'
      const interests: TICInterest[] = []
      const matches = [...vesting.matchAll(/([^,;]+?)\s*,?\s*as to an undivided\s+(\d+)%/gi)]
      for (const im of matches) {
        interests.push({ party: im[1].trim(), percentage: parseInt(im[2]) })
      }
      structure.tic_interests = interests
    }
    if (/corporation|inc\.|corp\./i.test(vesting) && !/limited liability/i.test(vesting)) {
      structure.is_corporate = true
      structure.vesting_type = 'corporate'
    }
    if (/limited liability company|llc/i.test(vesting)) {
      structure.is_llc = true
      structure.vesting_type = 'llc'
    }
    if (
      /married\s+(man|woman)|husband and wife|as community property/i.test(vesting) &&
      !/sole and separate property/i.test(vesting)
    ) {
      structure.requires_spousal_joinder = true
    }
  }

  return structure
}

function daysSince(dateStr: string): number | null {
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return null
    const now = new Date()
    return Math.ceil(Math.abs(now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  } catch {
    return null
  }
}

export function parseRecentConveyances(fullText: string): RecentConveyance[] {
  const conveyances: RecentConveyance[] = []
  const matches = [
    ...fullText.matchAll(
      /(?:conveyance|grantor|grantee)[\s\S]*?Grantor:\s*([^\n]+)[\s\S]*?Grantee:\s*([^\n]+)[\s\S]*?Recording Date:\s*([^\n]+)[\s\S]*?Recording No\.?:\s*(\d+)/gi
    ),
  ]
  for (const cm of matches) {
    const recordingDate = cm[3].trim()
    const daysAgo = daysSince(recordingDate)
    conveyances.push({
      grantor: cm[1].trim(),
      grantee: cm[2].trim(),
      recording_date: recordingDate,
      recording_no: cm[4],
      days_ago: daysAgo,
      is_recent: daysAgo !== null && daysAgo <= 90,
      seasoning_concern: daysAgo !== null && daysAgo <= 90,
    })
  }
  return conveyances
}

export function detectPropertyState(fullText: string): PropertyState {
  const statePatterns: Array<{ pattern: RegExp; state: string; name: string }> = [
    { pattern: /,\s*CA\s+\d{5}/i, state: 'CA', name: 'California' },
    { pattern: /,\s*California\s*,/i, state: 'CA', name: 'California' },
    { pattern: /,\s*AZ\s+\d{5}/i, state: 'AZ', name: 'Arizona' },
    { pattern: /,\s*Arizona\s*,/i, state: 'AZ', name: 'Arizona' },
    { pattern: /,\s*NV\s+\d{5}/i, state: 'NV', name: 'Nevada' },
    { pattern: /County of Los Angeles|Los Angeles County/i, state: 'CA', name: 'California' },
    { pattern: /Maricopa County/i, state: 'AZ', name: 'Arizona' },
    { pattern: /Kern County/i, state: 'CA', name: 'California' },
  ]
  for (const sp of statePatterns) {
    if (sp.pattern.test(fullText)) {
      return { code: sp.state, name: sp.name, is_california: sp.state === 'CA' }
    }
  }
  return { code: 'UNKNOWN', name: 'Unknown', is_california: false }
}

export function detectPropertyType(fullText: string): PropertyType {
  const types: PropertyType = {
    is_sfr: false,
    is_multi_family: false,
    is_commercial: false,
    is_industrial: false,
    is_land: false,
    is_condo: false,
    is_pud: false,
    description: 'Unknown',
  }
  if (/Single Family Residence/i.test(fullText)) {
    types.is_sfr = true
    types.description = 'Single Family Residence'
  } else if (/Multi-Family|Multi Family/i.test(fullText)) {
    types.is_multi_family = true
    types.description = 'Multi-Family Residence'
  } else if (/Commercial\/Industrial|Commercial/i.test(fullText)) {
    types.is_commercial = true
    types.description = 'Commercial/Industrial'
  } else if (/Condominium|Condo Unit/i.test(fullText)) {
    types.is_condo = true
    types.description = 'Condominium'
  }
  return types
}

export function findScheduleASubjects(fullText: string): number[] {
  const m = fullText.match(/SUBJECT TO ITEM NOS?\.\s*([0-9\sand,]+)/i)
  if (!m) return []
  return m[1]
    .split(/[,and\s]+/i)
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n))
}

// ── Master Facts Function ─────────────────────────────────────

export function computeFacts(fullText: string): PrelimFacts {
  const critical = extractBetweenInclusive(
    fullText,
    /AT THE DATE HEREOF[\s\S]+?WOULD BE AS FOLLOWS:/i,
    /END OF ITEMS/i
  )
  const criticalNorm = normalizeBullets(critical || '')
  const items = splitNumberedItems(criticalNorm)

  const taxes = parseTaxesFromItems(items)
  const requirements = parseRequirements(items, criticalNorm)
  const foreclosureFlags = parseForeclosureFlags(items)
  const scheduleASubject = findScheduleASubjects(fullText)
  const deedsOfTrust = parseDeedsOfTrust(items, fullText)
  const hoaLiens = parseHOALiens(items)
  const assignmentOfRents = parseAssignmentOfRents(items)
  const easements = parseEasements(items, fullText)
  const ccrs = parseCCRs(items)
  const ownershipStructure = parseOwnershipStructure(fullText)
  const recentConveyances = parseRecentConveyances(fullText)
  const propertyState = detectPropertyState(fullText)
  const propertyType = detectPropertyType(fullText)

  const lcText = (fullText || '').toLowerCase()
  const lcCrit = (criticalNorm || '').toLowerCase()

  const solarFlag =
    /sunrun|solar energy system producer|independent solar energy system producer|solar\b/i.test(lcText)
  const uccFlag = /\bucc\b|financing statement|fixture filing/i.test(lcText)

  let solarContext: string | null = null
  if (solarFlag) {
    const hit = fullText.search(/Sunrun|Solar Energy System Producer|Independent Solar Energy System Producer|Solar/i)
    if (hit !== -1) solarContext = fullText.slice(Math.max(0, hit - 250), Math.min(fullText.length, hit + 500))
  }

  const solarRecording = solarContext
    ? (solarContext.match(/Recording (?:No\.|Number|No)\s*:?\s*([0-9]{8,})/i) || [])[1] || null
    : null
  const solarRecordingDate = solarContext
    ? (solarContext.match(/Recorded\s*:?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i) || [])[1] || null
    : null

  const trustFlag = ownershipStructure?.is_trust || /trustee\b|as trustee|\btrust\b/i.test(lcText)
  const trustCertRequired =
    /probate code\s*section\s*18100\.5|certification\s+of\s+trust|certification.*trust/i.test(lcText) ||
    /probate code\s*section\s*18100\.5|certification\s+of\s+trust|certification.*trust/i.test(lcCrit)
  const reconveyancePkgRequired =
    /original note|original deed of trust|request for full reconveyance|demands signed by all beneficiaries/i.test(
      lcText
    ) ||
    /original note|request for full reconveyance|demands signed by all beneficiaries/i.test(lcCrit)
  const easementEstate =
    /parcel\s*2\s*:?\s*an\s+easement|easement\s+parcel\s*2|estate\s*:?\s*an\s+easement/i.test(lcText)

  const special_flags: SpecialFlags = {
    solar_flag: solarFlag,
    ucc_flag: uccFlag,
    solar_notice: solarFlag
      ? {
          company: solarContext && /Sunrun/i.test(solarContext) ? 'Sunrun' : 'Solar',
          recording_no: solarRecording,
          recording_date: solarRecordingDate,
          context: solarContext ? solarContext.replace(/\s+/g, ' ').trim() : null,
        }
      : null,
    trust_flag: !!trustFlag,
    trust_cert_required: !!trustCertRequired,
    reconveyance_package_required: !!reconveyancePkgRequired,
    easement_estate: !!easementEstate,
    has_active_foreclosure:
      foreclosureFlags.some((f) => f.type === 'notice_of_trustee_sale') ||
      deedsOfTrust.some((d) => d.has_notice_of_trustee_sale),
    has_hoa_lien: hoaLiens.length > 0,
    has_tax_default: taxes.tax_defaults.length > 0,
    has_delinquent_taxes: taxes.has_delinquent_taxes,
    is_out_of_state: !propertyState.is_california && propertyState.code !== 'UNKNOWN',
    has_tic_ownership: !!ownershipStructure?.is_tic,
    has_recent_conveyance: recentConveyances.some((c) => c.is_recent),
    has_multiple_dots: deedsOfTrust.length > 1,
    has_fractional_beneficiaries: deedsOfTrust.some((d) => d.fractional_interests.length > 0),
    has_assignment_of_rents: assignmentOfRents.length > 0,
    has_easements: easements.length > 0,
    has_ccrs: ccrs.length > 0,
  }

  const property: PropertyInfo = {
    address: (fullText.match(/PROPERTY:\s*([^\n]+)/i) || [])[1] || null,
    apn: (fullText.match(/\bAPN:\s*([0-9-]+)/i) || [])[1] || null,
    effective_date: (fullText.match(/EFFECTIVE DATE:\s*([^\n]+)/i) || [])[1] || null,
    proposed_lender: (fullText.match(/Proposed Lender:\s*([^\n]+)/i) || [])[1] || null,
    proposed_loan_amount: (fullText.match(/Proposed Loan Amount:\s*(\$?[0-9,]+\.\d{2})/i) || [])[1] || null,
    state: propertyState,
    property_type: propertyType,
  }

  return {
    property,
    scheduleA_subject_to_items: scheduleASubject,
    taxes,
    requirements,
    foreclosure_flags: foreclosureFlags,
    special_flags,
    deeds_of_trust: deedsOfTrust,
    hoa_liens: hoaLiens,
    assignment_of_rents: assignmentOfRents,
    easements,
    ccrs,
    ownership_structure: ownershipStructure,
    recent_conveyances: recentConveyances,
  }
}
