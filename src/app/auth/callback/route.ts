import { NextRequest,NextResponse } from 'next/server';
import { sessionClient } from '@/lib/supabase';
import { appUrl } from '@/lib/config';
export async function GET(req:NextRequest){
  const code=req.nextUrl.searchParams.get('code');
  if(code){const {error}=await (await sessionClient()).auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(`${appUrl()}/`);}
  return NextResponse.redirect(`${appUrl()}/?authError=Verification%20failed.%20Please%20request%20a%20new%20email.`);
}
