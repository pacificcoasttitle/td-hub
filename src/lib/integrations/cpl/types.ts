import type { VendorResult } from '@/lib/integrations/types';

// ─── Underwriter Enum ─────────────────────────────────────────────────────────

export type Underwriter = 'westcor' | 'fnf' | 'natic' | 'doma';

// ─── CPL Generate Input / Output ──────────────────────────────────────────────

export interface CplGenerateInput {
  orderId: number;
  underwriter: Underwriter;
  branchId: number;
  cplMode?: 'single' | 'multiple';
  lenderOverrides?: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export interface CplGenerateResult {
  pdfBase64: string;
  cplId: string;
  vendorRefs: Record<string, string>;
}

// ─── CPL Branch (vendor-returned) ─────────────────────────────────────────────

export interface CplBranch {
  branchCode: string;
  branchName: string;
  agencyName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  underwriterCode?: string;
}

// ─── Order Detail passed to adapter ───────────────────────────────────────────

export interface CplOrderDetail {
  orderId: number;
  fileNumber: string;
  property: {
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    county: string | null;
  } | null;
  buyers: string[];
  sellers: string[];
  lender: {
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  salesPrice: string | null;
  loanAmount: string | null;
}

// ─── CPL Form (Westcor form selection) ────────────────────────────────────────

export interface CplForm {
  id: string;
  name: string;
}

// ─── Adapter Interface ────────────────────────────────────────────────────────

export interface CplAdapter {
  generateCpl(
    input: CplGenerateInput,
    orderDetail: CplOrderDetail
  ): Promise<VendorResult<CplGenerateResult>>;

  getBranches(): Promise<VendorResult<CplBranch[]>>;
}

// ─── Mock Helpers ─────────────────────────────────────────────────────────────

/** Minimal valid-ish base64 PDF for mock adapters. */
export const MOCK_PDF_BASE64 =
  'JVBERi0xLjAKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2Jq' +
  'CjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2Jq' +
  'CjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MDIg' +
  'NzkyXSA+PgplbmRvYmoKeHJlZgowIDQKdHJhaWxlcgo8PCAvUm9vdCAxIDAgUiAvU2l6ZSA0ID4+' +
  'CnN0YXJ0eHJlZgoxNzAKJSVFT0YK';
