'use client';
import { useState } from 'react';
import {
  DocRecord,
  documentTypes,
  fieldsByType,
  labels,
  Fields,
  DocumentType,
  dateFields,
} from '@/lib/documents';
import { api } from './api';
import { Badge } from './Overview';
export default function Documents({
  docs,
  refresh,
}: {
  docs: DocRecord[];
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<DocRecord | null>(null);
  const [type, setType] = useState<DocumentType>('I20');
  const [fields, setFields] = useState<Fields>({});
  async function upload(files: FileList | File[]) {
    setBusy(true);
    setMessage('');
    try {
      for (const file of Array.from(files)) {
        if (file.size > 4 * 1024 * 1024) throw new Error('Each document must be 4 MB or smaller.');
        setMessage(`Uploading ${file.name}`);
        setProgress(0);
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/documents');
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            try {
              const result = JSON.parse(xhr.responseText);
              if (xhr.status >= 200 && xhr.status < 300) resolve();
              else reject(new Error(result.error || 'Upload failed'));
            } catch {
              reject(new Error('Upload failed'));
            }
          };
          xhr.onerror = () => reject(new Error('Network error'));
          const form = new FormData();
          form.append('file', file);
          xhr.send(form);
        });
      }
      setMessage('Uploaded. Processing will run on the next background-worker tick.');
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(method: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ message?: string }>('/api/documents', method, body);
      setMessage(result.message || 'Saved.');
      await refresh();
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function edit(id: string) {
    setBusy(true);
    try {
      const result = await api<{ document: DocRecord }>(`/api/documents?id=${id}`);
      setEditing(result.document);
      setType(result.document.document_type === 'UNKNOWN' ? 'I20' : result.document.document_type);
      setFields(result.document.fields);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    try {
      const { url } = await api<{ url: string }>(`/api/documents?id=${id}&download=true`);
      window.location.assign(url);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <div className="stack">
      <section className="card">
        <h2>Upload your documents</h2>
        <p className="muted">PDF, JPG, JPEG or PNG · up to 4 MB per file · private storage</p>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) void upload(e.dataTransfer.files);
          }}
        >
          <strong>Drop documents here or choose files</strong>
          <p className="muted small">Passport, F-1 visa, I-20, I-94, CPT or EAD</p>
          <input
            aria-label="Choose documents to upload"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            disabled={busy}
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {busy && (
          <>
            <label htmlFor="upload-progress">Upload progress: {progress}%</label>
            <progress id="upload-progress" value={progress} max={100} />
          </>
        )}
        <p className="muted small section-space">
          Document pages are sent to the configured OpenAI API for extraction. Review every field
          before confirming. Uploaded text is treated as data, never as AI instructions.
        </p>
      </section>
      {message && (
        <div role="status" className="notice">
          {message}
        </div>
      )}
      {editing && (
        <section className="card editor">
          <div className="row between">
            <h2>Review extracted information</h2>
            <button onClick={() => setEditing(null)}>Close</button>
          </div>
          <p className="notice">
            Please verify this information against your original document. Full identifiers appear
            only here, inside your signed-in dashboard.
          </p>
          <label htmlFor="document-type">Document type</label>
          <select
            id="document-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as DocumentType);
              setFields({});
            }}
          >
            {documentTypes.map((t) => (
              <option key={t} value={t}>
                {labels[t]}
              </option>
            ))}
          </select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action('PATCH', {
                action: 'review',
                id: editing.id,
                document_type: type,
                fields,
              }).then((ok) => {
                if (ok) setEditing(null);
              });
            }}
          >
            <div className="field-grid">
              {fieldsByType[type].map((key) => (
                <div key={key}>
                  <label htmlFor={`field-${key}`}>
                    {key.replaceAll('_', ' ')}{' '}
                    {editing.confidence[key] !== undefined && (
                      <span className="muted small">
                        · AI {Math.round(editing.confidence[key] * 100)}%
                      </span>
                    )}
                  </label>
                  {key === 'cpt_authorized' ? (
                    <select
                      id={`field-${key}`}
                      value={fields[key] == null ? '' : String(fields[key])}
                      onChange={(e) =>
                        setFields({
                          ...fields,
                          [key]: e.target.value === '' ? null : e.target.value === 'true',
                        })
                      }
                    >
                      <option value="">Not recorded</option>
                      <option value="true">Explicitly recorded</option>
                      <option value="false">Not recorded as authorized</option>
                    </select>
                  ) : (
                    <input
                      id={`field-${key}`}
                      type={(dateFields as readonly string[]).includes(key) ? 'date' : 'text'}
                      maxLength={250}
                      value={String(fields[key] ?? '')}
                      placeholder={key === 'admit_until' ? 'D/S or YYYY-MM-DD' : ''}
                      onChange={(e) => setFields({ ...fields, [key]: e.target.value || null })}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="row section-space">
              <button className="primary" disabled={busy} type="submit">
                Confirm reviewed information
              </button>
              <button type="button" onClick={() => void download(editing.id)}>
                Download original
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="card">
        <h2>Documents and versions</h2>
        <p className="muted small">
          Issue dates suggest the latest version. You can override the selection. Older files are
          never deleted automatically.
        </p>
        {!docs.length && <div className="empty">No documents uploaded yet.</div>}
        {docs.map((d) => (
          <div className="list-item" key={d.id}>
            <div className="row between">
              <div>
                <strong>
                  {d.document_type === 'UNKNOWN'
                    ? 'Unclassified document'
                    : labels[d.document_type]}
                </strong>
                <p className="muted small">
                  {d.issue_date ? `Issued ${d.issue_date}` : 'Issue date not recorded'} · Uploaded{' '}
                  {new Date(d.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="row">
                <Badge status={d.status.replaceAll('_', ' ')} />
                {d.document_type !== 'UNKNOWN' && (
                  <Badge
                    status={
                      d.is_current
                        ? 'Current'
                        : docs.some((x) => x.document_type === d.document_type && x.is_current)
                          ? 'Older Version'
                          : 'Needs current selection'
                    }
                  />
                )}
              </div>
            </div>
            <div className="row">
              {['complete', 'needs_review'].includes(d.status) && (
                <button disabled={busy} onClick={() => void edit(d.id)}>
                  Review / correct fields
                </button>
              )}
              <button onClick={() => void download(d.id)}>Download</button>
              {d.document_type !== 'UNKNOWN' &&
                !d.is_current &&
                ['complete', 'needs_review'].includes(d.status) && (
                  <button
                    disabled={busy}
                    onClick={() => void action('PATCH', { action: 'current', id: d.id })}
                  >
                    Mark current
                  </button>
                )}
              {d.status === 'failed' && (
                <button
                  disabled={busy}
                  onClick={() => void action('PATCH', { action: 'retry', id: d.id })}
                >
                  Retry processing
                </button>
              )}
              {['needs_review', 'complete', 'failed'].includes(d.status) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm('Remove all extracted fields while keeping the original file?')
                    )
                      void action('PATCH', { action: 'clear_extraction', id: d.id });
                  }}
                >
                  Clear extracted data
                </button>
              )}
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Permanently delete this document and its extracted information?',
                    )
                  )
                    void action('DELETE', { id: d.id });
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
