import 'server-only';
import twilio from 'twilio';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './config';
export interface InboundMessage {
  id: string;
  phone: string;
  text: string;
  hasMedia: boolean;
}
export interface WhatsAppProvider {
  sendMessage(phone: string, text: string): Promise<string>;
  sendTemplate(phone: string, variables: Record<string, string>): Promise<string>;
  validateWebhook(signature: string, url: string, params: Record<string, string>): boolean;
  receiveWebhook(params: Record<string, string>): InboundMessage | null;
}
export class TwilioWhatsApp implements WhatsAppProvider {
  private client() {
    return twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'), {
      autoRetry: false,
      timeout: 15000,
    });
  }
  async sendMessage(phone: string, text: string) {
    const message = await this.client().messages.create({
      from: env('TWILIO_WHATSAPP_FROM'),
      to: `whatsapp:${phone}`,
      body: text,
    });
    return message.sid;
  }
  async sendTemplate(phone: string, variables: Record<string, string>) {
    const message = await this.client().messages.create({
      from: env('TWILIO_WHATSAPP_FROM'),
      to: `whatsapp:${phone}`,
      contentSid: env('TWILIO_REMINDER_CONTENT_SID'),
      contentVariables: JSON.stringify(variables),
    });
    return message.sid;
  }
  validateWebhook(signature: string, url: string, params: Record<string, string>) {
    return !!signature && twilio.validateRequest(env('TWILIO_AUTH_TOKEN'), signature, url, params);
  }
  receiveWebhook(params: Record<string, string>): InboundMessage | null {
    if (
      !params.From?.startsWith('whatsapp:') ||
      params.To !== env('TWILIO_WHATSAPP_FROM') ||
      !params.MessageSid
    )
      return null;
    const phone = params.From.slice(9);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null;
    return {
      id: params.MessageSid,
      phone,
      text: (params.Body || '').slice(0, 1000),
      hasMedia: Number(params.NumMedia || 0) > 0,
    };
  }
}
export function whatsappProvider(): WhatsAppProvider {
  if ((process.env.WHATSAPP_PROVIDER || 'twilio') !== 'twilio')
    throw new Error('Unsupported WhatsApp provider');
  return new TwilioWhatsApp();
}
export function linkHash(token: string) {
  const key = env('LINK_TOKEN_SECRET');
  if (key.length < 32) throw new Error('Link secret too short');
  return createHmac('sha256', key).update(token).digest('hex');
}
export function constantTimeMatch(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
