# DocAssist

A functional F-1 student document assistant: private uploads → AI extraction → user review → date tracking → WhatsApp reminders and document questions.

**The product reports information recorded in uploaded documents. It does not provide legal advice, determine immigration eligibility or decide whether a person can travel, work, re-enter, change employers or change status.** Legal questions are directed to the student's DSO or a qualified immigration attorney. A document's expiration is not treated as the expiration of immigration status. I-94 `D/S` is never converted into a calendar deadline.

The repository contains real integrations, not an application mock mode. Without provider configuration, the application shows a setup screen or a clear error. Live email, OCR/AI, storage and WhatsApp acceptance must be tested with your own development accounts before a user demonstration.

## Implemented scope

- Email/password registration, email confirmation, sign-in and sign-out with Supabase Auth and HTTP-only session cookies.
- F-1 profile and calendar time zone, responsive dashboard and seven navigation views.
- PDF/JPEG/PNG uploads, drag/drop, real upload progress, 4 MB per-file limit, magic-byte checks and a private storage bucket.
- Durable queued processing using OpenAI PDF/vision input and a strict extraction schema. Supports scanned PDFs and images; no PDF text layer is required.
- Passport, F-1 visa, I-20, I-94, CPT information and EAD structured tables with editable fields and confidence values. Every extraction initially needs review.
- Multiple immutable upload versions, latest issue-date inference, manual current selection, tie/unknown-date handling and a current-document timeline.
- Configurable reminders at 180/90/60/30/14/7/1 days. Only reviewed current records create reminders.
- A provider interface and a complete Twilio WhatsApp adapter, signed inbound webhooks, one-time phone-ownership verification, consent, unlinking and STOP.
- Initial WhatsApp commands and web chat using the same user-scoped retrieval and safety logic.
- Travel Readiness showing presence and recorded dates, without a travel-permission verdict.
- Clear extracted data, permanently delete individual originals/extractions and queue complete account/data deletion with password confirmation.
- RLS, server authorization, composite ownership foreign keys, database-backed rate limits, CSRF origin checks, bounded request bodies, short-lived signed downloads and operational audit metadata.

Branding is configured by `NEXT_PUBLIC_PRODUCT_NAME`; the default is DocAssist.

## Architecture

Next.js 16 App Router + strict TypeScript + Tailwind CSS v4, Supabase PostgreSQL/Auth/Storage, OpenAI Responses API and Twilio WhatsApp. Supabase's authentication email service sends verification emails; configure Resend as its SMTP provider if desired. No separate email backend is necessary for this MVP.

The browser talks only to same-origin Next.js routes. The server validates the session with `auth.getUser()` and checks confirmed email. All service-role operations include the server-authenticated user ID; they never accept a client-supplied owner ID. RLS also protects direct database access. `server-only` boundaries prevent server clients from entering the browser bundle.

One `documents` row represents one uploaded version. `document_versions` is an ownership-protected view grouped logically by user and document type, so an unnecessary duplicate version table is avoided. Each supported type has a typed relational row linked by `(document_id, user_id)`. Raw extraction JSON is temporary debugging/evidence data and is removed on manual review or clearing.

Original files stay private. The authenticated download endpoint issues an attachment URL that expires after 60 seconds. Full identifiers can be viewed in the authenticated field editor; overview cards and messages mask or omit them.

AI handles two constrained tasks:

1. Transcribe visible PDF/image information, classify it and return structured fields with evidence/confidence. Values are validated server-side; invalid dates and duplicate fields are flagged. An upload is never treated as reviewed automatically.
2. Route natural-language questions into a bounded intent schema. Exact initial commands have a deterministic fast path. The server retrieves the owner's current records and composes factual answers with source document/date references. Document records and identifiers are not sent to the intent model. This design limits hallucinations and avoids an unnecessary vector database for six structured document types.

`jobs` is the durable processing inbox. A secret-authenticated worker claims jobs with `FOR UPDATE SKIP LOCKED`. The same endpoint dispatches due reminders. Webhook requests are validated and acknowledged quickly; replies are sent by the worker during the WhatsApp conversation window. Inbox enqueue and provider-message deduplication are atomic.

