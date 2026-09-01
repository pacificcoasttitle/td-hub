import type { CplOrderDetail, CplGenerateInput, CplForm, TransactionType } from '../types';
import { countyFipsFrom } from '../county-fips';
import { classifyPartyName } from '@/lib/domain/cpl/borrower-resolution';

const TIMEOUT_MS = 15_000;
const CPL_TIMEOUT_MS = 30_000;

// ─── Branch info needed by the payload builders ─────────────────────────────

export interface WestcorBranchInfo {
  branchCode: string;
  agencyName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

// ─── Westcor response shape (from Order/Update Step A) ──────────────────────

export interface WestcorOrderResponse {
  tvid?: number;
  agentnumber?: string;
  buyers?: Array<{ NameID?: number; tvid?: number | string }>;
  sellers?: Array<{ NameID?: number; tvid?: number | string }>;
  lenders?: Array<{ Id?: number; tvid?: number | string }>;
  property?: Array<{ PropertyID?: number; tvid?: number | string }>;
  messages?: { success?: string[]; warning?: string[]; error?: string[] };
}

// ─── PrepareAddCPL result ───────────────────────────────────────────────────

export interface PrepareAddCplResult {
  forms: CplForm[];
  cplTemplate: Record<string, unknown>;
}

// ─── Preflight validation ───────────────────────────────────────────────────

export interface PreflightResult {
  /** Blocking. The request cannot be built or will certainly be rejected. */
  errors: string[];
  /** Non-blocking. Surfaced to the operator, who decides whether to proceed. */
  warnings: string[];
}

export interface PreflightContext {
  orderDetail: CplOrderDetail;
  input: CplGenerateInput;
  westcorLenderId: number;
}

/**
 * LEGACY RUNS NONE OF THIS. Grepping the legacy FNF source for
 * required/validate/throw returns nothing — it assembles the payload and lets
 * the underwriter reject it. Every check here is ours, so each one has to earn
 * a hard stop rather than inherit one.
 *
 * Two categories:
 *
 *   errors   — the request cannot be built, or the vendor will reject it in a
 *              way we can predict exactly. Blocking.
 *   warnings — the letter would be thinner than ideal but the request is
 *              well-formed. Shown to the operator, who decides. Never silent.
 *
 * The buyer check moved to `warnings`: it demanded an order_parties row legacy
 * never read, and it passes on 51.8% of orders.
 */
export function preflightValidate(ctx: PreflightContext): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { orderDetail, westcorLenderId } = ctx;
  const txType = orderDetail.transactionType;

  // BLOCKING. Westcor's Order/Update rejects a property with no street:
  // "Property #1: Street address is a required field! Property has not been
  // Added." — logged against order 49 on 2026-03-26.
  if (!orderDetail.property?.address) {
    errors.push('Property address is required.');
  }

  // BLOCKING. buildLenders returns [] with no lender, and the CPL entry needs
  // a LenderID from the Step A response. Without one there is nothing to
  // protect and the request cannot be assembled.
  if (!orderDetail.lender?.name) {
    errors.push('Lender company name is required to generate a CPL.');
  }

  // WARNING, not blocking. See the module note: legacy sent the letter with
  // whatever borrower it had, including none.
  if (orderDetail.buyers.length === 0) {
    warnings.push('No borrower is named on this CPL.');
  }

  if (txType === 'Purchase') {
    // WARNING. A purchase with no seller on file is unusual, but the letter
    // protects the lender and does not depend on the seller being named.
    if (orderDetail.sellers.length === 0) {
      warnings.push('No seller is named on this purchase.');
    }
  }

