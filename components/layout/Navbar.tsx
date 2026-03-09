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
          'fixed top-0 left-0 right-0 z-50 transition-all duration-200',
          isScrolled ? 'bg-white/90 backdrop-blur-md shadow-sm' : 'bg-transparent'
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-3">
              <Image src="/pastcs.png" alt="PastCS" width={72} height={72} className="rounded-xl" />
              <span className={cn(
                'font-bold text-xl transition-colors',
                isScrolled ? 'text-gray-900' : 'text-white'
              )}>
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
                    isScrolled
                      ? pathname === link.href ? 'text-blue-600' : 'text-gray-600 hover:text-gray-900'
                      : pathname === link.href ? 'text-white'   : 'text-white/80 hover:text-white'
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
                  <Button>Dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link href="/login">
                    <Button variant={isScrolled ? 'ghost' : 'outline'}>Sign In</Button>
                  </Link>
                  <Link href="/register">
                    <Button>Get Started</Button>
                  </Link>
                </>
              )}
            </div>

            {/* Mobile hamburger */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className={cn(
                'md:hidden p-2 rounded-lg transition-colors',
                isScrolled ? 'text-gray-900' : 'text-white'
              )}
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
          'md:hidden fixed top-0 right-0 h-full w-72 bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col',
          isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <Link href="/" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3">
            <Image src="/pastcs.png" alt="PastCS" width={40} height={40} className="rounded-xl" />
            <span className="font-bold text-gray-900 text-lg">PastCS</span>
          </Link>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
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
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              <link.icon className="w-5 h-5" />
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Auth buttons */}
        <div className="p-5 border-t border-gray-100 space-y-3">
          {user ? (
            <Link href={user.role === 'admin' ? '/admin' : '/dashboard'} onClick={() => setIsMobileMenuOpen(false)}>
              <Button className="w-full">Go to Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full">Sign In</Button>
              </Link>
              <Link href="/register" onClick={() => setIsMobileMenuOpen(false)}>
                <Button className="w-full">Get Started Free</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </>
  );
}