Reminder dates are calculated as calendar dates in the profile time zone. SQL claims only today's due reminders for current, reviewed documents with WhatsApp consent and preferences enabled. Unique reminder keys/history prevent repeated scheduling from creating duplicate sends. Ambiguous messaging failures are marked `uncertain` and are **not automatically resent**; avoiding accidental duplicate sends is preferable to claiming exactly-once delivery from an external provider.

## Folder structure

```text
src/app/                  App shell, styles, email callback and API routes
src/components/           Auth, dashboard, documents, chat and settings UI
src/lib/                  Domain rules, scoped data access, AI, reminders and providers
src/proxy.ts              Supabase session refresh
supabase/migrations/      Ordered PostgreSQL/RLS/storage/function migrations
scripts/worker.mjs        Local or externally hosted worker tick loop
scripts/demo-fixtures.mjs Optional clearly fictional PDF generator
tests/                    Unit and PostgreSQL integration tests
tests/browser/            Desktop/mobile UI checks with isolated service fixtures
.github/workflows/ci.yml  TypeScript, lint, tests, build and browser CI
```

## Prerequisites

- Node.js 24 and npm.
- A Supabase project, or Supabase CLI + Docker for the local Supabase stack.
- An OpenAI API account with billing and access to a model supporting image/PDF input and Structured Outputs.
- A Twilio WhatsApp sender or Sandbox; an approved utility content template for scheduled notifications.
- An HTTPS public app/webhook URL for WhatsApp, and a scheduler that invokes the worker frequently.

Never put real documents into this public repository, `.demo/`, issue comments or CI artifacts.

## Local setup

```bash
git clone https://github.com/DheerajRD/DocAssistant.git
cd DocAssistant
git checkout feature/docassist-mvp
npm ci
cp .env.example .env.local
```

Fill `.env.local` using the variables below, apply all migrations, and configure email verification. Then run:

```bash
npm run dev
```

In a separate terminal, run the worker:

```bash
node --env-file=.env.local scripts/worker.mjs
```

Open `http://localhost:3000`. Register, verify your email, sign in, save your name/time zone, connect WhatsApp and upload a fictional test document. Documents remain queued until a worker tick runs. Most single uploads complete on the next tick; processing can fail if the model cannot read a file or credentials are missing. Failed extractions can be retried from Documents.

## Supabase setup and migrations

1. Create a separate development Supabase project.
2. Copy the project URL, anon key and service-role key into `.env.local`. Only URL/anon are public; keep the service-role key server-only.
3. Run every file under `supabase/migrations/` in filename order using Supabase SQL Editor. Alternatively initialize/link the Supabase CLI locally and push the migrations:

   ```bash
   npx supabase init
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

4. The migration creates the **private** `immigration-documents` bucket. Do not make it public or add anonymous storage policies. The server is the only storage writer/reader.
5. In Authentication → Providers → Email, enable email confirmation and set the minimum password length to 12. Set the Auth Site URL to your app origin and allow `http://localhost:3000/auth/callback` plus your production callback URL. PKCE email confirmation should be completed in the same browser used for signup.
6. Configure authentication SMTP for real-user tests. Resend SMTP can be connected here using a verified sender/domain. Supabase's default test email service is not a general-purpose production mail service.
7. Use a fresh development account. The signup trigger creates profile/preferences records automatically. Do not pre-create users before applying migrations without also backfilling these records.

Tables: `profiles`, `user_preferences`, `documents`, `document_extractions`, `passports`, `visas`, `i20_records`, `i94_records`, `ead_records`, `cpt_authorizations`, `reminders`, `reminder_history`, `whatsapp_accounts`, `whatsapp_link_challenges`, `whatsapp_messages`, `ai_conversations`, `audit_logs`, `jobs`, `rate_limits`.

## Environment variables

