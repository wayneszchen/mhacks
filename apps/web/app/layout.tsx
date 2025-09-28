import './globals.css';
import React from 'react';
import { Plus_Jakarta_Sans, Space_Grotesk } from 'next/font/google';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import Providers from './providers';

const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans' });
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' });

export const metadata = {
  title: 'Agora',
  description: 'Find and message relevant contacts via LinkedIn or email',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen bg-[#0b0f19] text-white antialiased font-sans">
        <Providers>
          <div className="relative">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1000px_600px_at_50%_-20%,rgba(99,102,241,0.15),transparent)]" />
            <Navbar />
            <main className="relative z-10">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}

 