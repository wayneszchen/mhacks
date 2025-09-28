import React from 'react';
import Container from './Container';

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-white/10">
      <Container className="py-10 flex items-center justify-between text-sm text-white/60">
        <div>© {new Date().getFullYear()} Agora</div>
        <div className="flex gap-4">
          <a className="hover:text-white" href="/privacy">Privacy</a>
          <a className="hover:text-white" href="/terms">Terms</a>
        </div>
      </Container>
    </footer>
  );
}
