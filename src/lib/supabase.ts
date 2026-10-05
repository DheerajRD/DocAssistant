import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from './config';
export async function sessionClient() {
  const jar = await cookies();
  return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (all) => {
        for (const c of all)
          jar.set(c.name, c.value, {
            ...c.options,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          });
      },
    },
  });
}
// Only imported by server routes/jobs. Never return this key or client to the browser.
export function adminClient() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export type DB = ReturnType<typeof adminClient>;
export function check(error: { message: string } | null) {
  if (error) throw new Error('Database operation failed');
}
