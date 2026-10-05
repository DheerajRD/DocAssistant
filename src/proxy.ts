import { createServerClient } from '@supabase/ssr';
import { NextRequest,NextResponse } from 'next/server';
export async function proxy(req:NextRequest){
  let response=NextResponse.next({request:req});
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return response;
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
    cookies:{getAll:()=>req.cookies.getAll(),setAll:(all)=>{for(const c of all)req.cookies.set(c.name,c.value);response=NextResponse.next({request:req});for(const c of all)response.cookies.set(c.name,c.value,{...c.options,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'});}}
  });
  await client.auth.getUser();return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|api/whatsapp/webhook|api/jobs).*)']};
