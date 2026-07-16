import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  canAccessOrderDetailResourceMock,
  getSessionMock,
} = vi.hoisted(() => ({
  canAccessOrderDetailResourceMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/security/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/security/permissions', () => ({
  canAccessOrderDetailResource: canAccessOrderDetailResourceMock,
}));

vi.mock('@/lib/db/client', () => {
  const empty = async () => [];
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(empty);
  chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
  return {
    db: {
      select: vi.fn(() => chain),
    },
  };
});

vi.mock('@/lib/db/schema', () => ({
  documents: { orderId: 'documents.order_id', status: 'documents.status', category: 'documents.category', createdAt: 'documents.created_at' },
  docCategoryEnum: { enumValues: ['prelim', 'cpl', 'proposed_insured'] },
  orderNotes: {
    id: 'order_notes.id',
    subject: 'order_notes.subject',
    body: 'order_notes.body',
    authorName: 'order_notes.author_name',
    createdAt: 'order_notes.created_at',
    isSyncedToSoftpro: 'order_notes.is_synced',
    isInternal: 'order_notes.is_internal',
    orderId: 'order_notes.order_id',
  },
  orders: { id: 'orders.id', fileNumber: 'orders.file_number' },
  prelimAnalyses: {
    id: 'prelim_analyses.id',
    status: 'prelim_analyses.status',
    orderId: 'prelim_analyses.order_id',
    createdAt: 'prelim_analyses.created_at',
    triggeredBy: 'prelim_analyses.triggered_by',
    complexityScore: 'prelim_analyses.complexity_score',
    complexityLevel: 'prelim_analyses.complexity_level',
    complexityReasons: 'prelim_analyses.complexity_reasons',
    summaryText: 'prelim_analyses.summary_text',
    extractionJson: 'prelim_analyses.extraction_json',
    requirementCount: 'prelim_analyses.requirement_count',
    blockerCount: 'prelim_analyses.blocker_count',
    lienCount: 'prelim_analyses.lien_count',
    taxCount: 'prelim_analyses.tax_count',
    taxDefaultCount: 'prelim_analyses.tax_default_count',
    otherFindingCount: 'prelim_analyses.other_finding_count',
    errorMessage: 'prelim_analyses.error_message',
  },
  adminActivityLogs: {},
  documentAudit: {},
  vendorApiLogs: {},
  titlePointData: {},
  orderStatusHistory: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => ({ eq: args })),
  and: vi.fn((...args) => ({ and: args })),
  desc: vi.fn((v) => v),
}));

vi.mock('@/lib/domain/orders/service', () => ({
  getOrderByIdSimple: vi.fn(async () => ({ id: 123, fileNumber: '20012345-OCT' })),
}));

vi.mock('@/lib/integrations/softpro', () => ({
  getFees: vi.fn(async () => ({ success: true, data: [] })),
  addNotes: vi.fn(),
}));

import { GET as getDocuments } from './documents/route';
import { GET as getActivity } from './activity/route';
import { GET as getFees } from './fees/route';
import { GET as getNotes } from './notes/route';
import { GET as getPrelimAnalysis } from './prelim-analysis/route';

const manager = { id: 'manager-1', role: 'sales_manager', contactId: 10, email: 'm@pct.com', displayName: 'Mgr' };
const params = { params: Promise.resolve({ id: '123' }) };

function request(url = 'http://localhost/api/orders/123/documents') {
  return new Request(url) as never;
}

describe('DetailModal tab endpoints use DC-2 detail-resource gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(manager);
  });

  const cases = [
    { name: 'documents', call: () => getDocuments(request(), params) },
    { name: 'activity', call: () => getActivity(request('http://localhost/api/orders/123/activity'), params) },
    { name: 'fees', call: () => getFees(request('http://localhost/api/orders/123/fees'), params) },
    { name: 'notes', call: () => getNotes(request('http://localhost/api/orders/123/notes'), params) },
    { name: 'prelim-analysis', call: () => getPrelimAnalysis(request('http://localhost/api/orders/123/prelim-analysis'), params) },
  ] as const;

  it('allows a manager through all five tabs when the team-scoped predicate matches', async () => {
    canAccessOrderDetailResourceMock.mockResolvedValue(true);

    for (const endpoint of cases) {
      canAccessOrderDetailResourceMock.mockClear();
      const response = await endpoint.call();
      const body = await response.json().catch(() => null);
      expect(canAccessOrderDetailResourceMock, endpoint.name).toHaveBeenCalledWith(manager, 123);
      // Access denial always uses exact "Not found"; other 404s (e.g. no prelim analysis yet) are OK.
      if (response.status === 404) {
        expect(body?.error, endpoint.name).not.toBe('Not found');
      }
    }
  });

  it('returns 404 on all five tabs for a non-team order (no over-grant)', async () => {
    canAccessOrderDetailResourceMock.mockResolvedValue(false);

    for (const endpoint of cases) {
      const response = await endpoint.call();
      expect(response.status, endpoint.name).toBe(404);
      const body = await response.json();
      expect(body.error).toBe('Not found');
    }
  });
});
