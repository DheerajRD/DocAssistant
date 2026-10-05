import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated, handler, jsonBody, limit, HttpError } from '@/lib/http';
import { adminClient, check } from '@/lib/supabase';
export const DELETE = handler(async (req) => {
  const { user, client } = await authenticated(req, true);
  await limit(`account:delete:${user.id}`, 3, 900);
  const { confirmation, password } = z
    .object({ confirmation: z.literal('DELETE'), password: z.string().min(1).max(128) })
    .parse(await jsonBody(req));
  const { error } = await client.auth.signInWithPassword({ email: user.email!, password });
  if (error) throw new HttpError(401, 'Confirm your password to delete your account');
  if (confirmation === 'DELETE')
    check((await adminClient().rpc('queue_account_deletion', { p_user: user.id })).error);
  await client.auth.signOut();
  return NextResponse.json(
    {
      message:
        'Account deletion requested. The worker permanently removes files and all account records. If deletion fails, sign in and submit the request again.',
    },
    { status: 202 },
  );
});
