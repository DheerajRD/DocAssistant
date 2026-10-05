import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
const a = '20000000-0000-4000-8000-000000000001',
  b = '20000000-0000-4000-8000-000000000002';
const d1 = '10000000-0000-4000-8000-000000000001',
  d2 = '10000000-0000-4000-8000-000000000002';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 alter default privileges in schema public grant all on tables to service_role;
 alter default privileges in schema public grant all on sequences to service_role;
 `);
  for (const file of (await readdir('supabase/migrations')).sort()) {
    // PGlite has built-in gen_random_uuid; pgcrypto installation is unnecessary in this test host.
    const sql = (await readFile(`supabase/migrations/${file}`, 'utf8')).replace(
      'create extension if not exists pgcrypto;',
      '',
    );
    await db.exec(sql);
  }
  await db.query('insert into auth.users(id,email)values($1,$2),($3,$4)', [
    a,
    'a@example.invalid',
    b,
    'b@example.invalid',
  ]);
  await db.query(
    `insert into documents(id,user_id,storage_path,mime_type,byte_size)values($1,$2,$3,'application/pdf',10),($4,$5,$6,'application/pdf',10)`,
    [d1, a, `${a}/${d1}`, d2, b, `${b}/${d2}`],
  );
  await db.query(`select save_document_fields($1,$2,'I20',$3,'{}','{}',true)`, [
    a,
    d1,
    JSON.stringify({
      school: 'Fictional A University',
      issue_date: '2026-09-22',
      program_end: '2029-05-15',
      cpt_authorized: true,
      employment_end: '2026-12-15',
    }),
  ]);
  await db.query(`select save_document_fields($1,$2,'I20',$3,'{}','{}',true)`, [
    b,
    d2,
    JSON.stringify({
      school: 'Fictional B Secret University',
      issue_date: '2026-10-01',
      program_end: '2029-06-15',
    }),
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function asUser<T>(user: string, fn: () => Promise<T>) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
describe('PostgreSQL ownership and write authorization', () => {
  it('User A cannot read User B documents or extracted fields', async () => {
    await asUser(a, async () => {
      const docs = await db.query<{ id: string }>('select id from documents');
      expect(docs.rows.map((r) => r.id)).toEqual([d1]);
      const fields = await db.query<{ school: string }>('select school from i20_records');
      expect(fields.rows.map((r) => r.school)).toEqual(['Fictional A University']);
      expect((await db.query('select * from documents where id=$1', [d2])).rows).toEqual([]);
    });
  });
  it('User B cannot read User A documents', async () =>
    await asUser(b, async () =>
      expect(
        (await db.query<{ id: string }>('select id from documents')).rows.map((r) => r.id),
      ).toEqual([d2]),
    ));
  it('anonymous users cannot read documents', async () => {
    await db.exec('set role anon');
    try {
      await expect(db.query('select * from documents')).rejects.toThrow();
    } finally {
      await db.exec('reset role');
    }
  });
  it('authenticated users cannot forge edits, phone verification, or service RPCs', async () =>
    await asUser(a, async () => {
      await expect(db.query('update documents set is_current=false')).rejects.toThrow();
      await expect(db.query('select select_current($1,$2)', [a, d2])).rejects.toThrow();
      await expect(
        db.query(
          "insert into whatsapp_accounts(user_id,phone,verified_at,consent_at)values($1,'+15555550101',now(),now())",
          [a],
        ),
      ).rejects.toThrow();
    }));
  it('composite FK prevents cross-user typed rows', async () =>
    await expect(
      db.query('insert into passports(document_id,user_id)values($1,$2)', [d2, a]),
    ).rejects.toThrow());
  it('service mutation requires matching owner', async () =>
    await expect(
      db.query("select save_document_fields($1,$2,'I20','{}','{}','{}',true)", [a, d2]),
    ).rejects.toThrow());
  it('original-document bucket is private', async () =>
    expect(
      (await db.query<{ public: boolean }>('select public from storage.buckets')).rows[0].public,
    ).toBe(false));
});
describe('atomic versioning and reminders', () => {
  it('older uploaded I-20 does not replace latest; manual choice survives new upload', async () => {
    const old = '10000000-0000-4000-8000-000000000003';
    const newest = '10000000-0000-4000-8000-000000000004';
    await db.query(
      "insert into documents(id,user_id,storage_path,mime_type,byte_size)values($1,$2,$3,'application/pdf',10),($4,$2,$5,'application/pdf',10)",
      [old, a, `${a}/${old}`, newest, `${a}/${newest}`],
    );
    await db.query("select save_document_fields($1,$2,'I20',$3,'{}','{}',true)", [
      a,
      old,
      JSON.stringify({ issue_date: '2025-01-14' }),
    ]);
    expect(
      (
        await db.query<{ id: string }>('select id from documents where user_id=$1 and is_current', [
          a,
        ])
      ).rows[0].id,
    ).toBe(d1);
    await db.query('select select_current($1,$2)', [a, old]);
    await db.query("select save_document_fields($1,$2,'I20',$3,'{}','{}',true)", [
      a,
      newest,
      JSON.stringify({ issue_date: '2026-10-05' }),
    ]);
    expect(
      (
        await db.query<{ id: string }>('select id from documents where user_id=$1 and is_current', [
          a,
        ])
      ).rows[0].id,
    ).toBe(old);
    await db.query('select select_current($1,$2)', [a, d1]);
  });
  it('replanning the same reminder does not duplicate or reset submitted state', async () => {
    const plan = JSON.stringify([
      {
        document_id: d1,
        field_name: 'employment_end',
        label: 'CPT authorization',
        deadline: '2026-12-15',
        offset_days: 30,
        scheduled_date: '2026-11-15',
      },
    ]);
    await db.query('select sync_reminder_plan($1,$2)', [a, plan]);
    await db.query('select sync_reminder_plan($1,$2)', [a, plan]);
    expect((await db.query('select * from reminders where user_id=$1', [a])).rows).toHaveLength(1);
    await db.query("update reminders set state='submitted' where user_id=$1", [a]);
    await db.query('select sync_reminder_plan($1,$2)', [a, plan]);
    expect(
      (await db.query<{ state: string }>('select state from reminders where user_id=$1', [a]))
        .rows[0].state,
    ).toBe('submitted');
  });
  it('rate limits are enforced by the database', async () => {
    const call = () =>
      db.query<{ consume_rate_limit: boolean }>("select consume_rate_limit('test-key',1,60)");
    expect((await call()).rows[0].consume_rate_limit).toBe(true);
    expect((await call()).rows[0].consume_rate_limit).toBe(false);
  });
});
describe('WhatsApp identity and nonce verification', () => {
  it('requires matching phone, expires and consumes challenge once', async () => {
    await db.query(
      "insert into whatsapp_link_challenges(user_id,phone,token_hash,expires_at,consent_at)values($1,'+15555550101','fictional-hash',now()+interval '10 minutes',now())",
      [a],
    );
    expect(
      (
        await db.query<{ verify_whatsapp: string | null }>(
          "select verify_whatsapp('fictional-hash','+15555550222')",
        )
      ).rows[0].verify_whatsapp,
    ).toBeNull();
    expect(
      (
        await db.query<{ verify_whatsapp: string | null }>(
          "select verify_whatsapp('fictional-hash','+15555550101')",
        )
      ).rows[0].verify_whatsapp,
    ).toBe(a);
    expect(
      (
        await db.query<{ verify_whatsapp: string | null }>(
          "select verify_whatsapp('fictional-hash','+15555550101')",
        )
      ).rows[0].verify_whatsapp,
    ).toBeNull();
  });
  it('one verified phone cannot be assigned to a second user', async () => {
    await db.query(
      "insert into whatsapp_link_challenges(user_id,phone,token_hash,expires_at,consent_at)values($1,'+15555550101','b-hash',now()+interval '10 minutes',now())",
      [b],
    );
    expect(
      (
        await db.query<{ verify_whatsapp: string | null }>(
          "select verify_whatsapp('b-hash','+15555550101')",
        )
      ).rows[0].verify_whatsapp,
    ).toBeNull();
  });
  it('does not verify an expired challenge', async () => {
    await db.query(
      "update whatsapp_link_challenges set expires_at=now()-interval '1 minute' where user_id=$1",
      [b],
    );
    expect(
      (
        await db.query<{ verify_whatsapp: string | null }>(
          "select verify_whatsapp('b-hash','+15555550101')",
        )
      ).rows[0].verify_whatsapp,
    ).toBeNull();
  });
});
describe('atomic inbox and extraction cleanup', () => {
  it('cannot enqueue document registration during account deletion', async () => {
    await db.query('update profiles set deleting_at=now() where user_id=$1', [b]);
    await expect(
      db.query("select register_document($1,$2,$3,'application/pdf',10)", [
        b,
        '10000000-0000-4000-8000-000000000009',
        `${b}/10000000-0000-4000-8000-000000000009`,
      ]),
    ).rejects.toThrow();
    await db.query('update profiles set deleting_at=null where user_id=$1', [b]);
  });
  it('atomically deduplicates signed inbound message jobs and refuses unverified mapping', async () => {
    expect(
      (
        await db.query<{ queue_whatsapp_question: boolean }>(
          "select queue_whatsapp_question($1,'+15555550101','SMexample','My documents')",
          [a],
        )
      ).rows[0].queue_whatsapp_question,
    ).toBe(true);
    expect(
      (
        await db.query<{ queue_whatsapp_question: boolean }>(
          "select queue_whatsapp_question($1,'+15555550101','SMexample','My documents')",
          [a],
        )
      ).rows[0].queue_whatsapp_question,
    ).toBe(false);
    expect(
      (
        await db.query<{ queue_whatsapp_question: boolean }>(
          "select queue_whatsapp_question($1,'+15555550101','SMwrong-owner','My documents')",
          [b],
        )
      ).rows[0].queue_whatsapp_question,
    ).toBe(false);
    expect(
      (await db.query("select * from jobs where dedupe_key='whatsapp:SMexample'")).rows,
    ).toHaveLength(1);
  });
  it('clears typed/raw fields and derived reminder history while preserving the original', async () => {
    const id = '10000000-0000-4000-8000-000000000008';
    await db.query(
      "insert into documents(id,user_id,storage_path,mime_type,byte_size)values($1,$2,$3,'application/pdf',10)",
      [id, a, `${a}/${id}`],
    );
    await db.query("select save_document_fields($1,$2,'EAD',$3,'{}','{}',false)", [
      a,
      id,
      JSON.stringify({ issue_date: '2026-01-01', expiration_date: '2027-01-01' }),
    ]);
    await db.query(
      "insert into reminders(user_id,document_id,field_name,label,deadline,offset_days,scheduled_date)values($1,$2,'expiration_date','EAD','2027-01-01',7,'2026-12-25')",
      [a, id],
    );
    await db.query('select clear_document_extraction($1,$2)', [a, id]);
    for (const table of ['ead_records', 'document_extractions', 'reminders'])
      expect((await db.query(`select * from ${table} where document_id=$1`, [id])).rows).toEqual(
        [],
      );
    expect((await db.query('select * from documents where id=$1', [id])).rows).toHaveLength(1);
  });
});

describe('deletion protection and cascades', () => {
  it('cannot request deletion of another user’s document', async () =>
    await expect(db.query('select queue_document_deletion($1,$2)', [a, d2])).rejects.toThrow());
  it('hides a deleted document, cancels pending work and queues permanent storage deletion', async () => {
    await db.query('select queue_document_deletion($1,$2)', [a, d1]);
    expect(
      (
        await db.query<{ is_current: boolean; deleted_at: string }>(
          'select is_current,deleted_at from documents where id=$1',
          [d1],
        )
      ).rows[0],
    ).toMatchObject({ is_current: false });
    expect(
      (await db.query("select * from jobs where kind='delete_document' and document_id=$1", [d1]))
        .rows,
    ).toHaveLength(1);
    await expect(
      db.query("select save_document_fields($1,$2,'I20','{}','{}','{}',true)", [a, d1]),
    ).rejects.toThrow();
  });
  it('account deletion immediately removes WhatsApp access and permanently cascades user data', async () => {
    await db.query('select queue_account_deletion($1)', [a]);
    expect((await db.query('select * from whatsapp_accounts where user_id=$1', [a])).rows).toEqual(
      [],
    );
    await db.query('delete from auth.users where id=$1', [a]);
    for (const table of [
      'profiles',
      'documents',
      'i20_records',
      'reminders',
      'jobs',
      'audit_logs',
      'user_preferences',
      'whatsapp_link_challenges',
    ])
      expect((await db.query(`select * from ${table} where user_id=$1`, [a])).rows).toEqual([]);
    expect((await db.query('select * from documents where user_id=$1', [b])).rows).toHaveLength(1);
  });
});
