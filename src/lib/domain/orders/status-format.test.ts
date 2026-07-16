import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  STATUS_FILTER_OPTIONS,
  statusBadge,
  statusColor,
  statusLabel,
} from './status-format';

describe('order status formatter', () => {
  it('labels every canonical order status', () => {
    expect(statusLabel('open')).toBe('Open');
    expect(statusLabel('in_process')).toBe('In Process');
    expect(statusLabel('completed')).toBe('Completed');
    expect(statusLabel('closed')).toBe('Closed');
    expect(statusLabel('canceled')).toBe('Canceled');
    expect(statusLabel('duplicate')).toBe('Duplicate');
  });

  it('assigns the canonical semantic palette', () => {
    expect(statusColor('open')).toBe('bg-blue-50 text-blue-700 border-blue-200');
    expect(statusColor('in_process')).toBe('bg-amber-50 text-amber-700 border-amber-200');
    expect(statusColor('completed')).toBe('bg-teal-50 text-teal-700 border-teal-200');
    expect(statusColor('closed')).toBe('bg-green-50 text-green-700 border-green-200');
    expect(statusColor('canceled')).toBe('bg-red-50 text-red-700 border-red-200');
    expect(statusColor('duplicate')).toBe('bg-gray-100 text-gray-600 border-gray-200');
  });

  it('keeps filter options in full enum order', () => {
    expect(STATUS_FILTER_OPTIONS).toEqual(
      ORDER_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
    );
  });

  it('falls back safely for unknown and empty statuses', () => {
    expect(statusLabel(null)).toBe('—');
    expect(statusColor(undefined)).toBe('bg-gray-100 text-gray-600 border-gray-200');
    expect(statusBadge('pending_review')).toEqual({
      label: 'Pending Review',
      color: 'bg-gray-100 text-gray-600 border-gray-200',
    });
  });
});
