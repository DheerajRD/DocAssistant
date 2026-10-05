import { DocRecord, DocumentType, Fields } from '../src/lib/documents';
export function doc(
  type: DocumentType = 'I20',
  fields: Fields = {},
  overrides: Partial<DocRecord> = {},
): DocRecord {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    user_id: '20000000-0000-4000-8000-000000000001',
    document_type: type,
    status: 'complete',
    created_at: '2026-09-22T00:00:00Z',
    issue_date: '2026-09-22',
    is_current: true,
    current_source: 'auto',
    reviewed_at: '2026-09-23T00:00:00Z',
    storage_path: 'fictional/path',
    mime_type: 'application/pdf',
    fields,
    confidence: Object.fromEntries(Object.keys(fields).map((k) => [k, 1])),
    ...overrides,
  };
}