  // BLOCKING, ON EVERY TRANSACTION TYPE.
  //
  // This one is deliberately NOT treated like the borrower check we just
  // relaxed, and the difference is worth stating because the two look alike
  // from a distance.
  //
  //   The borrower block refused to SEND over a value we could resolve
  //   ourselves. Nothing was wrong with the letter; we were withholding it.
  //
  //   A zero coverage amount is a WRONG VALUE ON A LEGAL INSTRUMENT. The CPL
  //   is the underwriter's indemnity to the lender, and the amount is what is
  //   being indemnified. Sending zero does not produce a thinner letter, it
  //   produces an incorrect one — and Westcor accepts it, so nothing
  //   downstream catches it either.
  //
  // Refinance was previously exempt from this check, and on the current book
  // that exemption is the whole exposure: of 3,841 refinances, ONE has
  // loan_amount > 0 and TWO have sales_price > 0. resolvePurchasePrice reads
  // loanOverride || dbLoan || salesOverride || dbSales, so on 3,839 of them
  // every database term is empty and the value comes only from what the
  // operator types. With no check, typing nothing sent purchase_price: 0.
  const price = resolvePurchasePrice(orderDetail, ctx.input);
  if (price <= 0) {
    errors.push(
      txType === 'Purchase'
        ? 'Purchase transactions require a sales amount greater than zero.'
        : 'A loan amount is required — a CPL cannot be issued for a zero amount.',
    );
  }

  // BLOCKING. Every name we send must satisfy Westcor's identity rule:
  // a CompanyName, or BOTH a First and a Last.
  //
  // WHY THIS BLOCKS. Same reasoning as the zero-price check above, and NOT the
  // reasoning of the borrower check we relaxed. A name failing this rule is not
  // a thinner letter — the send is GUARANTEED to fail, because Westcor's
  // Order/Update validates it and returns "Please provide at least a Company
  // Name and/or First and Last Name of the individual." Blocking early costs
  // the operator one screen; blocking late costs a vendor round trip and gives
  // them a message with our field names nowhere in it.
  //
  // WHAT THIS IS REALLY FOR. Post-fix, `nameFields` cannot emit a failing shape
  // for any non-empty name: persons get First plus Last "-", companies and
  // trusts get CompanyName. So this check should never fire in normal use — it
  // is a REGRESSION GUARD, and it is here because the defect it now catches was
  // shipped and found by an operator rather than by us. c82dfff routed trusts
  // to `Trust` alone, which silently produced exactly this shape, and nothing
  // between the modal and the vendor had an opinion about it.
  //
  // It is evaluated on the built payload, through the same `nameFields` the
  // request uses, so it cannot drift from what we actually send.
  //
  // SCOPE. Buyers and sellers are the parties sent as Westcor "Name" nested
  // objects, so the rule is theirs. Lenders use a flat `name` string and have
  // their own blocking check above; attorneys are sent as null. Adding a name
  // party later puts it here.
  const identityFailures: string[] = [];
  const checkNames = (label: string, built: Array<Record<string, unknown>>) => {
    built.forEach((entry, i) => {
      if (!namePassesWestcorIdentityRule(entry)) {
        const shown = String(entry.Trust ?? entry.CompanyName ?? entry.First ?? '').trim();
        identityFailures.push(`${label} #${i + 1}${shown ? ` (${shown})` : ''}`);
      }
    });
  };
  checkNames('Borrower', buildBuyers(orderDetail.buyers));
  checkNames('Seller', buildSellers(orderDetail.sellers, txType));

  if (identityFailures.length > 0) {
    // The message names the party AND says what to supply. An operator who
    // reads "Seller #2" alone has six fields and no way to know which is wrong.
    errors.push(
      `${identityFailures.join(', ')} ${identityFailures.length === 1 ? 'needs' : 'need'} ` +
      'a full name. Westcor requires either a company name, or both a first and ' +
      'a last name, for every party on the letter. Enter the name as it should ' +
      'read on the CPL — for a person use their first and last name, and for a ' +
      'company or trust use the full entity name.',
    );
  }

  // BLOCKING. LenderID 0 means the lender was never registered with Westcor;
  // the CPL entry would carry a dangling reference.
  if (txType === 'Refinance' && westcorLenderId === 0) {
    errors.push('Refinance transactions require a valid Westcor lender ID. Lender may not have been registered in Westcor.');
  }

  return { errors, warnings };
}

// ─── Amount resolution (transaction-aware) ──────────────────────────────────

function parseAmount(val: string | null | undefined): number {
  if (!val) return 0;
  return parseInt(String(val).replace(/[^0-9\-]/g, ''), 10) || 0;
}

function extractTvid(entity: unknown): number {
  if (!entity || typeof entity !== 'object') return 0;
  const obj = entity as Record<string, unknown>;
  const raw = obj.TVID ?? obj.tvid ?? obj.Tvid;
  return Number(raw) || 0;
}

