import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler,sameOrigin,jsonBody,limit,HttpError } from '@/lib/http';
import { sessionClient } from '@/lib/supabase';
import { appUrl } from '@/lib/config';
import { createHash } from 'node:crypto';
const schema=z.object({action:z.enum(['signup','signin','signout','resend']),email:z.email().optional(),password:z.string().min(12).max(128).optional()});
export const POST=handler(async req=>{
  sameOrigin(req);const body=schema.parse(await jsonBody(req));
  const key=createHash('sha256').update(body.email?.toLowerCase()||req.headers.get('x-forwarded-for')||'anonymous').digest('hex');
  await limit(`auth:${key}`,10,900);
  const client=await sessionClient();
  if(body.action==='signout'){await client.auth.signOut();return NextResponse.json({ok:true});}
  if(!body.email)throw new HttpError(400,'Email is required');
  if(body.action==='resend'){
    await client.auth.resend({type:'signup',email:body.email,options:{emailRedirectTo:`${appUrl()}/auth/callback`}});
    return NextResponse.json({message:'If the account needs verification, a new email has been requested.'});
  }
  if(!body.password)throw new HttpError(400,'Use a password of at least 12 characters');
  if(body.action==='signup'){
    const {error}=await client.auth.signUp({email:body.email,password:body.password,options:{emailRedirectTo:`${appUrl()}/auth/callback`}});
    if(error)throw new HttpError(400,'Unable to register. Check your email and password, or try signing in.');
    return NextResponse.json({message:'Check your email to verify your account before signing in.'});
  }
  const {error,data}=await client.auth.signInWithPassword({email:body.email,password:body.password});
  if(error || !data.user?.email_confirmed_at)throw new HttpError(401,'Sign-in failed. Check your credentials and verify your email.');
  return NextResponse.json({ok:true});
});
