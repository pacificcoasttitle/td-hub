import { parseStringPromise } from 'xml2js';
import { db } from '@/lib/db/client';
import { vendorApiLogs } from '@/lib/db/schema';
import type { CplForm } from '../types';

const TIMEOUT_MS = 20_000;
const CPL_TIMEOUT_MS = 30_000;

async function logSoapExchange(params: {
  operation: string; orderId?: number;
  soapAction: string; requestEnvelope: string;
  httpStatus?: number; responseBody?: string;
  success: boolean; errorCategory?: string;
}) {
  try {
    await db.insert(vendorApiLogs).values({
      vendor: 'fnf',
      operation: params.operation,
      orderId: params.orderId ?? null,
      requestId: `fnf-soap-${crypto.randomUUID()}`,
      startedAt: new Date(),
      endedAt: new Date(),
      success: params.success,
      httpStatus: params.httpStatus ?? null,
      errorCategory: params.errorCategory ?? null,
      requestMeta: {
        soapAction: params.soapAction,
        requestEnvelope: params.requestEnvelope.slice(0, 1000),
      } as Record<string, unknown>,
      responseMeta: params.responseBody
        ? { responseBody: params.responseBody.slice(0, 1000) } as Record<string, unknown>
        : null,
    });
  } catch { /* logging must not break the main flow */ }
}

// Namespaces — exact match to legacy Fnf.php
const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/';
const NS_CPL = 'http://cpl.fnf.com/services/v3/cplmanagement/';
const NS_DATA = 'http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.V3';
const NS_ENUMS = 'http://schemas.datacontract.org/2004/07/FNF.CPL.ServiceModel.Data.Enums';