| Variable                        | Purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `APP_URL`                       | Exact app origin; local HTTP is allowed, production must use HTTPS. Used for CSRF checks and auth redirects. |
| `NEXT_PUBLIC_PRODUCT_NAME`      | Optional replaceable brand name.                                                                             |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL.                                                                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anon key.                                                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Private server-only database/storage/admin key.                                                              |
| `OPENAI_API_KEY`                | Private OpenAI API key.                                                                                      |
| `OPENAI_MODEL`                  | Default `gpt-4.1-mini`; must support vision, PDF inputs and Structured Outputs.                              |
| `WHATSAPP_PROVIDER`             | `twilio`, the implemented adapter.                                                                           |
| `TWILIO_ACCOUNT_SID`            | Twilio account identifier.                                                                                   |
| `TWILIO_AUTH_TOKEN`             | Private API/signature-validation secret.                                                                     |
| `TWILIO_WHATSAPP_FROM`          | Sender including the `whatsapp:` prefix.                                                                     |
| `TWILIO_WEBHOOK_URL`            | Exact external HTTPS URL configured in Twilio, including any query string.                                   |
| `TWILIO_REMINDER_CONTENT_SID`   | Approved utility content-template SID.                                                                       |
| `CRON_SECRET`                   | Separate random secret, at least 32 characters.                                                              |
| `LINK_TOKEN_SECRET`             | Separate random secret, at least 32 characters, used for challenge hashing.                                  |

Generate each random secret separately with `openssl rand -hex 32`. Keep values in `.env.local` or deployment secrets. Never paste secret values into an issue or README. Public build variables require a rebuild if changed.

## OpenAI setup

Create a project API key and set budget/rate-limit alerts in your OpenAI account. Set `OPENAI_API_KEY` and `OPENAI_MODEL`. The server sends a file as an in-memory PDF or image input using Responses Structured Outputs; it does not create a permanent OpenAI Files API upload. Responses use `store: false`, which disables response persistence but is not a blanket promise of zero provider retention. Check the provider's data-control terms for your deployment.

OCR/classification/field extraction are combined in one vision-capable model call. UI processing states reflect input loading, model classification/transcription and structured-field persistence. They are not three independent OCR services. AI confidence scores are indicative, not calibrated accuracy guarantees. All fields require user review before reminders can use them.

## WhatsApp setup

1. Enable a Twilio WhatsApp sender. For a Sandbox, each tester must first join it using Twilio's join instructions. Enter the sender as `TWILIO_WHATSAPP_FROM=whatsapp:+...`.
2. Configure the inbound messaging webhook as **POST** to `https://YOUR_DOMAIN/api/whatsapp/webhook`. Set `TWILIO_WEBHOOK_URL` to that exact URL. During local development, use an HTTPS tunnel and point it at port 3000. Keep `APP_URL=http://localhost:3000` for browser actions; the webhook URL may be the tunnel origin.
3. Set account SID and auth token. Signature verification is always enabled, including in development. All form parameters are passed to Twilio's official validation helper.
4. In Settings, enter your number in E.164 format (`+` and country code), consent, and create the verification link. Open WhatsApp and send the prefilled `VERIFY` message from that number. The server verifies both the signed provider identity and matching nonce/phone, expires the challenge in ten minutes and consumes it once. An arbitrary profile phone number grants no access.
5. Refresh/check verification status, choose offsets and enable WhatsApp reminders.
6. Ask `My documents`, `What expires next?`, `When does my CPT end?`, `Which I-20 is my latest?`, `What documents am I missing?` or `Remind me`. The last command points to the preference controls; it does not silently opt a user into messaging.
7. Send `STOP` to disable reminders, or disconnect the number in Settings to remove WhatsApp access entirely.

Create an approved **utility** reminder template with these content variables:

```text
{{1}}: Your {{2}} has a recorded end/expiration date of {{3}},
{{4}} days away. Review your documents: {{5}}
This is a document-date reminder. Confirm immigration decisions with your DSO.
```

Variables are product name, document label, ISO deadline, days remaining and authenticated dashboard URL. Never include identification numbers. Store its approved Content SID in `TWILIO_REMINDER_CONTENT_SID`. Testers on the Sandbox must use a template supported by that Sandbox; custom approved templates typically require a registered sender. A live reminder acceptance test therefore needs a suitable sender/template, not merely the sandbox's default greeting template.

