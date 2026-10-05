import { beforeEach, describe, it, expect } from 'vitest';
import twilio from 'twilio';
import { TwilioWhatsApp, constantTimeMatch, linkHash } from '../src/lib/whatsapp';
beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = 'fictional-test-token';
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+15555550100';
  process.env.LINK_TOKEN_SECRET = 'fictional-test-secret-32-characters-long';
});
describe('signed WhatsApp webhooks', () => {
  const provider = new TwilioWhatsApp();
  const url = 'https://example.invalid/api/whatsapp/webhook';
  const params = {
    MessageSid: 'SMfictional',
    From: 'whatsapp:+15555550101',
    To: 'whatsapp:+15555550100',
    Body: 'My documents',
    NumMedia: '0',
    FutureParameter: 'included',
  };
  it('validates the exact external URL and ALL parameters', () => {
    const signature = twilio.getExpectedTwilioSignature('fictional-test-token', url, params);
    expect(provider.validateWebhook(signature, url, params)).toBe(true);
    expect(provider.validateWebhook(signature, 'https://attacker.invalid', params)).toBe(false);
    expect(provider.validateWebhook(signature, url, { ...params, Body: 'changed' })).toBe(false);
  });
  it('rejects unsigned messages', () =>
    expect(provider.validateWebhook('', url, params)).toBe(false));
  it('rejects non-WhatsApp and wrong sender configuration', () => {
    expect(provider.receiveWebhook({ ...params, From: '+15555550101' })).toBeNull();
    expect(provider.receiveWebhook({ ...params, To: 'whatsapp:+15555550999' })).toBeNull();
  });
  it('maps only provider phone identity', () =>
    expect(provider.receiveWebhook(params)?.phone).toBe('+15555550101'));
  it('hashes challenges without retaining the nonce', () => {
    expect(linkHash('test')).toHaveLength(64);
    expect(linkHash('test')).not.toContain('test');
  });
  it('compares worker secrets in constant time and fails closed', () => {
    expect(constantTimeMatch('a', 'b')).toBe(false);
    expect(constantTimeMatch('short', 'longer')).toBe(false);
    expect(constantTimeMatch('secret', 'secret')).toBe(true);
  });
});
