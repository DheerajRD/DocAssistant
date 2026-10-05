import { test, expect } from '@playwright/test';
const settings = {
  email: 'fictional@example.invalid',
  profile: { display_name: 'Fictional Student', timezone: 'America/Chicago', deleting_at: null },
  preferences: { reminder_offsets: [30, 7, 1], whatsapp_reminders: false },
  whatsapp: null,
  reminders: [],
  history: [],
};
const fixtureDoc = {
  id: '10000000-0000-4000-8000-000000000001',
  document_type: 'I20',
  status: 'needs_review',
  created_at: '2026-09-22T00:00:00Z',
  issue_date: '2026-09-22',
  is_current: true,
  current_source: 'auto',
  reviewed_at: null,
  fields: {
    school: 'Fictional University',
    program_end: '2029-05-15',
    cpt_authorized: true,
    employment_end: '2026-12-15',
  },
  confidence: { school: 0.95, program_end: 0.98 },
};
// External service responses are intercepted only in browser tests. Application ships no mock mode.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/settings', (route) => route.fulfill({ json: settings }));
  await page.route('**/api/documents', (route) =>
    route.fulfill({ json: { documents: [fixtureDoc] } }),
  );
});
test('dashboard, timeline and readiness render on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome, Fictional Student' })).toBeVisible();
  await expect(page.getByText('Program ends 2029-05-15')).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.getByText('I-20 · program end')).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Travel Readiness' }).click();
  await expect(
    page.getByText(/does not determine whether you are legally permitted/),
  ).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
});
test('upload accepts files and the field editor keeps failed corrections open', async ({
  page,
}) => {
  await page.route('**/api/documents?id=*', (route) =>
    route.fulfill({ json: { document: fixtureDoc } }),
  );
  await page.goto('/');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Documents', exact: true })
    .click();
  await page.route('**/api/documents', async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 202, json: { id: fixtureDoc.id, status: 'queued' } });
    else if (route.request().method() === 'PATCH')
      await route.fulfill({ status: 400, json: { error: 'Invalid date' } });
    else await route.fulfill({ json: { documents: [fixtureDoc] } });
  });
  await page.getByLabel('Choose documents to upload').setInputFiles({
    name: 'fictional-i20.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nFictional test only'),
  });
  await expect(page.getByRole('status')).toContainText('Uploaded.');
  await page.getByRole('button', { name: 'Review / correct fields' }).click();
  await expect(page.getByLabel('school')).toHaveValue('Fictional University');
  await page.getByRole('button', { name: 'Confirm reviewed information' }).click();
  await expect(page.getByRole('status')).toContainText('Invalid date');
  await expect(page.getByRole('heading', { name: 'Review extracted information' })).toBeVisible();
});
test('document chat renders the actual API answer', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      json: {
        answer:
          'Your current document records CPT ending on 2026-12-15. Source: I-20, issued 2026-09-22.',
        intent: 'CPT_END',
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Ask AI' }).click();
  await page.getByRole('button', { name: 'When does my CPT end?' }).click();
  await expect(page.getByText(/Your current document records CPT ending/)).toBeVisible();
});
