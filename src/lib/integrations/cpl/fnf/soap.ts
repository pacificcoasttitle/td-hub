import { parseStringPromise } from 'xml2js';
import type { CplOrderDetail, CplForm } from '../types';

const TIMEOUT_MS = 20_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SoapAny = Record<string, any>;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildGetCplListEnvelope(orderDetail: CplOrderDetail, userToken: string): string {
  const prop = orderDetail.property;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    '                  xmlns:v3="http://www.fnf.com/xes/cpl/v3">',
    '  <soapenv:Header/>',
    '  <soapenv:Body>',
    '    <v3:GetCPLList>',
    '      <v3:Token>' + escapeXml(userToken) + '</v3:Token>',
    '      <v3:PropertyState>' + escapeXml(prop?.state ?? 'CA') + '</v3:PropertyState>',
    '      <v3:PropertyCounty>' + escapeXml(prop?.county ?? '') + '</v3:PropertyCounty>',
    '    </v3:GetCPLList>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n');
}

export function buildCreateCplEnvelope(orderDetail: CplOrderDetail, formId: string, userToken: string): string {
  const prop = orderDetail.property;
  const lender = orderDetail.lender;
  const buyerNames = orderDetail.buyers.join('; ');
  const sellerNames = orderDetail.sellers.join('; ');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"',
    '                  xmlns:v3="http://www.fnf.com/xes/cpl/v3">',
    '  <soapenv:Header/>',
    '  <soapenv:Body>',
    '    <v3:CreateCPL>',
    '      <v3:Token>' + escapeXml(userToken) + '</v3:Token>',
    '      <v3:CPLFormID>' + escapeXml(formId) + '</v3:CPLFormID>',
    '      <v3:FileNumber>' + escapeXml(orderDetail.fileNumber) + '</v3:FileNumber>',
    '      <v3:PropertyAddress>' + escapeXml(prop?.address ?? '') + '</v3:PropertyAddress>',
    '      <v3:PropertyCity>' + escapeXml(prop?.city ?? '') + '</v3:PropertyCity>',
    '      <v3:PropertyState>' + escapeXml(prop?.state ?? 'CA') + '</v3:PropertyState>',
    '      <v3:PropertyZip>' + escapeXml(prop?.zip ?? '') + '</v3:PropertyZip>',
    '      <v3:PropertyCounty>' + escapeXml(prop?.county ?? '') + '</v3:PropertyCounty>',
    '      <v3:BuyerName>' + escapeXml(buyerNames) + '</v3:BuyerName>',
    '      <v3:SellerName>' + escapeXml(sellerNames) + '</v3:SellerName>',
    '      <v3:LenderName>' + escapeXml(lender?.name ?? '') + '</v3:LenderName>',
    '      <v3:LenderAddress>' + escapeXml(lender?.address ?? '') + '</v3:LenderAddress>',
    '      <v3:LenderCity>' + escapeXml(lender?.city ?? '') + '</v3:LenderCity>',
    '      <v3:LenderState>' + escapeXml(lender?.state ?? '') + '</v3:LenderState>',
    '      <v3:LenderZip>' + escapeXml(lender?.zip ?? '') + '</v3:LenderZip>',
    '      <v3:PurchasePrice>' + escapeXml(orderDetail.salesPrice ?? '0') + '</v3:PurchasePrice>',
    '      <v3:LoanAmount>' + escapeXml(orderDetail.loanAmount ?? '0') + '</v3:LoanAmount>',
    '    </v3:CreateCPL>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n');
}

function extractSoapBody(parsed: SoapAny): SoapAny | null {
  const envelope = parsed['s:Envelope'] ?? parsed['soap:Envelope'] ?? parsed['soapenv:Envelope'];
  if (!envelope) return null;
  return envelope['s:Body'] ?? envelope['soap:Body'] ?? envelope['soapenv:Body'] ?? null;
}

export async function getCplForms(
  cfg: { cplUrl: string; clientId: string },
  vendorToken: string,
  userToken: string,
  orderDetail: CplOrderDetail,
): Promise<CplForm[]> {
  const envelope = buildGetCplListEnvelope(orderDetail, userToken);

  const res = await fetch(`${cfg.cplUrl}v3/CPLManagement.svc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'GetCPLList',
      'Authorization': `Bearer ${vendorToken}`,
      'ClientID': cfg.clientId,
    },
    body: envelope,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FNF GetCPLList failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const xml = await res.text();
  const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
  const body = extractSoapBody(parsed);
  const result = body?.GetCPLListResponse?.GetCPLListResult;
  if (!result) return [];

  const rawForms = Array.isArray(result.CPLForms?.CPLForm)
    ? result.CPLForms.CPLForm
    : result.CPLForms?.CPLForm ? [result.CPLForms.CPLForm] : [];

  return rawForms.map((f: Record<string, string>) => ({
    id: f.CPLFormID ?? f.FormID ?? '',
    name: f.CPLFormName ?? f.FormName ?? f.Description ?? '',
  }));
}

export async function generateCplSoap(
  cfg: { cplUrl: string; clientId: string },
  vendorToken: string,
  userToken: string,
  orderDetail: CplOrderDetail,
  formId: string,
): Promise<{ pdf: string; cplId: string; cplNumber: string }> {
  const envelope = buildCreateCplEnvelope(orderDetail, formId, userToken);

  const res = await fetch(`${cfg.cplUrl}v3/CPLManagement.svc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'CreateCPL',
      'Authorization': `Bearer ${vendorToken}`,
      'ClientID': cfg.clientId,
    },
    body: envelope,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FNF CreateCPL failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  const xml = await res.text();
  const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
  const body = extractSoapBody(parsed);
  const result = body?.CreateCPLResponse?.CreateCPLResult ?? body?.GenerateCPLResponse?.GenerateCPLResult;
  if (!result) throw new Error('FNF CreateCPL returned no result');

  const letters = result.CPLLetters;
  const letter = Array.isArray(letters?.['a:CPLLetter'])
    ? letters['a:CPLLetter'][0]
    : letters?.['a:CPLLetter'] ?? letters?.CPLLetter;

  const pdf = letter?.['a:Content'] ?? letter?.Content ?? '';
  if (!pdf) throw new Error('FNF returned empty CPL PDF content');

  const cplId = letter?.['a:CPLLetterID'] ?? letter?.CPLLetterID ?? `FNF-${Date.now()}`;
  const cplNumber = letter?.['a:CPLNumber'] ?? letter?.CPLNumber ?? '';
  return { pdf, cplId: String(cplId), cplNumber: String(cplNumber) };
}
