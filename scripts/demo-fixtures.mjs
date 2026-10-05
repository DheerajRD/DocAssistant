import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
const samples = [
  [
    'passport',
    {
      document_type: 'Passport',
      full_name: 'Fictional Example Student',
      passport_number: 'EXAMPLE12345678',
      nationality: 'Exampleland',
      date_of_birth: '1999-01-15',
      issue_date: '2025-05-01',
      expiration_date: '2029-05-01',
    },
  ],
  [
    'f1-visa',
    {
      document_type: 'F-1 Visa',
      full_name: 'Fictional Example Student',
      visa_type: 'F-1',
      visa_number: 'EXAMPLE87654321',
      issue_date: '2024-08-01',
      expiration_date: '2026-08-01',
      issuing_location: 'Fictional Consulate',
    },
  ],
  [
    'i20-older',
    {
      document_type: 'Form I-20',
      full_name: 'Fictional Example Student',
      sevis_id: 'N0099999999',
      school: 'Fictional Example University',
      program: 'Computer Science',
      education_level: 'Masters',
      program_start: '2026-08-20',
      program_end: '2029-05-15',
      issue_date: '2025-08-18',
    },
  ],
  [
    'i20-current',
    {
      document_type: 'Form I-20',
      full_name: 'Fictional Example Student',
      sevis_id: 'N0099999999',
      school: 'Fictional Example University',
      program: 'Computer Science',
      education_level: 'Masters',
      program_start: '2026-08-20',
      program_end: '2029-05-15',
      issue_date: '2026-09-22',
      cpt_authorized: 'true',
      employer: 'Fictional Example Company',
      employment_start: '2026-09-01',
      employment_end: '2026-12-15',
    },
  ],
  [
    'i94',
    {
      document_type: 'I-94',
      full_name: 'Fictional Example Student',
      admission_number: 'EXAMPLE12345678901',
      class_of_admission: 'F-1',
      admit_until: 'D/S',
      entry_date: '2026-08-15',
    },
  ],
  [
    'ead',
    {
      document_type: 'Employment Authorization Document (EAD)',
      full_name: 'Fictional Example Student',
      category: 'C03B',
      card_number: 'EXAMPLE000123456',
      valid_from: '2027-06-01',
      expiration_date: '2028-05-31',
      issue_date: '2027-05-15',
    },
  ],
];
await mkdir('.demo', { recursive: true });
for (const [name, fields] of samples) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('FICTIONAL TEST DATA - NOT A GOVERNMENT DOCUMENT', {
    x: 36,
    y: 745,
    size: 15,
    font,
    color: rgb(0.7, 0.1, 0.1),
  });
  page.drawText('Software demonstration fixture. No real person or authorization.', {
    x: 36,
    y: 718,
    size: 11,
    font,
  });
  let y = 675;
  for (const [key, value] of Object.entries(fields)) {
    page.drawText(`${key}: ${value}`, { x: 36, y, size: 12, font });
    y -= 30;
  }
  await writeFile(`.demo/${name}.pdf`, await pdf.save());
}
console.log(
  'Created clearly fictional PDF fixtures in .demo/. Upload them using a development account.',
);