/**
 * Westcor always expects a `purchase_price` field.
 * - Purchase: use salesPrice (or modal salesAmountOverride)
 * - Refinance: use loanAmount (or modal loanAmountOverride), fall back to salesPrice
 * - Other/Equity/unknown: use whichever is nonzero, prefer salesPrice
 */
export function resolvePurchasePrice(
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
): number {
  const salesOverride = parseAmount(input.salesAmountOverride);
  const loanOverride = parseAmount(input.loanAmountOverride);
  const dbSales = parseAmount(orderDetail.salesPrice);
  const dbLoan = parseAmount(orderDetail.loanAmount);
  const txType = orderDetail.transactionType;

  if (txType === 'Purchase') {
    return salesOverride || dbSales || loanOverride || dbLoan || 0;
  }
  if (txType === 'Refinance') {
    return loanOverride || dbLoan || salesOverride || dbSales || 0;
  }
  // Equity, Other, or null — use whichever is nonzero
  return salesOverride || dbSales || loanOverride || dbLoan || 0;
}

// ─── Shared body helpers (legacy-exact field names from Westcor.php) ────────

function buildProperty(
  prop: CplOrderDetail['property'],
  ids?: { PropertyID?: number; tvid?: number | string },
) {
  const county = (prop?.county ?? '').trim();
  const suffixed = county
    ? county.toLowerCase().endsWith('county') ? county : `${county} County`
    : '';

  return [{
    PropertyID: ids?.PropertyID ?? 0,
    tvid: Number(ids?.tvid ?? 0) || 0,
    CountyName: suffixed,
    // Conditional in the spec — "We do validate this and do send it back."
    // Held on 5,983 of 8,063 order_properties rows; empty string where absent,
    // matching the spec's example for the other blank property fields.
    ParcelID: (prop?.apn ?? '').trim(),
    // REQUIRED per the spec, and never sent until now. Empty string rather than
    // null when unresolvable, matching how the spec's example leaves other
    // blank property fields.
    CountyFips: countyFipsFrom(prop?.fips, prop?.county, prop?.state) ?? '',
    ShortLegal: null as string | null,
    StreetAddress: prop?.address ?? '',
    City: prop?.city ?? '',
    State: prop?.state ?? 'CA',
    Zip: prop?.zip ?? '',
    PropertyType: 'R',
  }];
}

/**
 * Split one name across Westcor's name fields.
 *
 * The spec is conditional, not free-text:
 *
 *   CompanyName  Required if first name and last name are not provided
 *   Trust        If the name has been determined to be a trust, it goes here
 *   First/Last   Required if company name is not provided
 *
 * Everything used to go into `First` with `Last: '-'`, so a family trust
 * appeared on a closing protection letter as a person with the surname "-".
 *
 * ─── `Trust` IS ADDITIVE, NOT A SUBSTITUTE ─────────────────────────────────
 *
 * Read the four rows of the spec table together (§2.3.3.3, Name Nested Object
 * Mapping) and only one shape is legal for a name with no first and last:
 *
 *   CompanyName  "CONDITIONAL: Required if first name and last name are not
 *                 provided"
 *   Trust        "If the name has been determined to be a trust, then it goes
 *                 into this field."
 *   Last         "CONDITIONAL: Required if company name is not provided"
 *   First        "CONDITIONAL: Required if company name is not provided"
 *
 * `Trust` carries NO clause excusing the CompanyName requirement — it says
 * where a trust name goes, not that it satisfies the identity requirement. So
 * a trust needs BOTH: `Trust` so the letter renders it as a trust, and
 * `CompanyName` so the name passes validation at all.
 *
 * THE INFERENCE THAT BROKE THIS IS AN EASY ONE TO MAKE AGAIN. c82dfff read the
 * `Trust` row correctly — a trust name really does belong in that field — and
 * then took one step too far, assuming a field that ACCEPTS the name also
 * SATISFIES the requirement to identify the party. Placement and identity are
 * separate questions in this table, and only `CompanyName` and `First`+`Last`
 * answer the second one. Anyone reading §2.3.3.3 fresh will be tempted by the
 * same step; the four rows only rule it out when read together.
 *
 * Sending `Trust` alone is what this function did between c82dfff and now, and
 * Westcor rejected it in production on order 6142:
 *
 *   "Seller #2: Not Added. Please provide at least a Company Name and/or First
 *    and Last Name of the individual."
 *
 * THE PERSON PATH IS UNCHANGED. When the classifier abstains, the name takes
 * exactly the shape it takes today — persons render correctly on issued
 * letters and that is not being altered on the strength of a marker list.
 */