Free-form replies are sent only while a recent inbound message opens the conversation window. Scheduled reminders always use the approved template. `submitted` means accepted by Twilio, not confirmed delivered/read; delivery-status callbacks are a future improvement.

The `WhatsAppProvider` interface defines `sendMessage`, `sendTemplate`, `validateWebhook` and `receiveWebhook`. Only Twilio is implemented. A Meta adapter can implement this interface later; setting `WHATSAPP_PROVIDER=meta` currently fails explicitly.

## Worker scheduling and deployment

Import the repository into Vercel as a Next.js project, set production variables, run the Supabase migrations and configure production callback/webhook URLs. Use a dedicated domain with HTTPS. The included `vercel.json` invokes `/api/jobs` every minute and requires a plan supporting that frequency. Vercel sends `CRON_SECRET` as a bearer token.

**Vercel Hobby does not support the included per-minute cron schedule.** For Hobby, replace `vercel.json` with `{}` and use an external scheduler/worker that makes authenticated requests, or run `scripts/worker.mjs` in a separate always-on environment. Do not change to daily ticks for an interactive WhatsApp demo: replies/extraction would wait too long and may miss conversation windows. No personal ChatGPT automation is needed; this is an application worker.

Preview deployments do not receive production cron ticks automatically. A preview needs a separately configured test worker and its own `APP_URL`/webhook/redirect settings. Never point a public preview at production user data. Worker requests can run up to 300 seconds; use a hosting plan/runtime supporting this duration. Each tick claims at most three jobs and twenty reminders. Overlapping ticks claim different rows; this prototype is intended for modest traffic, not an unbounded queue.

Monitor failed/uncertain jobs and reminders in Supabase. Failed extractions are retried by the user. Failed account/document deletion jobs must be retried by resubmitting the deletion request; never report permanent deletion as complete until the worker has removed storage and database/auth records. For an uncertain message, inspect the provider log and message/history IDs before any manual retry.

## Optional fictional demo fixtures

```bash
npm run demo:fixtures
```

This generates clearly watermarked fictional PDFs in ignored `.demo/`. It does not create a user, insert fake dashboard data or bypass real extraction. Upload the PDFs through a development account and review them against the originals. The EAD example is fictional and does not establish work eligibility. Never use this fixture generator for real immigration papers.

