"use client";
import React from 'react';
import Container from '../../components/Container';
import { motion } from 'framer-motion';

export default function AboutPage() {
  return (
    <section className="pt-20">
      <Container>
        <motion.h1
          className="font-display text-4xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Built for thoughtful outreach
        </motion.h1>
        <motion.p
          className="mt-4 text-white/70 max-w-3xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
        >
          We believe the best connections start with context. linkedin-messager helps you find the warmest paths, explains why a contact is relevant, and drafts concise messages so you can focus on the conversation.
        </motion.p>
      </Container>
    </section>
  );
}