function nameFields(fullName: string): Record<string, unknown> {
  const name = fullName.trim();
  const kind = classifyPartyName(name);

  if (kind === 'trust') {
    // CompanyName carries the identity; Trust carries the classification.
    return { Last: '', First: '', CompanyName: name, Trust: name };
  }
  if (kind === 'company') {
    return { Last: '', First: '', CompanyName: name, Trust: '' };
  }
  // Person — byte-for-byte what we sent before.
  return { Last: '-', First: name, CompanyName: '', Trust: '' };
}

/**
 * Westcor's identity rule for one name, from the spec rows quoted above:
 * a CompanyName, or BOTH a First and a Last. Anything else is rejected by
 * Order/Update with "Please provide at least a Company Name and/or First and
 * Last Name of the individual."
 *
 * Exported so the preflight can apply exactly the rule the payload obeys,
 * rather than a second description of it that can drift.
 */
export function namePassesWestcorIdentityRule(fields: Record<string, unknown>): boolean {
  const s = (v: unknown) => String(v ?? '').trim();
  return s(fields.CompanyName) !== '' || (s(fields.First) !== '' && s(fields.Last) !== '');
}

/**
 * The buyer and seller name objects exactly as the request carries them, for
 * the failure log. Positions are 1-based to match Westcor's own "Seller #2"
 * numbering, and `passes` marks the entries that fail the identity rule so the
 * offending one is obvious without re-deriving it.
 */
export function describeNamesForDiagnostics(orderDetail: CplOrderDetail) {
  const describe = (built: Array<Record<string, unknown>>) =>
    built.map((e, i) => ({
      position: i + 1,
      Last: e.Last, First: e.First, CompanyName: e.CompanyName, Trust: e.Trust,
      passes: namePassesWestcorIdentityRule(e),
    }));

  return {
    buyers: describe(buildBuyers(orderDetail.buyers)),
    sellers: describe(buildSellers(orderDetail.sellers, orderDetail.transactionType)),
  };
}

/** Test seam: the name half of one buyer entry, which is what varies. */
export function buildOrderBodyForTest(names: string[]): Record<string, unknown> {
  return buildBuyers(names)[0] as unknown as Record<string, unknown>;
}

function buildBuyers(
  names: string[],
  ids?: Array<{ NameID?: number; tvid?: number | string }>,
) {
  return names.map((fullName, i) => ({
    NameID: ids?.[i]?.NameID ?? 0,
    ...nameFields(fullName),
    NameType: 1,
    JoiningPhrase: 'single',
    tvid: Number(ids?.[i]?.tvid ?? 0) || 0,
    Sequence: i + 1,
    City: null as string | null,
    State: null as string | null,
    Zip: null as string | null,
    Address: null as string | null,
  }));
}

function buildSellers(
  names: string[],
  txType: TransactionType | null,
  ids?: Array<{ NameID?: number; tvid?: number | string }>,
) {
  // Refinance transactions typically have no seller; don't send placeholders
  const filtered = txType === 'Refinance'
    ? names.filter((n) => !/^tbd\b/i.test(n.trim()))
    : names;

  return filtered.map((fullName, i) => ({
    NameID: ids?.[i]?.NameID ?? 0,
    ...nameFields(fullName),
    NameType: 2,
    JoiningPhrase: 'single',
    tvid: Number(ids?.[i]?.tvid ?? 0) || 0,
    Sequence: i + 1,
    City: null as string | null,
    State: null as string | null,
    Zip: null as string | null,
    Address: null as string | null,
  }));
}

