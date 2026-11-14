import { describe, expect, it } from 'vitest';
import { amountInWords } from './words';

describe('amountInWords (Indian)', () => {
  it('uses lakh and crore', () => {
    expect(amountInWords(125000)).toBe('Rupees One Lakh Twenty Five Thousand Only');
    expect(amountInWords(12345678)).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
    );
  });
  it('adds paise and handles zero', () => {
    expect(amountInWords(1.5)).toBe('Rupees One and Fifty Paise Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });
});
