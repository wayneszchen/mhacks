"use client";
import React, { useState } from 'react';
import Container from '../../components/Container';
import Button from '../../components/Button';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type Candidate = {
  id: string;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  linkedinUrl?: string;
  summary?: string;
  score?: number;
};

export default function DashboardPage() {
  const [prompt, setPrompt] = useState('Find SWE contacts at Amazon in Seattle');
  const [results, setResults] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const [selected, setSelected] = useState<Candidate | null>(null);

  const runSearch = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/search/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();
      setResults(data.results || []);
    } finally {
      setLoading(false);
    }
  };

  const draftMessage = async (candidate: Candidate, channel: 'linkedin'|'email' = 'linkedin') => {
    setSelected(candidate);
    const res = await fetch(`${API_URL}/messages/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate, tone: 'warm', channel })
    });
    const data = await res.json();
    setDraft(data.body);
  };

  const sendEmail = async (candidate: Candidate) => {
    const res = await fetch(`${API_URL}/send/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: candidate.email || 'test@example.com', subject: 'Quick intro', text: draft || 'Hello' })
    });
    const data = await res.json();
    alert(`Send status: ${data.status}`);
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(draft);
  };

  return (
    <section className="pt-16 pb-24">
      <Container>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-sm text-white/70">Your intent</label>
            <input
              className="w-full mt-1 bg-white/5 border border-white/10 rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-brand-600"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Find SWE contacts at Amazon in Seattle"
            />
          </div>
          <Button onClick={runSearch} className="h-10 min-w-[120px]">
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>

        <div className="mt-8 grid md:grid-cols-2 gap-6">
          <AnimatePresence>
            {results.map((r, idx) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ delay: idx * 0.03 }}
                className="rounded-xl bg-white/5 border border-white/10 p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-sm text-white/70">{r.title} {r.company ? `@ ${r.company}` : ''}</div>
                  </div>
                  <div className="text-sm text-white/70">Score: <span className="text-white font-semibold">{Math.round((r.score || 0) * 100)}</span></div>
                </div>
                <p className="text-sm text-white/70 mt-2 line-clamp-3">{r.summary || '—'}</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" onClick={() => draftMessage(r, 'linkedin')}>Draft LinkedIn</Button>
                  <Button variant="ghost" onClick={() => draftMessage(r, 'email')}>Draft Email</Button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-10 rounded-xl bg-white/5 border border-white/10 p-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Draft to {selected.name}</h3>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={copyToClipboard}>Copy</Button>
                  <Button onClick={() => sendEmail(selected!)}>Send Email</Button>
                </div>
              </div>
              <textarea
                className="mt-3 w-full min-h-[180px] bg-black/30 border border-white/10 rounded-md p-3 outline-none focus:ring-2 focus:ring-brand-600"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Container>
    </section>
  );
}
