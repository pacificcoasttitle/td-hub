import { describe, expect, it } from 'vitest';
import { formatClientPickerAddress } from './client-selector';

describe('formatClientPickerAddress', () => {
  it('joins street and city when both exist', () => {
    expect(formatClientPickerAddress({
      address: '140 Newport Center Drive #100',
      city: 'Newport Beach',
    })).toBe('140 Newport Center Drive #100, Newport Beach');
  });

  it('shows city alone when street is missing', () => {
    expect(formatClientPickerAddress({ address: null, city: 'Glendale' })).toBe('Glendale');
    expect(formatClientPickerAddress({ address: '  ', city: 'Glendale' })).toBe('Glendale');
  });

  it('shows street alone when city is missing', () => {
    expect(formatClientPickerAddress({ address: '123 Main St', city: null })).toBe('123 Main St');
  });

  it('returns blank (not an em-dash) when no address exists', () => {
    expect(formatClientPickerAddress(null)).toBe('');
    expect(formatClientPickerAddress(undefined)).toBe('');
    expect(formatClientPickerAddress({ address: null, city: null })).toBe('');
    expect(formatClientPickerAddress({ address: '  ', city: '' })).toBe('');
    expect(formatClientPickerAddress({ address: null, city: null })).not.toContain('—');
  });
});