function buildLenders(
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
  ids?: { Id?: number; tvid?: number | string },
) {
  const lender = orderDetail.lender;
  const lenderOverrides = input.lenderOverrides;
  if (!lender) return [];

  return [{
    Id: ids?.Id ?? 0,
    tvid: Number(ids?.tvid ?? 0) || 0,
    name: lenderOverrides?.name ?? lender.name ?? '',
    city: lenderOverrides?.city ?? lender.city ?? '',
    state: lenderOverrides?.state ?? lender.state ?? '',
    zip: lenderOverrides?.zip ?? lender.zip ?? '',
    address: lenderOverrides?.address ?? lender.address ?? '',
    phone: null as string | null,
    email: null as string | null,
    countyFIPS: null as string | null,
    assignment: input.assignmentClause ?? null,
    mortgageType: null as string | null,
    amount: 0,
    loan_number: input.loanNumberOverride ?? '',
    vendorInternalID: null as number | null,
  }];
}

const ACTIONS_CREATE = {
  sdn: false,
  update_base: true,
  update_property: true,
  update_lender: true,
  update_buyers: true,
  update_sellers: true,
  update_attorneys: false,
  update_cpls: false,
  update_jacket: false,
  update_search: false,
  update_reinsurance: false,
  update_priors: false,
};

// ─── Step A: Create order in Westcor ────────────────────────────────────────

export async function createOrUpdateOrder(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
  branch: WestcorBranchInfo,
  existingTvid?: string | null,
): Promise<{ westcorOrderId: string; orderResponse: WestcorOrderResponse }> {
  const body = {
    tvid: existingTvid ? parseInt(existingTvid, 10) || 0 : 0,
    agentnumber: branch.branchCode,
    agencyname: branch.agencyName,
    agent_file_number: orderDetail.fileNumber,
    email_requestor: 'cpl@pct.com',
    purchase_price: resolvePurchasePrice(orderDetail, input),
    property: buildProperty(orderDetail.property),
    buyers: buildBuyers(orderDetail.buyers),
    sellers: buildSellers(orderDetail.sellers, orderDetail.transactionType),
    lenders: buildLenders(orderDetail, input),
    search: null,
    commitment: null,
    jacket: null,
    sdn: null,
    history: null,
    notes: null as string | null,
    messages: { success: [] as string[], warning: [] as string[], error: [] as string[] },
    actions: ACTIONS_CREATE,
    partnerCode: parseInt(cfg.integrationPartner, 10) || 0,
    cpl: null,
    priors: null,
  };

  const res = await fetch(
    `${cfg.baseUrl}VendorApi/Order/Update/${cfg.integrationPartner}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Westcor order update failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as WestcorOrderResponse;

  if (data.messages?.error && data.messages.error.length > 0) {
    // ─── WESTCOR CAN PARTLY SUCCEED, AND THE TVID IS IN THIS BODY ───────────
    //
    // A 200 carrying `messages.error` means Westcor CREATED THE ORDER and then
    // rejected something inside it — one bad name, say. `data.tvid` is the
    // order it just made, sitting in the same object as the error.
    //
    // Throwing without it strands the file permanently: nothing on our side
    // records the tvid, so the next attempt issues a CREATE and Westcor
    // refuses it as "Agent Number - Order Number Must be Unique" forever. That
    // is what happened to orders 48, 49 and 6142 — see
    // docs/tickets/WESTCOR_PARTIAL_CREATE_STRANDS_THE_ORDER.md.
    //
    // So the tvid rides on the error. The caller persists it before rethrowing,
    // which turns the next attempt into an UPDATE and lets the file recover by
    // itself once whatever Westcor objected to is fixed.
    const err = new Error(data.messages.error[0]) as Error & {
      diagnostics?: Record<string, unknown>;
      westcorTvid?: string;
    };
    const tvid = String(data.tvid ?? 0);
    if (tvid !== '0' && tvid !== 'undefined' && tvid !== 'null') {
      err.westcorTvid = tvid;
      err.diagnostics = { ...(err.diagnostics ?? {}), partialCreateTvid: tvid };
    }
    throw err;
  }

  const westcorOrderId = String(data.tvid ?? 0);
  return { westcorOrderId, orderResponse: data };
}

// ─── Step B: GET full order from Westcor ─────────────────────────────────────

export async function getOrder(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${cfg.baseUrl}VendorApi/Order/${westcorOrderId}/${cfg.integrationPartner}`,
    { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) throw new Error(`Westcor getOrder failed: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

// ─── Step C: PrepareAddCPL ──────────────────────────────────────────────────

export async function prepareAddCpl(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrderId: string,
): Promise<PrepareAddCplResult> {
  const url =
    `${cfg.baseUrl}VendorApi/ClosingLetters/PrepareAddCPL/${westcorOrderId}/${cfg.integrationPartner}`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Westcor PrepareAddCPL failed: HTTP ${res.status}`);
  }

  const text = await res.text();
  if (!text) return { forms: [], cplTemplate: {} };

  const data = JSON.parse(text) as Record<string, unknown>;

  const cplObj = (data.CPL ?? data) as Record<string, unknown>;
  const rawForms = (cplObj.Forms ?? []) as Array<Record<string, unknown>>;

  const forms: CplForm[] = rawForms.map((f) => ({
    id: String(f.FormId ?? f.FormName ?? ''),
    name: String(f.FormName ?? f.name ?? ''),
  }));

  return { forms, cplTemplate: cplObj };
}

