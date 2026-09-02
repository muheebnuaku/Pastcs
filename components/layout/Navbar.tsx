'use client';

import { useState, useEffect } from 'react';
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
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '/',            label: 'Home',        icon: Home },
    { href: '/courses',     label: 'Courses',     icon: BookOpen },
    { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  ];

  return (
    <>
      <nav
        className={cn(
          'sticky top-0 z-50 bg-[#faf7f0]/95 backdrop-blur-md transition-shadow duration-200',
          isScrolled ? 'border-b border-[#e6e0d4] shadow-sm' : 'border-b border-transparent'
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-3">
              <Image src="/past.png" alt="PastCS" width={96} height={96} className="w-10 h-10 rounded-full object-cover" />
              <span className="font-serif font-semibold text-xl text-[#1c1a17]">
                PastCS
              </span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'font-medium transition-colors',
                    pathname === link.href ? 'text-[#1f4a3a]' : 'text-[#57534a] hover:text-[#1c1a17]'
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {/* Desktop auth */}
            <div className="hidden md:flex items-center gap-4">
              {user ? (
                <Link href={user.role === 'admin' ? '/admin' : '/dashboard'}>
                  <Button className="bg-[#1f4a3a] hover:bg-[#163a2d] focus:ring-[#1f4a3a]">Dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link href="/login">
                    <Button variant="ghost" className="text-[#1c1a17] hover:bg-[#f0ece0] focus:ring-[#1f4a3a]">Sign In</Button>
                  </Link>
                  <Link href="/register">
                    <Button className="bg-[#1f4a3a] hover:bg-[#163a2d] focus:ring-[#1f4a3a]">Get Started</Button>
                  </Link>
                </>
              )}
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-lg text-[#1c1a17] transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile slide-in drawer (right side) ── */}
      {/* Overlay */}
      <div
        onClick={() => setIsMobileMenuOpen(false)}
        className={cn(
          'md:hidden fixed inset-0 bg-black/50 z-50 transition-opacity duration-300',
          isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
      />

      {/* Drawer panel */}
      <div
        className={cn(
          'md:hidden fixed top-0 right-0 h-full w-72 bg-[#faf7f0] z-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col',
          isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between p-5 border-b border-[#e6e0d4]">
          <Link href="/" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3">
            <Image src="/past.png" alt="PastCS" width={96} height={96} className="w-10 h-10 rounded-full object-cover" />
            <span className="font-serif font-semibold text-[#1c1a17] text-lg">PastCS</span>
          </Link>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-lg text-[#57534a] hover:bg-[#f0ece0] transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-5 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setIsMobileMenuOpen(false)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors',
                pathname === link.href
                  ? 'bg-[#eef3ef] text-[#1f4a3a]'
                  : 'text-[#57534a] hover:bg-[#f0ece0]'
              )}
            >
              <link.icon className="w-5 h-5" />
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Auth buttons */}
        <div className="p-5 border-t border-[#e6e0d4] space-y-3">
          {user ? (
            <Link href={user.role === 'admin' ? '/admin' : '/dashboard'} onClick={() => setIsMobileMenuOpen(false)}>
              <Button className="w-full bg-[#1f4a3a] hover:bg-[#163a2d] focus:ring-[#1f4a3a]">Go to Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full border-[#d9d2c2] text-[#1c1a17] hover:bg-[#f0ece0] focus:ring-[#1f4a3a]">Sign In</Button>
              </Link>
              <Link href="/register" onClick={() => setIsMobileMenuOpen(false)}>
                <Button className="w-full bg-[#1f4a3a] hover:bg-[#163a2d] focus:ring-[#1f4a3a]">Get Started Free</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
