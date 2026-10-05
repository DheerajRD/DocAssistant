'use client';
import { useState, useEffect, useCallback } from 'react';
import Auth from './Auth';
import { api, SettingsData } from './api';
import { DocRecord } from '@/lib/documents';
import { Dashboard, Timeline, Travel } from './Overview';
import Documents from './Documents';
import Chat from './Chat';
import Settings from './Settings';
const sections = [
  'Dashboard',
  'Documents',
  'Timeline',
  'Travel Readiness',
  'Ask AI',
  'Reminders',
  'Settings',
] as const;
type Section = (typeof sections)[number];
export default function Workspace({ name, configured }: { name: string; configured: boolean }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('Dashboard');
  const [error, setError] = useState('');
  const [signedOutMessage, setSignedOutMessage] = useState('');
  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const settings = await api<SettingsData>('/api/settings');
      setData(settings);
      if (!settings.profile.display_name) setSection('Settings');
      const documents = await api<{ documents: DocRecord[] }>('/api/documents');
      setDocs(documents.documents);
      setError('');
    } catch (e) {
      const message = (e as Error).message;
      if (message.startsWith('Sign in')) setData(null);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, [configured]);
  // Initial network fetch updates state asynchronously after the response.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  const processing = docs.some((d) =>
    ['queued', 'extracting_text', 'identifying_document', 'extracting_information'].includes(
      d.status,
    ),
  );
  useEffect(() => {
    if (!data || !processing) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [data, processing, refresh]);
  async function signout() {
    try {
      await api('/api/auth', 'POST', { action: 'signout' });
      setData(null);
      setDocs([]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!configured)
    return (
      <div className="login">
        <section className="hero">
          <div className="brand">
            <span className="brand-mark">{name.charAt(0)}</span>
            {name}
          </div>
          <h1>Your F-1 document assistant.</h1>
          <p>Secure document organization, recorded dates and WhatsApp reminders.</p>
        </section>
        <section className="card">
          <h2>Complete server setup</h2>
          <p>
            This installation needs its Supabase connection before accounts and documents can be
            used.
          </p>
          <p className="muted">
            Configure the variables in <code>.env.example</code>, apply the database migrations and
            start the background worker using the README.
          </p>
          <p className="notice">No demo documents or fake account data are shown.</p>
        </section>
      </div>
    );
  if (loading)
    return (
      <div className="login">
        <p role="status">Opening your workspace…</p>
      </div>
    );
  if (!data)
    return (
      <>
        {signedOutMessage && (
          <p className="notice" role="status">
            {signedOutMessage}
          </p>
        )}
        {error && <p className="notice error">{error}</p>}
        <Auth name={name} onSignedIn={() => void refresh()} />
      </>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">{name.charAt(0)}</span>
          {name}
        </div>
        <p className="sidebar-sub muted small">Your F-1 document workspace</p>
        <nav aria-label="Main navigation">
          {sections.map((s) => (
            <button
              key={s}
              aria-current={section === s ? 'page' : undefined}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        <footer>
          <p>
            Private documents.
            <br />
            Clear recorded dates.
          </p>
          <button onClick={() => void signout()}>Sign out</button>
        </footer>
      </aside>
      <main>
        <header className="header">
          <div className="row between">
            <p className="eyebrow">F-1 Student · Private workspace</p>
            <button onClick={() => void refresh()}>Refresh</button>
          </div>
          <h1>
            {section === 'Dashboard'
              ? `Welcome${data.profile.display_name ? `, ${data.profile.display_name}` : ''}`
              : section}
          </h1>
          <p className="muted">
            {section === 'Dashboard'
              ? 'Keep your documents organized and your important dates in view.'
              : 'Your information, grounded in your uploaded documents.'}
          </p>
        </header>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {data.profile.deleting_at ? (
          <section className="card">
            <h2>Account deletion is in progress</h2>
            <p>
              Your documents are hidden. The worker will permanently remove files and account
              records.
            </p>
            <Settings
              data={data}
              refresh={refresh}
              onDeleted={(message) => {
                setSignedOutMessage(message);
                setData(null);
                setDocs([]);
              }}
            />
          </section>
        ) : (
          <>
            {!data.profile.display_name && (
              <p className="notice">
                Start by saving your name and time zone below. Then verify WhatsApp and upload your
                first document.
              </p>
            )}
            {section === 'Dashboard' && (
              <Dashboard docs={docs} onUpload={() => setSection('Documents')} />
            )}{' '}
            {section === 'Documents' && <Documents docs={docs} refresh={refresh} />}{' '}
            {section === 'Timeline' && <Timeline docs={docs} />}{' '}
            {section === 'Travel Readiness' && <Travel docs={docs} />}{' '}
            {section === 'Ask AI' && <Chat />}{' '}
            {(section === 'Settings' || section === 'Reminders') && (
              <Settings
                key={`${section}:${data.whatsapp?.verified_at || 'unlinked'}`}
                data={data}
                refresh={refresh}
                remindersOnly={section === 'Reminders'}
                onDeleted={(message) => {
                  setSignedOutMessage(message);
                  setData(null);
                  setDocs([]);
                }}
              />
            )}
          </>
        )}
        <footer>
          This tool organizes document information and dates. Confirm immigration decisions with
          your DSO or a qualified immigration attorney.
          <button className="section-space" onClick={() => void signout()}>
            Sign out
          </button>
        </footer>
      </main>
    </div>
  );
}