To demonstrate a real reminder without waiting months: review a fictional document and set its expiration to exactly seven days after **today in your profile time zone**, mark it current, select the seven-day offset, enable WhatsApp reminders and run a worker tick. Repeat ticks should not submit the same reminder again. Do this only in the development account; do not alter real document dates for a demo.

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npx playwright install --with-deps chromium
npm run test:browser
```

Unit tests cover real date validation, structured extraction normalization, version inference, reminder offsets, masking, safe answers, retrieval scoping and Twilio webhook signatures. PostgreSQL integration tests run the actual SQL migrations under PGlite, a PostgreSQL test host, with minimal Auth/Storage schema stubs. They verify RLS/anonymous denial, blocked service functions, foreign keys, manual version selection, reminder idempotency, phone mapping, deletion protection and cascading data removal. They do not substitute for live Supabase Auth/Storage tests.

Browser tests build and serve the production application, then run desktop/mobile navigation, upload UI, review errors and chat rendering. They intercept external service responses **only inside the tests**. No fake backend or mock data mode exists in the deployed app. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point tests at a preinstalled Chromium when the default browser download is unavailable.

### Live acceptance checklist (requires configured providers)

1. Create two accounts A/B and confirm both email addresses. Requests without a verified session must be rejected.
2. Upload fictional PDFs/images with A. Check the storage bucket is private, the UI transitions out of queued, fields require review, and invalid/uncertain dates are not silently accepted.
3. Review fields, choose current versions and upload an older I-20 after a newer one. The older issue date must not replace current. Test manual override and tied/missing issue dates.
4. With B, attempt A's IDs in download, edit, current-selection and deletion requests. All must fail. B's web/WhatsApp questions must never contain A's records.
5. Try a malformed/spoofed file and a file above 4 MB. Try a download URL after its 60-second expiration.
6. Link A's WhatsApp number. A wrong phone, expired/reused code or forged webhook must not verify. An unverified number must receive no document facts.
7. Ask each initial command through web and WhatsApp. Legal action questions must defer to a DSO/attorney. Source dates and missing-information statements should match reviewed records; full sensitive numbers must never be sent.
8. Set a reviewed fictional date seven days out, enable its offset/consent, run the worker and confirm an actual template arrives. A second tick must not duplicate it. STOP must block future reminders.
9. Clear extracted information: preserve the original but remove typed/raw fields and all its derived reminders/history. Delete a document: it is hidden immediately, then permanently removed from storage/database after the worker.
10. Delete A's account with password confirmation, run the worker and confirm the storage prefix and all auth/profile/document/extraction/reminder/message/audit records are removed. B's account remains intact.

## Security and data handling

- HTTPS in deployment; private provider storage and database at-rest protection. This is not client-side end-to-end encryption.
- Every protected route validates the authenticated user and confirmed email. Mutation requests require the configured same origin. Service-role keys exist only in server modules.
- RLS is enabled on every application table. Browser roles have read-only owner policies and cannot forge document reviews, reminder claims or phone verification. Composite foreign keys prevent typed fields from being attached to another owner's document.
- File extension, MIME type, size and file signatures are checked; request streams are bounded before multipart/JSON parsing. Objects use UUID paths rather than personal filenames.
- Identifiers are omitted/masked from dashboard/message outputs. Full fields require an authenticated review action. Request bodies, document contents, full identifiers and provider error payloads are not logged.
- Audits record actions and IDs only; chats record intent/channel only. WhatsApp questions have obvious identifiers scrubbed, are temporarily queued and are erased after processing. Database backups and third-party provider retention are governed by their configured policies, not by a promise this app can erase their backups.
- Deletion hides records and disables account messaging immediately, then removes private objects before deleting database rows/auth users. Extracted fields/history cascade. A signed URL already issued may remain usable for up to its 60-second lifetime until the object is removed.
- Operational audit/chat/message metadata is purged after 30 days. Rate counters and expired phone challenges are cleaned by the worker. Reminder history lasts until document/account deletion to prevent duplicates.
- Built-in rate limits are useful for an MVP; add deployment WAF/abuse controls and evaluate multi-factor authentication for broader use. Rotate keys and separate development/production projects.

## Known limitations

- Provider credentials, Supabase migrations, SMTP, an approved WhatsApp template and a frequent worker are required. A checked production build is not a live-provider acceptance test.
- Only F-1 documents and structured date/presence questions are supported. No immigration-law knowledge base, broad legal Q&A, eligibility assessment or action advice.
- OCR/model extraction can be wrong, particularly on blurry, rotated or handwritten documents. Every extraction requires review; confidence is not proof. Missing/tied issue dates require manual current selection.
- Travel Readiness does not validate travel-signature sufficiency, employer letters, legal requirements or re-entry eligibility. Employment letters are not a typed MVP upload category.
- Notifications are best effort. Missed calendar dates are not automatically backfilled, and ambiguous sends are held rather than automatically resent. No delivery/read receipt UI yet.
- Version groups are one current document per supported type. Multiple concurrent CPT employers/multiple active EADs are not modeled; an I-20 currently has one CPT block. This must be expanded before serving cases requiring multiple authorizations.
- Prototype caps: 4 MB per file, 100 live documents per account, three jobs/twenty reminder sends per tick. No malware scanning, independent security audit or claimed compliance certification. Do not market the prototype as a legal or certified-compliance product.
- WhatsApp media ingestion is deliberately excluded. The provider retains its own messaging data under its policies.

## Future roadmap

Meta WhatsApp adapter, delivery callbacks and monitored retry/reconciliation tools; multiple CPT employers; optional supporting document categories; dedicated OCR/review evidence UI; MFA; malware scanning; more resilient scaled job infrastructure; explicit consent/provider-retention controls; WhatsApp attachment ingestion. Other immigration categories and delegated access are future work, not enabled MVP features.

## Primary implementation references

- [Supabase SSR authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [OpenAI PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [Twilio WhatsApp messaging](https://www.twilio.com/docs/whatsapp/api)
- [Vercel cron scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
