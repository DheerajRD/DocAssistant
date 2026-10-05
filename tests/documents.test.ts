import { describe, it, expect } from 'vitest';
import {
  isDate,
  parsedExtraction,
  validateFields,
  latestVersion,
  reminderDate,
  deadlines,
  mask,
  maskedFields,
  validateFile,
  timeline,
} from '../src/lib/documents';
import { planReminders } from '../src/lib/reminders';
import { doc } from './fixtures';
describe('date and structured extraction validation', () => {
  it.each(['2026-02-29', '12/15/2026', 'D/S', '2026-13-01', '2026-04-31', '2026-02-01T00:00:00Z'])(
    'rejects invalid/non-calendar date %s',
    (date) => expect(isDate(date)).toBe(false),
  );
  it('handles leap day', () => expect(isDate('2028-02-29')).toBe(true));
  it('removes invented fields and invalid dates', () => {
    const parsed = parsedExtraction({
      document_type: 'I20',
      type_confidence: 0.9,
      fields: [
        {
          key: 'program_end',
          value: '2026-02-29',
          confidence: 0.95,
          evidence: 'February 29, 2026',
        },
        { key: 'legal_status', value: 'valid', confidence: 1, evidence: 'anything' },
      ],
    });
    expect(parsed.fields).toEqual({ program_end: null });
    expect(parsed.invalid).toContain('program_end');
    expect(parsed.confidence.program_end).toBe(0);
  });
  it('requires evidence for confidence', () =>
    expect(
      parsedExtraction({
        document_type: 'I20',
        type_confidence: 1,
        fields: [{ key: 'program_end', value: '2029-05-15', confidence: 0.99, evidence: null }],
      }).confidence.program_end,
    ).toBe(0));
  it('flags duplicate field keys', () =>
    expect(
      parsedExtraction({
        document_type: 'I20',
        type_confidence: 1,
        fields: [
          { key: 'school', value: 'Fictional School', confidence: 1, evidence: 'School' },
          { key: 'school', value: 'Different School', confidence: 1, evidence: 'School' },
        ],
      }).invalid,
    ).toContain('school'));
  it('rejects reversed date ranges', () =>
    expect(() =>
      validateFields('CPT', { employment_start: '2026-12-15', employment_end: '2026-09-01' }),
    ).toThrow());
  it('casts CPT booleans without assuming missing means yes', () => {
    expect(validateFields('I20', { cpt_authorized: 'true' }).cpt_authorized).toBe(true);
    expect(validateFields('I20', {}).cpt_authorized).toBeNull();
  });
  it('does not create a deadline for D/S', () =>
    expect(deadlines([doc('I94', { admit_until: 'D/S' })])).toEqual([]));
  it('does not interpret a travel signature as expiry', () =>
    expect(deadlines([doc('I20', { travel_signature_date: '2026-09-01' })])).toEqual([]));
  it('does not use CPT dates when CPT is not explicitly recorded', () =>
    expect(
      deadlines([doc('I20', { cpt_authorized: false, employment_end: '2026-12-15' })]),
    ).toEqual([]));
});
describe('version detection', () => {
  it('selects issue date, not upload time', () => {
    const a = doc('I20', {}, { id: 'a', issue_date: '2025-01-01', created_at: '2026-10-01' });
    const b = doc('I20', {}, { id: 'b', issue_date: '2026-09-22', created_at: '2026-09-23' });
    expect(latestVersion([a, b])).toBe('b');
  });
  it('preserves manual current selection', () =>
    expect(
      latestVersion([
        doc('I20', {}, { id: 'a', issue_date: '2025-01-01', current_source: 'manual' }),
        doc('I20', {}, { id: 'b' }),
      ]),
    ).toBe('a'));
  it('requires manual choice for tied dates', () =>
    expect(latestVersion([doc(), doc('I20', {}, { id: 'b' })])).toBeNull());
  it('does not guess issue date from upload time', () =>
    expect(latestVersion([doc('I20', {}, { issue_date: null })])).toBeNull());
});
describe('reminder planning', () => {
  it('calculates year boundaries and leap dates', () => {
    expect(reminderDate('2027-01-01', 7)).toBe('2026-12-25');
    expect(reminderDate('2028-03-01', 1)).toBe('2028-02-29');
  });
  it('uses reviewed current documents only', () => {
    const current = doc('PASSPORT', { expiration_date: '2027-05-01' });
    const old = doc(
      'PASSPORT',
      { expiration_date: '2026-12-01' },
      { id: 'old', is_current: false },
    );
    const low = doc(
      'EAD',
      { expiration_date: '2027-05-01' },
      { id: 'unreviewed', reviewed_at: null },
    );
    expect(planReminders([current, old, low], [30], '2026-10-01')).toHaveLength(1);
  });
  it('does not backfill old offsets', () =>
    expect(
      planReminders([doc('EAD', { expiration_date: '2026-10-10' })], [180, 30, 1], '2026-10-05'),
    ).toHaveLength(1));
});
describe('privacy and file validation', () => {
  it('masks every sensitive field', () => {
    const f = maskedFields({
      passport_number: 'X12345678',
      sevis_id: 'N0012345678',
      admission_number: '12345678901',
      visa_number: '12345678',
      card_number: 'ABC123456789',
      school: 'Fictional University',
    });
    expect(f.school).toBe('Fictional University');
    expect(JSON.stringify(f)).not.toContain('X12345678');
    expect(f.passport_number).toBe('••••5678');
    expect(mask(null)).toBeNull();
  });
  it('rejects spoofed content type and extension', () => {
    expect(() => validateFile(Buffer.from('<script>'), 'application/pdf', 'a.pdf')).toThrow();
    expect(() => validateFile(Buffer.from('%PDF-1.7'), 'application/pdf', 'a.exe')).toThrow();
  });
  it('accepts PDF magic bytes', () =>
    expect(() =>
      validateFile(Buffer.from('%PDF-1.7\n'), 'application/pdf', 'a.pdf'),
    ).not.toThrow());
  it('rejects empty and oversized files', () => {
    expect(() => validateFile(Buffer.alloc(0), 'image/png', 'a.png')).toThrow();
    expect(() =>
      validateFile(Buffer.alloc(4 * 1024 * 1024 + 1), 'application/pdf', 'a.pdf'),
    ).toThrow();
  });
  it('excludes DOB and old versions from timeline', () =>
    expect(
      timeline([
        doc('PASSPORT', { date_of_birth: '1999-01-01', expiration_date: '2029-05-01' }),
        doc('I20', { program_end: '2027-01-01' }, { is_current: false }),
      ]),
    ).toHaveLength(1));
});
