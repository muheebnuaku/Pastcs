'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { Menu, X, Home, BookOpen, Trophy } from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: '/',            label: 'Home',        icon: Home },
    { href: '/courses',     label: 'Courses',     icon: BookOpen },
    { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  ];

  return (
    <>
      <div className="font-jakarta sticky top-4 z-50 flex justify-center px-4">
        <nav className="flex items-center gap-7 bg-[#fdf8f2]/85 backdrop-blur-md border border-[#efe2d0] rounded-full pl-[18px] pr-[10px] py-[9px] shadow-[0_8px_24px_rgba(43,36,32,0.06)] max-w-3xl w-full">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
            <Image src="/past.png" alt="PastCS" width={96} height={96} className="w-[30px] h-[30px] rounded-full object-cover" />
            <span className="text-base font-extrabold text-[#2b2420] tracking-tight">PastCS</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-5 flex-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'text-sm font-semibold transition-colors',
                  pathname === link.href ? 'text-[#e8603c]' : 'text-[#8a7f6f] hover:text-[#2b2420]'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3.5 flex-shrink-0 ml-auto">
            {user ? (
              <Link href={user.role === 'admin' ? '/admin' : '/dashboard'}>
                <Button className="bg-[#e8603c] hover:bg-[#c94f2f] focus:ring-[#e8603c] rounded-full text-sm px-4 py-2">Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" className="text-[#2b2420] hover:bg-[#f7ede1] focus:ring-[#e8603c] text-sm">Sign In</Button>
                </Link>
                <Link href="/register">
                  <Button className="bg-[#e8603c] hover:bg-[#c94f2f] focus:ring-[#e8603c] rounded-full text-sm px-4 py-2">Get Started</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="md:hidden ml-auto p-1.5 rounded-full text-[#2b2420]"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </nav>
      </div>

      {/* ── Mobile slide-in drawer (right side) ── */}
      <div
        onClick={() => setIsMobileMenuOpen(false)}
        className={cn(
          'font-jakarta md:hidden fixed inset-0 bg-black/50 z-50 transition-opacity duration-300',
          isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      />
      <div
        className={cn(
          'font-jakarta md:hidden fixed top-0 right-0 h-full w-72 bg-[#fdf8f2] z-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col',
          isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#efe2d0]">
          <Link href="/" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3">
            <Image src="/past.png" alt="PastCS" width={96} height={96} className="w-10 h-10 rounded-full object-cover" />
            <span className="font-extrabold text-[#2b2420] text-lg">PastCS</span>
          </Link>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-lg text-[#8a7f6f] hover:bg-[#f7ede1] transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-5 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setIsMobileMenuOpen(false)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold transition-colors',
                pathname === link.href
                  ? 'bg-[#fde3da] text-[#e8603c]'
                  : 'text-[#8a7f6f] hover:bg-[#f7ede1]'
              )}
            >
              <link.icon className="w-5 h-5" />
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="p-5 border-t border-[#efe2d0] space-y-3">
          {user ? (
            <Link href={user.role === 'admin' ? '/admin' : '/dashboard'} onClick={() => setIsMobileMenuOpen(false)}>
              <Button className="w-full rounded-2xl bg-[#e8603c] hover:bg-[#c94f2f] focus:ring-[#e8603c]">Go to Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full rounded-2xl border-[#efe2d0] text-[#2b2420] hover:bg-[#f7ede1] focus:ring-[#e8603c]">Sign In</Button>
              </Link>
              <Link href="/register" onClick={() => setIsMobileMenuOpen(false)}>
                <Button className="w-full rounded-2xl bg-[#e8603c] hover:bg-[#c94f2f] focus:ring-[#e8603c]">Get Started Free</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
