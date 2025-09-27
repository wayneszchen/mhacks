"use client";
import React from 'react';
import Container from '../components/Container';
import Button from '../components/Button';
import { motion } from 'framer-motion';
import Link from 'next/link';

export default function Page() {
  return (
    <>
      <section className="pt-24">
        <Container>
          <div className="text-center">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="font-display text-5xl md:text-6xl tracking-tight"
            >
              Intelligent outreach without the noise
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.6 }}
              className="mt-5 text-white/70 text-lg max-w-2xl mx-auto"
            >
              Find the warmest contacts, score relevance, and send tailored messages on LinkedIn or email—fast.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="mt-8 flex items-center justify-center gap-3"
            >
              <Link href="/dashboard"><Button>Open Dashboard</Button></Link>
            </motion.div>
          </div>
        </Container>
      </section>

      <section className="mt-24">
        <Container>
          <div className="text-center mb-8">
            <h2 className="font-display text-3xl">Why we’re different</h2>
            <p className="text-white/70 mt-2">Three focused dashboards, built for outcomes not noise.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[{
              title: 'Warmth Dashboard',
              desc: 'Scores contacts by alumni, role alignment, company overlap, and activity. Clear explanations per contact.'
            }, {
              title: 'Composer Dashboard',
              desc: 'On-tone drafts for LinkedIn and email with one-click copy, send, and A/B variants.'
            }, {
              title: 'Channel Router',
              desc: 'Smartly routes outreach to LinkedIn or verified email (Apollo + AgentMail), with live metrics.'
            }].map((f, idx) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ delay: idx * 0.1 }}
                className="rounded-xl bg-white/5 border border-white/10 p-0 overflow-hidden"
              >
                <div className="border-b border-white/10 px-5 py-3 bg-black/20 text-sm text-white/70">{f.title}</div>
                <div className="p-5">
                  <p className="text-white/80 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      <section className="mt-24">
        <Container className="text-center">
          <div className="rounded-2xl bg-gradient-to-br from-brand-600/40 to-purple-600/30 p-[1px]">
            <div className="rounded-2xl bg-[#0b0f19] p-10">
              <h3 className="font-display text-3xl">Start your next outreach in minutes</h3>
              <p className="text-white/70 mt-2">No scraping required. Add LinkedIn CSV or email graph later.</p>
              <div className="mt-6">
                <Link href="/dashboard"><Button>Get Started</Button></Link>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
