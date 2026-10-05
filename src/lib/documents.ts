import { z } from 'zod';
export const offsets = [180, 90, 60, 30, 14, 7, 1] as const;
export const documentTypes = ['PASSPORT', 'VISA', 'I20', 'I94', 'CPT', 'EAD'] as const;
export type DocumentType = (typeof documentTypes)[number];
export const labels: Record<DocumentType, string> = {
  PASSPORT: 'Passport',
  VISA: 'F-1 visa',
  I20: 'I-20',
  I94: 'I-94',
  CPT: 'CPT authorization',
  EAD: 'EAD',
};
export const dateFields = [
  'date_of_birth',
  'issue_date',
  'expiration_date',
  'program_start',
  'program_end',
  'employment_start',
  'employment_end',
  'entry_date',
  'valid_from',
  'travel_signature_date',
] as const;
export const sensitiveFields = [
  'passport_number',
  'visa_number',
  'sevis_id',
  'admission_number',
  'card_number',
] as const;
export const fieldsByType: Record<DocumentType, readonly string[]> = {
  PASSPORT: [
    'full_name',
    'passport_number',
    'nationality',
    'date_of_birth',
    'issue_date',
    'expiration_date',
  ],
  VISA: [
    'full_name',
    'visa_type',
    'visa_number',
    'issue_date',
    'expiration_date',
    'issuing_location',
  ],
  I20: [
    'full_name',
    'sevis_id',
    'school',
    'program',
    'education_level',
    'program_start',
    'program_end',
    'issue_date',
    'travel_signature_date',
    'cpt_authorized',
    'employer',
    'employment_start',
    'employment_end',
  ],
  I94: ['full_name', 'admission_number', 'class_of_admission', 'admit_until', 'entry_date'],
  CPT: [
    'full_name',
    'issue_date',
    'employer',
    'employment_start',
    'employment_end',
    'cpt_authorized',
  ],
  EAD: ['full_name', 'category', 'card_number', 'valid_from', 'expiration_date', 'issue_date'],
};
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(d.valueOf()) &&
    d.toISOString().slice(0, 10) === value &&
    value >= '1900-01-01' &&
    value <= '2200-12-31'
  );
}
export const fieldSchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(300).nullable(),
});
export const extractionSchema = z.object({
  document_type: z.enum([...documentTypes, 'UNKNOWN']),
  type_confidence: z.number().min(0).max(1),
  fields: z.array(fieldSchema).max(30),
});
export type Extraction = z.infer<typeof extractionSchema>;
export type FieldValue = string | boolean | null;
export type Fields = Record<string, FieldValue>;
export function validateFields(type: DocumentType, input: Fields): Fields {
  const result: Fields = {};
  for (const key of fieldsByType[type]) {
    const value = input[key] ?? null;
    if (value === null || value === '') {
      result[key] = null;
      continue;
    }
    if (key === 'cpt_authorized') {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false')
        throw new Error('Invalid boolean field');
      result[key] = value === true || value === 'true';
      continue;
    }
    if (typeof value !== 'string' || value.length > 250) throw new Error('Invalid field');
    if ((dateFields as readonly string[]).includes(key) && !isDate(value))
      throw new Error('Invalid date');
    if (key === 'admit_until' && value !== 'D/S' && !isDate(value))
      throw new Error('Use D/S or an ISO date');
    result[key] = value.trim();
  }
  for (const [start, end] of [
    ['program_start', 'program_end'],
    ['employment_start', 'employment_end'],
    ['valid_from', 'expiration_date'],
    ['issue_date', 'expiration_date'],
  ]) {
    if (result[start] && result[end] && String(result[start]) > String(result[end]))
      throw new Error('End date precedes start date');
  }
  return result;
}
export function parsedExtraction(raw: unknown): {
  extraction: Extraction;
  fields: Fields;
  confidence: Record<string, number>;
  invalid: string[];
} {
  const extraction = extractionSchema.parse(raw);
  const fields: Fields = {};
  const confidence: Record<string, number> = { document_type: extraction.type_confidence };
  const invalid: string[] = [];
  if (extraction.document_type === 'UNKNOWN') return { extraction, fields, confidence, invalid };
  for (const f of extraction.fields) {
    if (!fieldsByType[extraction.document_type].includes(f.key)) continue;
    if (f.key in fields) {
      invalid.push(f.key);
      fields[f.key] = null;
      confidence[f.key] = 0;
      continue;
    }
    fields[f.key] = f.value;
    confidence[f.key] = f.value && f.evidence ? f.confidence : 0;
    try {
      validateFields(extraction.document_type, { [f.key]: f.value });
    } catch {
      fields[f.key] = null;
      confidence[f.key] = 0;
      invalid.push(f.key);
    }
  }
  try {
    validateFields(extraction.document_type, fields);
  } catch {
    invalid.push('date_order');
  }
  return { extraction, fields, confidence, invalid };
}
export interface DocRecord {
  id: string;
  user_id: string;
  document_type: DocumentType | 'UNKNOWN';
  status: string;
  created_at: string;
  issue_date: string | null;
  is_current: boolean;
  current_source: string;
  reviewed_at: string | null;
  storage_path: string;
  mime_type: string;
  fields: Fields;
  confidence: Record<string, number>;
}
export function mask(value: FieldValue): FieldValue {
  return typeof value === 'string' ? `••••${value.slice(-4)}` : value;
}
export function maskedFields(fields: Fields): Fields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      (sensitiveFields as readonly string[]).includes(key) ? mask(value) : value,
    ]),
  );
}
export const missingMessage = "I don't see that information in the documents you've uploaded.";
export function daysUntil(date: string, today = new Date()): number {
  return Math.round(
    (new Date(`${date}T00:00:00Z`).valueOf() -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
      86400000,
  );
}
export type Deadline = {
  documentId: string;
  type: DocumentType;
  field: string;
  date: string;
  label: string;
  reviewed: boolean;
};
export function deadlines(docs: DocRecord[]): Deadline[] {
  const hasCpt = docs.some((d) => d.is_current && d.document_type === 'CPT');
  return docs
    .filter((d) => d.is_current && d.document_type !== 'UNKNOWN')
    .flatMap((d) => {
      const keys =
        d.document_type === 'I20'
          ? [
              'program_end',
              ...(d.fields.cpt_authorized === true && !hasCpt ? ['employment_end'] : []),
            ]
          : d.document_type === 'CPT'
            ? ['employment_end']
            : d.document_type === 'I94'
              ? ['admit_until']
              : ['expiration_date'];
      return keys.flatMap((field) => {
        const date = d.fields[field];
        return typeof date === 'string' && isDate(date)
          ? [
              {
                documentId: d.id,
                type: d.document_type as DocumentType,
                field,
                date,
                label:
                  field === 'employment_end'
                    ? 'CPT authorization'
                    : field === 'program_end'
                      ? 'I-20 program'
                      : labels[d.document_type as DocumentType],
                reviewed: !!d.reviewed_at,
              },
            ]
          : [];
      });
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function reminderDate(deadline: string, offset: number): string {
  const d = new Date(`${deadline}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}
export function latestVersion(
  docs: Pick<DocRecord, 'id' | 'issue_date' | 'created_at' | 'current_source' | 'is_current'>[],
): string | null {
  const pinned = docs.find((d) => d.is_current && d.current_source === 'manual');
  if (pinned) return pinned.id;
  const dated = docs.filter((d) => d.issue_date && isDate(d.issue_date));
  // No issue date or a tied issue date requires user selection; upload time is not proof of issuance.
  dated.sort((a, b) => b.issue_date!.localeCompare(a.issue_date!));
  if (!dated.length || dated[1]?.issue_date === dated[0].issue_date) return null;
  return dated[0].id;
}
export function timeline(docs: DocRecord[]) {
  return docs
    .filter((d) => d.is_current && d.document_type !== 'UNKNOWN')
    .flatMap((d) =>
      Object.entries(d.fields)
        .filter(
          ([k, v]) =>
            k !== 'date_of_birth' &&
            (dateFields as readonly string[]).includes(k) &&
            typeof v === 'string' &&
            isDate(v),
        )
        .map(([key, value]) => ({
          id: `${d.id}:${key}`,
          date: String(value),
          label: `${labels[d.document_type as DocumentType]} · ${key.replaceAll('_', ' ')}`,
          reviewed: !!d.reviewed_at,
        })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function inventory(docs: DocRecord[]) {
  return documentTypes.map((type) => ({
    type,
    label: labels[type],
    present: docs.some(
      (d) =>
        d.document_type === type ||
        (type === 'CPT' && d.document_type === 'I20' && d.fields.cpt_authorized === true),
    ),
    current:
      docs.find((d) => d.document_type === type && d.is_current) ??
      (type === 'CPT'
        ? docs.find(
            (d) => d.document_type === 'I20' && d.is_current && d.fields.cpt_authorized === true,
          )
        : null) ??
      null,
    optional: type === 'EAD' || type === 'CPT',
  }));
}
export function validateFile(bytes: Buffer, mime: string, name: string) {
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024)
    throw new Error('Files must be between 1 byte and 4 MB');
  const ext = name.split('.').pop()?.toLowerCase();
  const ok =
    (mime === 'application/pdf' && ext === 'pdf' && bytes.subarray(0, 5).toString() === '%PDF-') ||
    (mime === 'image/png' &&
      ext === 'png' &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' &&
      ['jpg', 'jpeg'].includes(ext || '') &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255);
  if (!ok) throw new Error('Upload a valid PDF, JPG, JPEG or PNG');
}
