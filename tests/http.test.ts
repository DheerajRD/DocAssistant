import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const getUser = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/supabase', () => ({
  sessionClient: async () => ({ auth: { getUser } }),
  adminClient: vi.fn(),
  check: vi.fn(),
}));
import {
  authenticated,
  sameOrigin,
  readBounded,
  jsonBody,
  handler,
  HttpError,
} from '../src/lib/http';
beforeEach(() => {
  process.env.APP_URL = 'http://localhost:3000';
  getUser.mockReset();
});
describe('authentication and request boundaries', () => {
  it('rejects unauthenticated and unverified accounts', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(
      authenticated(new NextRequest('http://localhost:3000/api/documents')),
    ).rejects.toMatchObject({ status: 401 });
    getUser.mockResolvedValue({
      data: { user: { id: 'unverified', email_confirmed_at: null } },
      error: null,
    });
    await expect(
      authenticated(new NextRequest('http://localhost:3000/api/documents')),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('uses only server-verified identity even when the body/query specifies another user', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'owner-a', email_confirmed_at: '2026-10-05' } },
      error: null,
    });
    const req = new NextRequest('http://localhost:3000/api/documents?user_id=owner-b', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: JSON.stringify({ user_id: 'owner-b' }),
    });
    expect((await authenticated(req, true)).user.id).toBe('owner-a');
  });
  it('rejects cross-origin and origin-less mutations', () => {
    expect(() =>
      sameOrigin(
        new NextRequest('http://localhost:3000/api/documents', {
          headers: { origin: 'https://attacker.invalid' },
        }),
      ),
    ).toThrow();
    expect(() => sameOrigin(new NextRequest('http://localhost:3000/api/documents'))).toThrow();
  });
  it('caps streamed request bytes even without content-length', async () =>
    await expect(
      readBounded(
        new NextRequest('http://localhost:3000/api/documents', {
          method: 'POST',
          body: 'x'.repeat(100),
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 }));
  it('rejects invalid JSON', async () =>
    await expect(
      jsonBody(new NextRequest('http://localhost:3000/api/chat', { method: 'POST', body: '{' })),
    ).rejects.toMatchObject({ status: 400 }));
  it('does not return or log provider messages/document contents on failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handler(async () => {
      throw new Error('private passport X12345678');
    })(new NextRequest('http://localhost:3000/api/chat'));
    expect(await response.text()).not.toContain('X12345678');
    expect(JSON.stringify(log.mock.calls)).not.toContain('X12345678');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    log.mockRestore();
  });
  it('preserves safe status-specific errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handler(async () => {
      throw new HttpError(404, 'Document not found');
    })(new NextRequest('http://localhost:3000/api/documents'));
    expect(response.status).toBe(404);
    log.mockRestore();
  });
});
