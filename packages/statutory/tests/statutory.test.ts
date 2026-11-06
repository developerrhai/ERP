// packages/statutory/tests/statutory.test.ts
import { describe, it, expect } from 'vitest';
import {
  INDIAN_STATES,
  isValidStateCode,
  getStateByCode,
  validatePan,
  isValidPan,
  validateGstin,
  isValidGstin,
  computeGstinChecksum,
  validateCin,
  isValidCin,
} from '../src/index.js';

describe('Statutory Package — @rhai/statutory', () => {
  describe('States and UTs', () => {
    it('validates official Indian state codes', () => {
      expect(isValidStateCode('27')).toBe(true); // Maharashtra
      expect(getStateByCode('27')?.name).toBe('Maharashtra');
      expect(getStateByCode('27')?.isUnionTerritory).toBe(false);

      expect(isValidStateCode('07')).toBe(true); // Delhi
      expect(getStateByCode('07')?.isUnionTerritory).toBe(true);

      expect(isValidStateCode('99')).toBe(true); // Centre
      expect(isValidStateCode('00')).toBe(false);
      expect(isValidStateCode('98')).toBe(false);
      expect(isValidStateCode('XX')).toBe(false);
    });
  });

  describe('PAN Validation', () => {
    it('validates correct PAN formats and identifies entity types', () => {
      const companyPan = validatePan('AAACR5055K');
      expect(companyPan.valid).toBe(true);
      expect(companyPan.entityType).toBe('Company');

      const indPan = validatePan('ABCPE1234F');
      expect(indPan.valid).toBe(true);
      expect(indPan.entityType).toBe('Individual');

      const firmPan = validatePan('ABCFA1234G');
      expect(firmPan.valid).toBe(true);
      expect(firmPan.entityType).toBe('Firm');

      expect(isValidPan('AAACR5055K')).toBe(true);
      expect(isValidPan('abcde1234f')).toBe(true); // case-insensitive
    });

    it('rejects invalid PAN numbers', () => {
      expect(isValidPan('AAACR5055')).toBe(false); // too short
      expect(isValidPan('AAACR5055KK')).toBe(false); // too long
      expect(isValidPan('12345ABCDE')).toBe(false); // wrong structure
      expect(isValidPan('')).toBe(false);
      expect(isValidPan(null)).toBe(false);
    });
  });

  describe('GSTIN Validation & Mod-36 Checksum (E-05)', () => {
    it('computes Mod-36 checksum accurately for given 14-char prefix', () => {
      const prefix = '27AAACR5055K1Z';
      const checksum = computeGstinChecksum(prefix);
      expect(checksum).toBeDefined();
      expect(checksum.length).toBe(1);
      expect(/^[0-9A-Z]$/.test(checksum)).toBe(true);

      const fullGstin = prefix + checksum;
      const res = validateGstin(fullGstin);
      expect(res.valid).toBe(true);
      expect(res.stateCode).toBe('27');
      expect(res.state?.name).toBe('Maharashtra');
      expect(res.pan).toBe('AAACR5055K');
      expect(res.panDetails?.entityType).toBe('Company');
      expect(res.checksum).toBe(checksum);
    });

    it('flags checksum mismatch when checksum character is tampered', () => {
      const prefix = '27AAACR5055K1Z';
      const correctChecksum = computeGstinChecksum(prefix);
      // Pick an incorrect char
      const wrongChecksum = correctChecksum === '0' ? '1' : '0';
      const badGstin = prefix + wrongChecksum;

      const res = validateGstin(badGstin);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('GSTIN checksum mismatch');
      expect(res.expectedChecksum).toBe(correctChecksum);
      expect(res.checksum).toBe(wrongChecksum);

      // But if verifyChecksum is false, it accepts the regex structure
      const softRes = validateGstin(badGstin, { verifyChecksum: false });
      expect(softRes.valid).toBe(true);
    });

    it('rejects malformed GSTINs', () => {
      expect(isValidGstin('27AAACR5055K1Z')).toBe(false); // 14 chars
      expect(isValidGstin('99AAACR5055K1ZZZ')).toBe(false); // 16 chars
      expect(isValidGstin('XXAAACR5055K1Z0')).toBe(false); // bad state
      expect(isValidGstin('2712345678901Z0')).toBe(false); // bad PAN structure
    });
  });

  describe('CIN Validation', () => {
    it('validates listed and unlisted CIN numbers with metadata', () => {
      const unlisted = validateCin('U72200MH2015PTC123456');
      expect(unlisted.valid).toBe(true);
      expect(unlisted.isListed).toBe(false);
      expect(unlisted.industryCode).toBe('72200');
      expect(unlisted.stateCode).toBe('MH');
      expect(unlisted.incorporationYear).toBe(2015);
      expect(unlisted.companyClassification).toBe('PTC');
      expect(unlisted.rocRegistrationNumber).toBe('123456');

      const listed = validateCin('L24110MH1985PLC036789');
      expect(listed.valid).toBe(true);
      expect(listed.isListed).toBe(true);
      expect(listed.incorporationYear).toBe(1985);
      expect(listed.companyClassification).toBe('PLC');
    });

    it('rejects invalid CINs', () => {
      expect(isValidCin('A72200MH2015PTC123456')).toBe(false); // must start with L or U
      expect(isValidCin('U72200MH201PTC123456')).toBe(false); // year too short
      expect(isValidCin('')).toBe(false);
    });
  });
});
