import {
  DocRecord,
  DocumentType,
  labels,
  inventory,
  deadlines,
  daysUntil,
  timeline,
} from '@/lib/documents';
import { travelDisclaimer } from '@/lib/config';
export function Badge({ status }: { status: string }) {
  const tone = /expired|failed/i.test(status)
    ? 'bad'
    : /review|soon|select/i.test(status)
      ? 'warning'
      : /missing|older|not uploaded/i.test(status)
        ? 'neutral'
        : '';
  return <span className={`tag ${tone}`}>{status}</span>;
}
export function dateStatus(doc: DocRecord | null, field?: string): string {
  if (!doc) return 'Missing';
  if (!doc.reviewed_at) return 'Needs Review';
  const date = field
    ? String(doc.fields[field] ?? '') || null
    : (deadlines([doc]).find((d) => d.field !== 'employment_end')?.date ??
      deadlines([doc])[0]?.date);
  if (!date) return doc.fields.admit_until === 'D/S' ? 'D/S recorded' : 'Current';
  const days = daysUntil(date);
  return days < 0 ? 'Expired' : days <= 90 ? 'Expiring Soon' : 'Valid';
}
export function Dashboard({ docs, onUpload }: { docs: DocRecord[]; onUpload: () => void }) {
  const inv = inventory(docs);
  const dates = deadlines(docs);
  const next = dates.find((d) => daysUntil(d.date) >= 0);
  const attention =
    docs.filter((d) => !d.reviewed_at || d.status === 'failed').length +
    dates.filter((d) => daysUntil(d.date) < 90).length;
  return (
    <>
      <div className="grid">
        <div className="card">
          <p className="muted small">Next recorded deadline</p>
          <div className="metric">{next?.date || 'No date yet'}</div>
          <p className="muted small">
            {next?.label || 'Upload and review documents to get started.'}
          </p>
        </div>
        <div className="card">
          <p className="muted small">Needs your attention</p>
          <div className="metric">{attention}</div>
          <p className="muted small">Unreviewed documents and approaching or passed dates.</p>
        </div>
        <div className="card">
          <p className="muted small">Documents stored</p>
          <div className="metric">{docs.length}</div>
          <p className="muted small">Older versions are kept until you delete them.</p>
        </div>
      </div>
      <div className="row between section-space">
        <h2>Your document overview</h2>
        <button className="primary" onClick={onUpload}>
          ＋ Upload a document
        </button>
      </div>
      <div className="grid">
        {inv.map((item) => {
          const cpt =
            item.type === 'CPT'
              ? docs.find(
                  (d) =>
                    d.is_current && d.document_type === 'I20' && d.fields.cpt_authorized === true,
                )
              : null;
          const doc = item.current ?? cpt ?? null;
          const date = doc
            ? deadlines([doc]).find((d) =>
                item.type === 'CPT' ? d.field === 'employment_end' : true,
              )
            : null;
          return (
            <div className="card" key={item.type}>
              <Badge status={dateStatus(doc, item.type === 'CPT' ? 'employment_end' : undefined)} />
              <h3 className="doc-title">{item.label}</h3>
              <p className="doc-date">
                {date
                  ? `${date.field === 'program_end' ? 'Program ends' : date.field === 'employment_end' ? 'Ends' : 'Recorded expiry'} ${date.date}`
                  : doc?.fields.admit_until === 'D/S'
                    ? 'Admit Until: D/S'
                    : item.present
                      ? 'Select a current version'
                      : 'Not uploaded'}
              </p>
              <p className="muted small">
                {doc
                  ? `${doc.issue_date ? `Issued ${doc.issue_date}` : 'Issue date not recorded'} · ${doc.current_source === 'manual' ? 'Selected by you' : 'Appears latest by issue date'}`
                  : item.optional
                    ? 'Only upload if applicable to your situation.'
                    : 'Add this document to your account.'}
              </p>
            </div>
          );
        })}
      </div>
      <section className="card section-space">
        <h2>Recently uploaded</h2>
        {docs.length ? (
          docs.slice(0, 4).map((d) => (
            <div className="list-item row between" key={d.id}>
              <span>
                {d.document_type === 'UNKNOWN' ? 'Document' : labels[d.document_type]} ·{' '}
                {new Date(d.created_at).toLocaleDateString()}
              </span>
              <Badge status={d.status.replaceAll('_', ' ')} />
            </div>
          ))
        ) : (
          <div className="empty">Your first upload starts your document timeline.</div>
        )}
      </section>
      <p className="muted small section-space">
        Status labels describe recorded document dates. They do not determine immigration status,
        travel permission or work eligibility.
      </p>
    </>
  );
}
export function Timeline({ docs }: { docs: DocRecord[] }) {
  const events = timeline(docs);
  return (
    <section className="card">
      <h2>Your document timeline</h2>
      <p className="muted">Dates from documents marked current. Birth dates are excluded.</p>
      {events.length ? (
        <div className="timeline">
          {events.map((e) => (
            <div className="event" key={e.id}>
              <strong>{e.date}</strong>
              <p>
                {e.label} {!e.reviewed && <Badge status="Needs Review" />}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          Upload documents and select current versions to see recorded dates.
        </div>
      )}
    </section>
  );
}
export function Travel({ docs }: { docs: DocRecord[] }) {
  const [p, v, i, a] = (['PASSPORT', 'VISA', 'I20', 'I94'] as DocumentType[]).map(
    (type) => docs.find((d) => d.document_type === type && d.is_current) || null,
  );
  const items = [
    { label: 'Passport', doc: p },
    { label: 'F-1 visa', doc: v },
    { label: 'Current I-20', doc: i },
    { label: 'I-94', doc: a },
  ];
  return (
    <section className="card">
      <p className="eyebrow">Document presence and dates only</p>
      <h2>Travel Readiness</h2>
      <p className="muted">Check the documents stored in your account.</p>
      {items.map((item) => (
        <div className="checklist" key={item.label}>
          <span>{item.label}</span>
          <Badge
            status={
              item.doc
                ? `Found · ${dateStatus(item.doc)}`
                : docs.some(
                      (d) =>
                        d.document_type ===
                        (
                          {
                            Passport: 'PASSPORT',
                            'F-1 visa': 'VISA',
                            'Current I-20': 'I20',
                            'I-94': 'I94',
                          } as Record<string, string>
                        )[item.label],
                    )
                  ? 'Select current version'
                  : 'Not uploaded'
            }
          />
        </div>
      ))}
      <div className="checklist">
        <span>
          Travel signature{' '}
          {i?.fields.travel_signature_date && (
            <span className="muted small">· Recorded {i.fields.travel_signature_date}</span>
          )}
        </span>
        <Badge status="Needs Review" />
      </div>
      <div className="checklist">
        <span>Employment letter</span>
        <Badge status="Not tracked in this MVP" />
      </div>
      <p className="notice section-space">{travelDisclaimer}</p>
      <p className="muted small">
        CPT and EAD may be relevant depending on your situation. This tool does not infer which
        documents you need. Travel signature timing and legal interpretation require your DSO.
      </p>
    </section>
  );
}