export interface FnfBranchInfo {
  agentNumber: string;   // CLUP — maps to cpl_branches.branch_code
  underwriterCode: string; // maps to cpl_branches.underwriter_code
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

export interface FnfGenerateCplParams {
  fileNumber: string;
  branch: FnfBranchInfo;
  formName: string;
  onBehalfOfUser: string;
  userToken: string;
  borrowerVesting: string;
  lenderName: string;
  lenderAttnName: string;
  lenderAddress: string;
  lenderCity: string;
  lenderState: string;
  lenderZip: string;
  lenderAssignmentClause: string;
  loanNumber: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyCounty: string;
  documentId?: string | null; // null → CreateCPL; present → EditCPL
}

/**
 * FNF asks for the agent telephone "format[ted] with mask (999) 999-9999"
 * (CPL Integration Guide, form-specific data item 20).
 *
 * FORMATTED AT SEND TIME, never written back to cpl_branches. That table is
 * owned by the vendor feed and anything we edit there is overwritten on the
 * next sync — so a stored "fix" would silently revert and nobody would notice.
 *
 * Measured 2026-08-31: 0 of 13 FNF branch rows are already in the mask. They
 * hold "925.942.4040", "818.662-6700" and similar.
 *
 * Anything that is not a recognisable 10-digit US number is passed through
 * unchanged rather than mangled into the mask. A wrong-but-plausible phone
 * number on a closing protection letter is worse than an oddly formatted one,
 * and the field is optional per the live metadata.
 */
export function formatAgentPhone(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (s === '') return '';

  const digits = s.replace(/[^0-9]/g, '');
  // Strip a leading country code only when it leaves exactly 10 digits.
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return s;

  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── GetCPLList — legacy-exact envelope ─────────────────────────────────────

export function buildGetCplListEnvelope(params: {
  agentNumber: string;
  onBehalfOfUser: string;
  fileNumber: string;
  state: string;
  underwriterCode: string;
}): string {
  return `<soapenv:Envelope xmlns:soapenv="${NS_SOAP}" xmlns:cpl="${NS_CPL}">
  <soapenv:Header/>
  <soapenv:Body>
    <cpl:GetCPLListRequest>
      <cpl:CLUP>${escapeXml(params.agentNumber)}</cpl:CLUP>
      <cpl:OnBehalfOfUser>${escapeXml(params.onBehalfOfUser)}</cpl:OnBehalfOfUser>
      <cpl:OrderNumber>${escapeXml(params.fileNumber)}</cpl:OrderNumber>
      <cpl:StateAbbreviation>${escapeXml(params.state)}</cpl:StateAbbreviation>
      <cpl:UnderwriterShortName>${escapeXml(params.underwriterCode)}</cpl:UnderwriterShortName>
    </cpl:GetCPLListRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ─── GenerateCPL / EditCPL — legacy-exact envelope ──────────────────────────

function buildFormFields(p: FnfGenerateCplParams): string {
  const nv = (name: string, value: string) =>
    `<a:NameValue>
      <a:Name>${escapeXml(name)}</a:Name>
      <a:Value>${escapeXml(value)}</a:Value>
    </a:NameValue>`;

  const fields: string[] = [
    nv('[Buyer/Borrower Name]', p.borrowerVesting),
    nv('[Lender Name]', p.lenderName),
    nv('[Lender Clause]', p.lenderAssignmentClause),
    nv('[Lender Address 1]', p.lenderAddress),
    nv('[Lender City]', p.lenderCity),
    nv('[Lender State]', p.lenderState),
    nv('[Lender Zip Code]', p.lenderZip),
    nv('[Lender Attention]', p.lenderAttnName),
  ];

  if (p.loanNumber) {
    fields.push(nv('[Loan Number]', p.loanNumber));
  }

  fields.push(
    nv('[Underwriter]', p.branch.underwriterCode),
    nv('[Property Street Address]', p.propertyAddress),
    nv('[Property City]', p.propertyCity),
    nv('[Property County]', p.propertyCounty),
    nv('[Property State]', p.propertyState),
    nv('[Property Zip Code]', p.propertyZip),
    nv('[Date]', formatDate()),
    nv('[File Number]', p.fileNumber),
    nv('[Agent/Company City]', p.branch.city),
    nv('[Agent/Company Name]', 'Pacific Coast Title Company'),
    nv('[Agent/Company State]', 'CA'),
    nv('[Agent/Company Street Address]', p.branch.address),
  );

  if (p.branch.phone) {
    fields.push(nv('[Agent/Company Telephone]', formatAgentPhone(p.branch.phone)));
  }

  fields.push(nv('[Agent/Company Zip Code]', p.branch.zip));

  return fields.join('\n');
}

function formatDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function buildGenerateCplEnvelope(p: FnfGenerateCplParams): string {
  const state = p.propertyState || 'CA';
  const isEdit = !!p.documentId;

  const documentIdNode = isEdit
    ? `<a:DocumentId>${escapeXml(p.documentId!)}</a:DocumentId>`
    : '';
  const formNameNode = isEdit
    ? ''
    : `<a:FormName>${escapeXml(p.formName)}</a:FormName>`;

  return `<s:Envelope xmlns:s="${NS_SOAP}">
  <s:Body>
    <GenerateCPLRequest xmlns="${NS_CPL}">
      <CPLInformation xmlns:a="${NS_DATA}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <a:CLUP>${escapeXml(p.branch.agentNumber)}</a:CLUP>
        <a:DBAsIndicator>false</a:DBAsIndicator>
        ${documentIdNode}${formNameNode}
        <a:LegalNameIndicator>true</a:LegalNameIndicator>
        <a:OrderNumber>${escapeXml(p.fileNumber)}</a:OrderNumber>
        <a:RecipientTypes xmlns:b="${NS_ENUMS}">
          <b:RecipientType>Lender</b:RecipientType>
        </a:RecipientTypes>
        <a:StateAbbreviation>${escapeXml(state)}</a:StateAbbreviation>
        <a:UnderwriterShortName>${escapeXml(p.branch.underwriterCode)}</a:UnderwriterShortName>
      </CPLInformation>
      <ContextUser s:nil="true"/>
      <FormFields xmlns:a="${NS_DATA}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        ${buildFormFields(p)}
      </FormFields>
      <OnBehalfOfUser>${escapeXml(p.onBehalfOfUser)}</OnBehalfOfUser>
      <TraxToken>${escapeXml(p.userToken)}</TraxToken>
    </GenerateCPLRequest>
  </s:Body>
</s:Envelope>`;
}

// ─── HTTP + Parsing ─────────────────────────────────────────────────────────

export async function getCplForms(
  cfg: { cplUrl: string; clientId: string; onBehalfOfUser: string },
  vendorToken: string,
  branch: FnfBranchInfo,
  fileNumber: string,
  state: string,
  orderId?: number,
): Promise<CplForm[]> {
  const envelope = buildGetCplListEnvelope({
    agentNumber: branch.agentNumber,
    onBehalfOfUser: cfg.onBehalfOfUser,
    fileNumber,
    state: state || 'CA',
    underwriterCode: branch.underwriterCode,
  });

  // Log BEFORE the call so crashes are visible
  await logSoapExchange({
    operation: 'get_cpl_list_request', orderId,
    soapAction: 'GetCPLList', requestEnvelope: envelope,
    success: true,
  });

  const res = await fetch(`${cfg.cplUrl}v3/CPLManagement.svc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'SOAPAction': 'GetCPLList',
      'Authorization': `Bearer ${vendorToken}`,
      'ClientID': cfg.clientId,
    },
    body: envelope,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    await logSoapExchange({
      operation: 'get_cpl_list', orderId,
      soapAction: 'GetCPLList', requestEnvelope: envelope,
      httpStatus: res.status, responseBody: text,
      success: false, errorCategory: 'HTTP_ERROR',
    });
    throw new Error(`FNF GetCPLList failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const xml = await res.text();
  await logSoapExchange({
    operation: 'get_cpl_list', orderId,
    soapAction: 'GetCPLList', requestEnvelope: envelope,
    httpStatus: res.status, responseBody: xml,
    success: true,
  });
  const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });

  // Legacy path: s:Envelope → s:Body → GetCPLListResponse → UnderwriterStateCPLs → a:UnderwriterStateCPL
  const body = parsed['s:Envelope']?.['s:Body'];
  if (!body) throw new Error('FNF GetCPLList: no SOAP body in response');

  const listResponse = body['GetCPLListResponse'];
  if (!listResponse) throw new Error('FNF GetCPLList: no GetCPLListResponse');

  const cplItems = listResponse['UnderwriterStateCPLs']?.['a:UnderwriterStateCPL'];
  if (!cplItems) return [];

  const items = Array.isArray(cplItems) ? cplItems : [cplItems];
  return items.map((item: Record<string, string>) => ({
    id: item['a:FormName'] ?? '',
    name: item['a:FormName'] ?? '',
  }));
}

export async function generateCplSoap(
  cfg: { cplUrl: string; clientId: string },
  vendorToken: string,
  params: FnfGenerateCplParams,
  orderId?: number,
): Promise<{ pdf: string; cplId: string; cplNumber: string; documentId: string }> {
  const isEdit = !!params.documentId;
  const envelope = buildGenerateCplEnvelope(params);
  const soapAction = isEdit ? 'EditCPL' : 'CreateCPL';

  // Log BEFORE the call
  await logSoapExchange({
    operation: `${soapAction.toLowerCase()}_request`, orderId,
    soapAction, requestEnvelope: envelope,
    success: true,
  });

  const res = await fetch(`${cfg.cplUrl}v3/CPLManagement.svc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'SOAPAction': soapAction,
      'Authorization': `Bearer ${vendorToken}`,
      'ClientID': cfg.clientId,
    },
    body: envelope,
    signal: AbortSignal.timeout(CPL_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    await logSoapExchange({
      operation: soapAction.toLowerCase(), orderId,
      soapAction, requestEnvelope: envelope,
      httpStatus: res.status, responseBody: text,
      success: false, errorCategory: 'HTTP_ERROR',
    });
    throw new Error(`FNF ${soapAction} failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const xml = await res.text();
  // Log response (truncated — PDF base64 can be huge)
  await logSoapExchange({
    operation: soapAction.toLowerCase(), orderId,
    soapAction, requestEnvelope: envelope,
    httpStatus: res.status, responseBody: xml,
    success: true,
  });
  const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });

  // Legacy path: s:Envelope → s:Body → GenerateCPLResponse → CPLLetters → a:CPLLetter
  const body = parsed['s:Envelope']?.['s:Body'];
  if (!body) throw new Error(`FNF ${soapAction}: no SOAP body in response`);

  const genResponse = body['GenerateCPLResponse'];
  if (!genResponse) throw new Error(`FNF ${soapAction}: no GenerateCPLResponse`);

  const cplLetters = genResponse['CPLLetters'];
  const letter = cplLetters?.['a:CPLLetter'];
  if (!letter) {
    if (isEdit && !cplLetters) {
      throw new EditCplEmptyError('FNF EditCPL returned empty CPLLetters — fallback to CreateCPL');
    }
    throw new Error(`FNF ${soapAction}: no CPLLetter in response`);
  }

  const firstLetter = Array.isArray(letter) ? letter[0] : letter;
  const pdf = firstLetter['a:Content'] ?? '';
  if (!pdf) throw new Error(`FNF ${soapAction}: empty PDF content`);

  const documentId = String(firstLetter['a:DocumentId'] ?? '');
  const cplId = String(firstLetter['a:CPLLetterID'] ?? documentId);
  const cplNumber = String(firstLetter['a:CPLNumber'] ?? '');

  return { pdf, cplId, cplNumber, documentId };
}

export class EditCplEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditCplEmptyError';
  }
}
