import { describe, it, expect, vi } from 'vitest';
import {
  answerFromRecords,
  privacyFilter,
  legalQuestion,
  classifyQuestion,
  askAssistant,
  Intent,
} from '../src/lib/assistant';
import { doc } from './fixtures';
import type { DB } from '../src/lib/supabase';
function intent(
  name: Intent['intent'],
  type: Intent['document_type'] = 'ALL',
  window: Intent['window'] = 'ALL',
): Intent {
  return { intent: name, document_type: type, window };
}
describe('document-grounded answers', () => {
  it.each([
    'Can I work after my CPT expires?',
    'Can I travel with an expired visa?',
    'Am I eligible for OPT?',
    'Can I change employers?',
  ])('defers legal question %s', async (q) => {
    expect(legalQuestion(q)).toBe(true);
    expect((await classifyQuestion(q)).intent).toBe('LEGAL');
    expect(answerFromRecords(intent('LEGAL'), [])).toContain('DSO');
  });
  it('answers exact commands without inventing data', async () => {
    expect((await classifyQuestion('Which I-20 is my latest?')).intent).toBe('LATEST_I20');
    expect(answerFromRecords(intent('CPT_END'), [])).toContain("I don't see");
  });
  it('CPT answer cites source and correct employment date', () =>
    expect(
      answerFromRecords(intent('CPT_END'), [
        doc('I20', {
          cpt_authorized: true,
          program_end: '2029-05-15',
          employment_end: '2026-12-15',
        }),
      ]),
    ).toContain('2026-12-15'));
  it('does not assume CPT authorization', () =>
    expect(
      answerFromRecords(intent('CPT_END'), [doc('I20', { employment_end: '2026-12-15' })]),
    ).toContain("I don't see"));
  it('marks unreviewed data', () =>
    expect(
      answerFromRecords(intent('SCHOOL'), [
        doc('I20', { school: 'Fictional University' }, { reviewed_at: null }),
      ]),
    ).toContain('verify'));
  it('does not expose identifiers in current I-20 response', () =>
    expect(
      answerFromRecords(intent('I20_INFO'), [
        doc('I20', { sevis_id: 'N0012345678', school: 'Fictional University' }),
      ]),
    ).not.toContain('N0012345678'));
  it('filters six-month dates with a calendar window', () => {
    const answer = answerFromRecords(
      intent('EXPIRY', 'ALL', 'SIX_MONTHS'),
      [
        doc('PASSPORT', { expiration_date: '2027-02-01' }),
        doc('EAD', { expiration_date: '2028-02-01' }),
      ],
      new Date('2026-10-05'),
    );
    expect(answer).toContain('2027-02-01');
    expect(answer).not.toContain('2028-02-01');
  });
  it('does not label optional EAD as legally required', () =>
    expect(answerFromRecords(intent('MISSING'), [])).toContain('if applicable'));
  it('privacy filter removes known numbers and patterns', () => {
    const d = doc('PASSPORT', { passport_number: 'X12345678' });
    expect(privacyFilter('X12345678 N0012345678 12345678901', [d])).toBe(
      'ending in 5678 [masked SEVIS ID] [masked identifier]',
    );
  });
});
describe('retrieval isolation', () => {
  it('uses the server user ID for every query, never a user-supplied ID', async () => {
    const owners: string[] = [];
    const a = doc('I20', { school: 'User A Fictional University' });
    const b = doc('I20', { school: 'User B Secret University' }, { user_id: 'user-b' });
    const from = vi.fn((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((key: string, value: string) => {
          if (key === 'user_id') owners.push(value);
          return chain;
        }),
        is: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data:
              table === 'documents'
                ? [a]
                : table === 'i20_records'
                  ? [{ document_id: a.id, user_id: a.user_id, ...a.fields }]
                  : [],
            error: null,
          }),
        insert: vi.fn(async () => ({ error: null })),
      };
      return chain;
    });
    const db = { from } as unknown as DB;
    const result = await askAssistant(db, a.user_id, 'My documents', 'web');
    expect(owners.length).toBeGreaterThan(5);
    expect(owners.every((id) => id === a.user_id)).toBe(true);
    expect(result.answer).not.toContain(String(b.fields.school));
  });
});