// ─── CPL entry builder (legacy-exact, zero template inheritance) ─────────
// Previous approaches inherited from cplTemplate (first blind spread, then
// whitelist). Both caused Westcor EF errors. Now: build from scratch using
// ONLY the 13 fields the legacy PHP sends. Nothing from the template.

function buildCplEntry(
  cplTemplate: Record<string, unknown>,
  selectedFormName: string,
  westcorLenderId: number,
  branch: WestcorBranchInfo,
  westcorOrderTvid: string | number,
): Record<string, unknown> {
  const templateBase = { ...cplTemplate } as Record<string, unknown>;
  delete templateBase.Forms;
  delete templateBase.additionalinfo;

  return {
    ...templateBase,
    TVID: Number(westcorOrderTvid) || 0,
    CPLID: -1,
    FileInformation: null,
    LetterName: selectedFormName,
    LenderID: westcorLenderId,
    PolicyProducingAgentNumber: templateBase.PolicyProducingAgentNumber ?? branch.branchCode,
    PolicyProducingAgentAddressID: branch.branchCode,
    PolicyProducingAgentAddress: branch.address,
    PolicyProducingAgentCity: branch.city,
    PolicyProducingAgentState: branch.state,
    PolicyProducingAgentZip: branch.zip,
    ProtectLender: true,
    // NULL, NOT 'CA1038'. The spec marks ClosingAgentNumber "Required: No,
    // unless issuing a Dual/National CPL", and its single-agent request example
    // sends null. We set IsDualCPL: false on every letter, so this field does
    // not apply to anything we issue.
    //
    // It previously carried the literal 'CA1038' — Westcor's number for the
    // AGENCY, which is also the branch code for the Orange office. That is why
    // the one real production CPL, a Glendale file, printed Orange as the
    // closing agent. Inherited from legacy (Westcor.php:504), not introduced
    // here.
    //
    // The question was never "is CA1038 the right value". It is "should this
    // field be set at all on a single-agent CPL", and the spec says no.
    // See docs/tickets/CPL_CLOSING_AGENT_NUMBER_IS_HARDCODED.md
    ClosingAgentNumber: null as string | null,
    IsDualCPL: false,
  };
}

// ─── Step D: Generate CPL PDF ───────────────────────────────────────────────

