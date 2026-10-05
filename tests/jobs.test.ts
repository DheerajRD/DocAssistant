import { describe, it, expect, vi } from 'vitest';
import { runJobs, runReminders } from '../src/lib/jobs';
import type { DB } from '../src/lib/supabase';
function deletionDB(
  kind: 'delete_document' | 'delete_account',
  path = 'owner-a/fictional',
  storageFails = false,
) {
  const calls: string[] = [];
  const job = {
    id: 'job',
    user_id: 'owner-a',
    document_id: 'doc',
    kind,
    payload: {},
    claim_token: 'claim',
  };
  const from = vi.fn((table: string) => {
    let operation = 'read';
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      like: vi.fn(() => chain),
      is: vi.fn(() => chain),
      delete: vi.fn(() => {
        operation = 'delete';
        calls.push(`delete:${table}`);
        return chain;
      }),
      update: vi.fn(() => {
        operation = 'update';
        return chain;
      }),
      maybeSingle: vi.fn(async () => ({
        error: null,
        data:
          table === 'profiles'
            ? { deleting_at: '2026-10-05' }
            : { storage_path: path, deleted_at: '2026-10-05' },
      })),
      then: (resolve: (result: unknown) => unknown) =>
        resolve({ error: null, data: [], operation }),
    };
    return chain;
  });
  const remove = vi.fn(async () => {
    calls.push('remove:storage');
    return { error: storageFails ? { message: 'simulated failure' } : null };
  });
  const list = vi
    .fn()
    .mockResolvedValueOnce({ data: [{ name: 'fictional' }], error: null })
    .mockResolvedValue({ data: [], error: null });
  const deleteUser = vi.fn(async () => {
    calls.push('delete:auth');
    return { error: null };
  });
  const db = {
    from,
    rpc: vi.fn(async () => ({ data: [job], error: null })),
    storage: { from: () => ({ remove, list }) },
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: { email: 'fictional@example.invalid' } },
          error: null,
        })),
        deleteUser,
      },
    },
  } as unknown as DB;
  return { db, calls, remove, deleteUser };
}
describe('permanent-deletion worker', () => {
  it('removes storage before deleting database document records', async () => {
    const { db, calls } = deletionDB('delete_document');
    expect((await runJobs(db)).done).toBe(1);
    expect(calls.indexOf('remove:storage')).toBeLessThan(calls.indexOf('delete:documents'));
  });
  it('does not delete the row when storage deletion fails', async () => {
    const { db, calls } = deletionDB('delete_document', 'owner-a/fictional', true);
    expect((await runJobs(db)).failed).toBe(1);
    expect(calls).not.toContain('delete:documents');
  });
  it('refuses to remove another user’s storage prefix', async () => {
    const { db, remove } = deletionDB('delete_document', 'owner-b/fictional');
    expect((await runJobs(db)).failed).toBe(1);
    expect(remove).not.toHaveBeenCalled();
  });
  it('removes all listed files and rate counters before removing the sign-in account', async () => {
    const { db, calls, deleteUser } = deletionDB('delete_account');
    expect((await runJobs(db)).done).toBe(1);
    expect(calls.indexOf('remove:storage')).toBeLessThan(calls.indexOf('delete:auth'));
    expect(calls.indexOf('delete:rate_limits')).toBeLessThan(calls.indexOf('delete:auth'));
    expect(deleteUser).toHaveBeenCalledWith('owner-a');
  });
  it('preserves due reminders when the messaging template is not configured', async () => {
    const before = process.env.TWILIO_REMINDER_CONTENT_SID;
    delete process.env.TWILIO_REMINDER_CONTENT_SID;
    try {
      const { db } = deletionDB('delete_document');
      expect(await runReminders(db)).toEqual({ submitted: 0, configured: false });
      expect(db.rpc).not.toHaveBeenCalled();
    } finally {
      if (before) process.env.TWILIO_REMINDER_CONTENT_SID = before;
    }
  });
});
