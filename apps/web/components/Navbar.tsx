"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

const NavLink = ({ href, children }: { href: string; children: React.ReactNode }) => {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`text-sm px-3 py-2 rounded-md transition-colors ${active ? 'bg-white/10 text-white' : 'text-white/80 hover:text-white hover:bg-white/10'}`}
    >
      {children}
    </Link>
  );
};

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur supports-[backdrop-filter]:bg-black/30 bg-black/20">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-display text-xl tracking-tight">
          Agora
        </Link>
        <nav className="flex items-center gap-1">
          <NavLink href="/">Home</NavLink>
          <NavLink href="/about">About</NavLink>
          <NavLink href="/dashboard">Dashboard</NavLink>
        </nav>
      </div>
    </header>
  );
}
