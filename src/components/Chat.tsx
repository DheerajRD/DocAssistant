'use client';
import { useState } from 'react';
import { api } from './api';
const examples = [
  'My documents',
  'What expires next?',
  'When does my CPT end?',
  'Which I-20 is my latest?',
  'What documents am I missing?',
  'What expires within 6 months?',
];
export default function Chat() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setQuestion('');
    setMessages((m) => [...m, { role: 'user', text }]);
    try {
      const result = await api<{ answer: string }>('/api/chat', 'POST', { question: text });
      setMessages((m) => [...m, { role: 'assistant', text: result.answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Ask about your documents</h2>
      <p className="muted">
        Answers use your own uploaded records. No legal advice or immigration eligibility decisions.
      </p>
      <div className="row">
        {examples.map((q) => (
          <button key={q} disabled={busy} onClick={() => void ask(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="chat-log" aria-live="polite">
        {messages.length ? (
          messages.map((m, i) => (
            <div className={`bubble ${m.role}`} key={i}>
              <strong className="small">{m.role === 'user' ? 'You' : 'Document assistant'}</strong>
              <div>{m.text}</div>
            </div>
          ))
        ) : (
          <p className="muted">Start with a question about your documents or dates.</p>
        )}
        {busy && <p role="status">Checking your document records…</p>}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          aria-label="Your document question"
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="When does my passport expire?"
          required
        />
        <button className="primary" disabled={busy} type="submit">
          Ask
        </button>
      </form>
      <p className="muted small section-space">
        Chat text is held in this browser session only. The server stores intent and channel
        metadata. WhatsApp questions are temporarily queued, then erased after processing.
      </p>
    </section>
  );
}
