import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { appUrl } from './config';
import { adminClient, sessionClient, check } from './supabase';
export class HttpError extends Error { constructor(public status: number,message: string){super(message);} }
export function sameOrigin(req: NextRequest) {
  if (req.headers.get('origin')!==appUrl()) throw new HttpError(403,'Invalid request origin');
}
export async function authenticated(req: NextRequest, mutation=false) {
  if(mutation) sameOrigin(req);
  const client=await sessionClient();
  const {data:{user},error}=await client.auth.getUser();
  if(error || !user || !user.email_confirmed_at) throw new HttpError(401,'Sign in with a verified email to continue');
  return {user,client};
}
export async function limit(key: string,max=30,seconds=60) {
  const {data,error}=await adminClient().rpc('consume_rate_limit',{p_key:key,p_max:max,p_seconds:seconds});check(error);
  if(!data) throw new HttpError(429,'Too many requests. Please try again later.');
}
export async function jsonBody(req: NextRequest) {
  const text=await req.text();
  if(Buffer.byteLength(text)>32000) throw new HttpError(413,'Request too large');
  try{return JSON.parse(text);}catch{throw new HttpError(400,'Invalid JSON');}
}
export function handler(fn:(req:NextRequest)=>Promise<Response>) {
  return async(req:NextRequest)=>{
    try { const response=await fn(req);response.headers.set('Cache-Control','no-store');return response; }
    catch(error){
      const status=error instanceof HttpError?error.status:error instanceof z.ZodError?400:503;
      const message=error instanceof HttpError?error.message:error instanceof z.ZodError?'Please check the submitted fields.':'Service unavailable. Check server configuration or retry.';
      // No provider payloads, document text, identifiers or request bodies in logs.
      console.error('request_failed',{status,kind:error instanceof Error?error.constructor.name:'unknown'});
      return NextResponse.json({error:message},{status,headers:{'Cache-Control':'no-store'}});
    }
  };
}