export async function generateCplPdf(
  cfg: { baseUrl: string; integrationPartner: string },
  token: string,
  westcorOrder: Record<string, unknown>,
  cplTemplate: Record<string, unknown>,
  selectedFormName: string,
  orderDetail: CplOrderDetail,
  input: CplGenerateInput,
  branch: WestcorBranchInfo,
  orderResponse: WestcorOrderResponse,
): Promise<{ pdf: string; cplId: string; diagnostics: Record<string, unknown> }> {
  // Extract IDs from Step A response, falling back to Step B GET response
  const getOrderBuyers = (westcorOrder.buyers ?? []) as Array<Record<string, unknown>>;
  const getOrderSellers = (westcorOrder.sellers ?? []) as Array<Record<string, unknown>>;
  const getOrderLenders = (westcorOrder.lenders ?? []) as Array<Record<string, unknown>>;
  const getOrderProperty = (westcorOrder.property ?? []) as Array<Record<string, unknown>>;
  const westcorOrderTvid = westcorOrder.tvid ?? orderResponse.tvid ?? 0;

  const propertyId = orderResponse.property?.[0]?.PropertyID
    ?? (getOrderProperty[0]?.PropertyID as number)
    ?? 0;
  const propertyTvid = extractTvid(orderResponse.property?.[0])
    || extractTvid(getOrderProperty[0]);

  const buyerIds = orderDetail.buyers.map((_, i) => ({
    NameID: orderResponse.buyers?.[i]?.NameID
      ?? (getOrderBuyers[i]?.NameID as number)
      ?? 0,
    tvid: extractTvid(orderResponse.buyers?.[i])
      || extractTvid(getOrderBuyers[i]),
  }));
  const sellerIds = buildSellers(orderDetail.sellers, orderDetail.transactionType).map((_, i) => ({
    NameID: orderResponse.sellers?.[i]?.NameID
      ?? (getOrderSellers[i]?.NameID as number)
      ?? 0,
    tvid: extractTvid(orderResponse.sellers?.[i])
      || extractTvid(getOrderSellers[i]),
  }));
  const westcorLenderId = orderResponse.lenders?.[0]?.Id
    ?? (getOrderLenders[0]?.Id as number)
    ?? 0;
  const lenderTvid = extractTvid(orderResponse.lenders?.[0])
    || extractTvid(getOrderLenders[0]);

  const property = buildProperty(orderDetail.property, {
    PropertyID: propertyId,
    tvid: propertyTvid,
  });
  const buyers = buildBuyers(orderDetail.buyers, buyerIds);
  const sellers = buildSellers(orderDetail.sellers, orderDetail.transactionType, sellerIds);
  const lenders = buildLenders(orderDetail, input, {
    Id: westcorLenderId,
    tvid: lenderTvid,
  });

  const cplEntry = buildCplEntry(
    cplTemplate, selectedFormName, westcorLenderId, branch, westcorOrderTvid as string | number,
  );

  const LEGACY_STEP_D_FIELDS = [
    'tvid', 'agentnumber', 'agencyname', 'agent_file_number', 'email_requestor',
    'purchase_price', 'property', 'buyers', 'sellers', 'lenders',
    'search', 'commitment', 'jacket', 'sdn', 'history', 'notes', 'messages',
    'actions', 'partnerCode', 'cpl', 'priors',
  ] as const;

  const existingActions = (westcorOrder.actions ?? {}) as Record<string, unknown>;

  // Last-mile parity: start from Westcor's own order object and override only
  // the mutable sections/flags that legacy updates for Step D.
  const body: Record<string, unknown> = {
    ...westcorOrder,
    purchase_price: String(resolvePurchasePrice(orderDetail, input)),
    property,
    buyers,
    sellers,
    lenders,
    cpl: [cplEntry],
    actions: {
      ...existingActions,
      update_property: true,
      update_buyers: true,
      update_sellers: sellers.length > 0,
      update_lender: true,
      update_cpls: true,
    },
  };

  // Capture payload diagnostics for logging
  const diagnostics: Record<string, unknown> = {
    variant: 'D_get_order_base_template_cpl',
    payloadTopKeys: Object.keys(body),
    legacyExpectedTopKeys: LEGACY_STEP_D_FIELDS,
    legacyMissingTopKeys: LEGACY_STEP_D_FIELDS.filter((key) => !(key in body)),
    legacyExtraTopKeys: Object.keys(body).filter(
      (key) => !LEGACY_STEP_D_FIELDS.includes(key as (typeof LEGACY_STEP_D_FIELDS)[number]),
    ),
    tvid: body.tvid,
    cplEntryKeys: Object.keys(cplEntry),
    cplEntry,
    propertyCount: property.length,
    propertyIds: property.map((p) => p.PropertyID),
    propertyTvids: property.map((p) => p.tvid),
    buyerCount: buyers.length,
    buyerIds: buyers.map((b) => b.NameID),
    buyerTvids: buyers.map((b) => b.tvid),
    sellerCount: sellers.length,
    sellerIds: sellers.map((s) => s.NameID),
    sellerTvids: sellers.map((s) => s.tvid),
    lenderCount: lenders.length,
    lenderId: lenders[0]?.Id ?? null,
    lenderTvid: lenders[0]?.tvid ?? null,
    purchasePrice: body.purchase_price,
    actionFlags: body.actions,
    missingEntityIds: {
      property: property.some((p) => !p.PropertyID),
      buyers: buyers.some((b) => !b.NameID),
      sellers: sellers.some((s) => !s.NameID),
      lenders: lenders.some((l) => !l.Id),
    },
  };

  const res = await fetch(
    `${cfg.baseUrl}VendorApi/Order/Update/${cfg.integrationPartner}`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CPL_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    diagnostics.httpStatus = res.status;
    diagnostics.rawResponse = text.slice(0, 500);
    throw Object.assign(
      new Error(`Westcor CPL generation failed: HTTP ${res.status} — ${text.slice(0, 300)}`),
      { diagnostics },
    );
  }

  const rawText = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(rawText);
  } catch {
    diagnostics.rawResponse = rawText.slice(0, 500);
    throw Object.assign(
      new Error('Westcor CPL response was not valid JSON'),
      { diagnostics },
    );
  }

  // Capture full response shape for debugging
  diagnostics.responseTopKeys = Object.keys(data);
  diagnostics.responseMessages = data.messages ?? null;
  diagnostics.responseCplCount = Array.isArray(data.cpl) ? (data.cpl as unknown[]).length : 0;
  diagnostics.responseBody = data;

  const messages = data.messages as { error?: string[]; warning?: string[]; success?: string[] } | undefined;

  if (messages?.error && messages.error.length > 0) {
    diagnostics.westcorErrors = messages.error;
    diagnostics.westcorWarnings = messages.warning ?? [];
    throw Object.assign(
      new Error(`Westcor CPL error: ${messages.error.join('; ')}`),
      { diagnostics },
    );
  }

  const cplEntries = (data.cpl ?? []) as Array<{
    CPLID?: number;
    cplNumber?: string;
    FileInformation?: { FileAsBase64?: string; FileAsDataVaultFileID?: string };
  }>;
  const lastCpl = cplEntries[cplEntries.length - 1];
  if (!lastCpl) {
    throw Object.assign(
      new Error('Westcor returned no CPL entry'),
      { diagnostics },
    );
  }

  const pdf = lastCpl.FileInformation?.FileAsBase64 ?? '';
  if (!pdf) {
    diagnostics.cplEntryResponse = lastCpl;
    throw Object.assign(
      new Error('Westcor returned empty CPL PDF'),
      { diagnostics },
    );
  }

  const cplId = String(lastCpl.CPLID ?? lastCpl.cplNumber ?? `WC-${Date.now()}`);
  return { pdf, cplId, diagnostics };
}

// ─── Form selection ─────────────────────────────────────────────────────────

export function selectCplForm(
  forms: CplForm[],
  mode: 'single' | 'multiple' = 'single',
): CplForm {
  if (forms.length === 0) throw new Error('No CPL forms available from Westcor');

  if (mode === 'single') {
    const singleMatch = forms.find(
      (f) => /\bsingle\b/i.test(f.name) && !/multiple|blanket/i.test(f.name),
    );
    if (singleMatch) return singleMatch;
    const nonMultiple = forms.find((f) => !/multiple|blanket/i.test(f.name));
    if (nonMultiple) return nonMultiple;
  } else {
    const multiMatch = forms.find((f) => /multiple|blanket/i.test(f.name));
    if (multiMatch) return multiMatch;
  }

  const available = forms.map((f) => `"${f.name}"`).join(', ');
  throw new Error(
    `No matching CPL form for mode "${mode}". Available forms: ${available}`,
  );
}

// ─── Name parsing (kept for other callers) ──────────────────────────────────

export function parseName(
  fullName: string,
): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',', 2);
    return { firstName: (first ?? '').trim(), lastName: (last ?? '').trim() };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  const last = parts.pop()!;
  return { firstName: parts.join(' '), lastName: last };
}
