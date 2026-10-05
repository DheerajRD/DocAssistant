import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated, handler, jsonBody, limit } from '@/lib/http';
import { adminClient } from '@/lib/supabase';
import { askAssistant } from '@/lib/assistant';
export const POST = handler(async (req) => {
  const { user } = await authenticated(req, true);
  await limit(`chat:${user.id}`, 20, 300);
  const { question } = z
    .object({ question: z.string().trim().min(1).max(1000) })
    .parse(await jsonBody(req));
  return NextResponse.json(await askAssistant(adminClient(), user.id, question, 'web'));
});
