'use client';
import { useState } from 'react';
import { api, SettingsData } from './api';
import { offsets } from '@/lib/documents';
export default function Settings({
  data,
  refresh,
  onDeleted,
  remindersOnly = false,
}: {
  data: SettingsData;
  refresh: () => Promise<void>;
  onDeleted: (message: string) => void;
  remindersOnly?: boolean;
}) {
  const [name, setName] = useState(data.profile.display_name);
  const [zone, setZone] = useState(data.profile.timezone);
  const [days, setDays] = useState(data.preferences.reminder_offsets);
  const [enabled, setEnabled] = useState(data.preferences.whatsapp_reminders);
  const [phone, setPhone] = useState(data.whatsapp?.phone || '');
  const [consent, setConsent] = useState(false);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  async function save() {
    setBusy(true);
    try {
      await api('/api/settings', 'PATCH', {
        display_name: name,
        timezone: zone,
        reminder_offsets: days,
        whatsapp_reminders: enabled,
      });
      setMessage('Preferences saved. Reviewed dates have been scheduled.');
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    try {
      const result = await api<{ url: string }>('/api/whatsapp/link', 'POST', { phone, consent });
      setLink(result.url);
      setMessage(
        'Open WhatsApp and send the pre-filled verification message. The link expires in 10 minutes.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unlink() {
    setBusy(true);
    try {
      await api('/api/whatsapp/link', 'DELETE');
      setEnabled(false);
      setLink('');
      setMessage('WhatsApp disconnected and reminders turned off.');
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      const result = await api<{ message: string }>('/api/account', 'DELETE', {
        confirmation,
        password,
      });
      onDeleted(result.message);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!remindersOnly && (
        <section className="card">
          <h2>{name ? 'Your profile' : 'Welcome — set up your profile'}</h2>
          <p className="muted">F-1 Student · {data.email}</p>
          <label htmlFor="immigration-category">Immigration category</label>
          <select id="immigration-category" defaultValue="F1">
            <option value="F1">F-1 Student</option>
          </select>
          <label htmlFor="display-name">Preferred name</label>
          <input
            id="display-name"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <label htmlFor="timezone">Time zone</label>
          <input
            id="timezone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            list="zones"
          />
          <datalist id="zones">
            {[
              'America/Chicago',
              'America/New_York',
              'America/Denver',
              'America/Los_Angeles',
              'Pacific/Honolulu',
            ].map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <p className="muted small">Reminders are scheduled by calendar date in this time zone.</p>
          <button className="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            Save profile
          </button>
        </section>
      )}
      <section className="card">
        <h2>Connect WhatsApp</h2>
        {data.whatsapp ? (
          <>
            <p className="notice">Verified number: {data.whatsapp.phone}</p>
            <button disabled={busy} onClick={() => void unlink()}>
              Disconnect WhatsApp
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              Verify ownership by sending a one-time message from your number to our WhatsApp
              account. No document information is available before verification.
            </p>
            <label htmlFor="phone">WhatsApp phone number, with country code</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+12105550123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I agree to link this number for document questions and optional date reminders. I
              understand WhatsApp messages are processed by the messaging provider. I can disconnect
              or send STOP to turn off reminders.
            </label>
            <button disabled={busy || !consent} onClick={() => void verify()}>
              Create verification link
            </button>
            {link && (
              <p className="section-space">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  Open WhatsApp and send verification →
                </a>
              </p>
            )}
            <button className="section-space" onClick={() => void refresh()}>
              Check verification status
            </button>
          </>
        )}
      </section>
      <section className="card">
        <h2>Reminder preferences</h2>
        <p className="muted">Choose when to be reminded before reviewed expiration or end dates.</p>
        <div className="row">
          {offsets.map((offset) => (
            <label key={offset}>
              <input
                type="checkbox"
                checked={days.includes(offset)}
                onChange={(e) =>
                  setDays(e.target.checked ? [...days, offset] : days.filter((d) => d !== offset))
                }
              />
              {offset} days
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!data.whatsapp}
          />
          Send reminders through WhatsApp
        </label>
        <p className="muted small">
          Requires a verified number and provider-approved reminder template. STOP turns off future
          reminders. Unreviewed fields and older document versions do not generate notifications.
        </p>
        <button className="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          Save reminder preferences
        </button>
      </section>
      <section className="card">
        <h2>Upcoming reminders</h2>
        {data.reminders.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Deadline</th>
                  <th>Notify on</th>
                  <th>Lead time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.reminders.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td>{r.deadline}</td>
                    <td>{r.scheduled_date}</td>
                    <td>{r.offset_days} days</td>
                    <td>{r.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            Review a current document with an upcoming date to schedule reminders.
          </div>
        )}
        <p className="muted small section-space">
          Submitted means the messaging provider accepted the message; it does not confirm delivery.
          Uncertain sends are held for review to prevent accidental duplicates.
        </p>
        {data.history.length > 0 && (
          <>
            <h3>Recent send history</h3>
            {data.history.map((h) => (
              <div className="list-item" key={h.id}>
                {new Date(h.created_at).toLocaleString()} · {h.outcome}
              </div>
            ))}
          </>
        )}
      </section>
      {!remindersOnly && (
        <section className="card">
          <h2>Delete your account and all data</h2>
          <p className="muted">
            Permanently removes original files, extracted information, reminders, WhatsApp links,
            audit records and your sign-in account. Deletion is processed by the background worker.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void remove();
            }}
          >
            <label htmlFor="delete-confirm">Type DELETE to confirm</label>
            <input
              id="delete-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
            />
            <label htmlFor="delete-password">Confirm your password</label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              className="danger section-space"
              disabled={busy || confirmation !== 'DELETE' || !password}
              type="submit"
            >
              Permanently delete account
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
