import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticated, handler, HttpError, jsonBody, limit, readBounded } from '@/lib/http';
import { adminClient, check } from '@/lib/supabase';
import { loadDocuments, publicDocument, audit } from '@/lib/data';
import { validateFile, validateFields, documentTypes } from '@/lib/documents';
import { syncReminders } from '@/lib/reminders';
export const runtime = 'nodejs';
export const GET = handler(async (req) => {
  const { user } = await authenticated(req);
  await limit(`documents:read:${user.id}`, 100);
  const db = adminClient();
  const id = req.nextUrl.searchParams.get('id');
  const docs = await loadDocuments(db, user.id);
  if (!id) return NextResponse.json({ documents: docs.map((d) => publicDocument(d)) });
  z.uuid().parse(id);
  const doc = docs.find((d) => d.id === id);
  if (!doc) throw new HttpError(404, 'Document not found');
  if (req.nextUrl.searchParams.get('download') === 'true') {
    const { data, error } = await db.storage
      .from('immigration-documents')
      .createSignedUrl(doc.storage_path, 60, {
        download: `${doc.document_type.toLowerCase()}.${doc.mime_type === 'application/pdf' ? 'pdf' : doc.mime_type === 'image/png' ? 'png' : 'jpg'}`,
      });
    check(error);
    await audit(db, user.id, 'document_download', id);
    return NextResponse.json({ url: data?.signedUrl });
  }
  // Full identifiers are available only after explicit authenticated web review action.
  await audit(db, user.id, 'document_fields_viewed', id);
  return NextResponse.json({ document: publicDocument(doc, true) });
});
export const POST = handler(async (req) => {
  const { user } = await authenticated(req, true);
  await limit(`upload:${user.id}`, 10, 3600);
  if (Number(req.headers.get('content-length') || 0) > 4.4 * 1024 * 1024)
    throw new HttpError(413, 'Upload limit is 4 MB');
  const db = adminClient();
  const { data: profile, error: pe } = await db
    .from('profiles')
    .select('deleting_at')
    .eq('user_id', user.id)
    .single();
  check(pe);
  if (profile?.deleting_at) throw new HttpError(409, 'Account deletion is in progress');
  const { count, error: ce } = await db
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('deleted_at', null);
  check(ce);
  if ((count || 0) >= 100) throw new HttpError(400, 'Prototype limit: 100 documents per account');
  const upload = await readBounded(req, Math.floor(4.4 * 1024 * 1024));
  const form = await new Request(req.url, {
    method: 'POST',
    headers: { 'content-type': req.headers.get('content-type') || '' },
    body: new Uint8Array(upload),
  }).formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a document');
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    validateFile(bytes, file.type, file.name);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const id = randomUUID();
  const path = `${user.id}/${id}`;
  const { error: uploadError } = await db.storage
    .from('immigration-documents')
    .upload(path, bytes, { contentType: file.type, upsert: false });
  check(uploadError);
  try {
    const { error } = await db.rpc('register_document', {
      p_user: user.id,
      p_id: id,
      p_path: path,
      p_mime: file.type,
      p_size: file.size,
    });
    check(error);
    await audit(db, user.id, 'document_uploaded', id);
  } catch (e) {
    await db.from('documents').delete().eq('user_id', user.id).eq('id', id);
    await db.storage.from('immigration-documents').remove([path]);
    throw e;
  }
  return NextResponse.json({ id, status: 'queued' }, { status: 202 });
});
const patch = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('review'),
    id: z.uuid(),
    document_type: z.enum(documentTypes),
    fields: z.record(z.string(), z.union([z.string().max(250), z.boolean(), z.null()])),
  }),
  z.object({ action: z.literal('current'), id: z.uuid() }),
  z.object({ action: z.literal('retry'), id: z.uuid() }),
  z.object({ action: z.literal('clear_extraction'), id: z.uuid() }),
]);
export const PATCH = handler(async (req) => {
  const { user } = await authenticated(req, true);
  await limit(`document:edit:${user.id}`, 30);
  const body = patch.parse(await jsonBody(req));
  const db = adminClient();
  const { data: doc, error } = await db
    .from('documents')
    .select('*')
    .eq('id', body.id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .single();
  if (error || !doc) throw new HttpError(404, 'Document not found');
  if (body.action === 'review') {
    if (!['needs_review', 'complete'].includes(doc.status))
      throw new HttpError(409, 'Wait for processing before reviewing');
    let fields;
    try {
      fields = validateFields(body.document_type, body.fields);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    if (body.document_type === 'VISA' && fields.visa_type !== 'F-1')
      throw new HttpError(400, 'This prototype supports F-1 visas only');
    if (body.document_type === 'I94' && fields.class_of_admission !== 'F-1')
      throw new HttpError(400, 'This prototype supports F-1 admission records only');
    const confidence = Object.fromEntries(Object.keys(fields).map((k) => [k, 1]));
    const { error: e } = await db.rpc('save_document_fields', {
      p_user: user.id,
      p_document: body.id,
      p_type: body.document_type,
      p_fields: fields,
      p_confidence: confidence,
      p_raw: {},
      p_review: true,
    });
    check(e);
  } else if (body.action === 'current') {
    const { error: e } = await db.rpc('select_current', { p_user: user.id, p_document: body.id });
    check(e);
  } else if (body.action === 'retry') {
    if (doc.status !== 'failed') throw new HttpError(409, 'Only failed documents can be retried');
    const { error: e } = await db
      .from('jobs')
      .update({ state: 'pending', attempts: 0 })
      .eq('user_id', user.id)
      .eq('document_id', body.id)
      .eq('kind', 'extract')
      .in('state', ['failed', 'done']);
    check(e);
    const { error: d } = await db
      .from('documents')
      .update({ status: 'queued' })
      .eq('id', body.id)
      .eq('user_id', user.id);
    check(d);
  } else {
    if (!['needs_review', 'complete', 'failed'].includes(doc.status))
      throw new HttpError(409, 'Wait for processing before clearing extracted data');
    const { error: e } = await db.rpc('save_document_fields', {
      p_user: user.id,
      p_document: body.id,
      p_type: 'UNKNOWN',
      p_fields: {},
      p_confidence: {},
      p_raw: {},
      p_review: false,
    });
    check(e);
  }
  await syncReminders(db, user.id, await loadDocuments(db, user.id));
  await audit(db, user.id, `document_${body.action}`, body.id);
  return NextResponse.json({ ok: true });
});
export const DELETE = handler(async (req) => {
  const { user } = await authenticated(req, true);
  await limit(`document:delete:${user.id}`, 20);
  const { id } = z.object({ id: z.uuid() }).parse(await jsonBody(req));
  const db = adminClient();
  const { error } = await db.rpc('queue_document_deletion', { p_user: user.id, p_document: id });
  check(error);
  return NextResponse.json(
    {
      message:
        'Deletion queued. This document is hidden immediately; storage and extracted fields will be permanently removed by the worker.',
    },
    { status: 202 },
  );
});
