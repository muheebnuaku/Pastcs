'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { useAuthStore } from '@/lib/store';
import { Menu, X } from 'lucide-react';

export function Navbar() {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/courses', label: 'Courses' },
    { href: '/leaderboard', label: 'Leaderboard' },
  ];

  return (
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
            <Image src="/pastcs.png" alt="PastCS" width={40} height={40} className="rounded-xl" />
            <span className={cn(
              'font-bold text-xl transition-colors',
              isScrolled ? 'text-gray-900' : 'text-white'
            )}>
              PastCS
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'font-medium transition-colors',
                  isScrolled
                    ? pathname === link.href
                      ? 'text-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                    : pathname === link.href
                      ? 'text-white'
                      : 'text-white/80 hover:text-white'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Auth Buttons */}
          <div className="hidden md:flex items-center gap-4">
            {user ? (
              <Link href={user.role === 'admin' ? '/admin' : '/dashboard'}>
                <Button>Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant={isScrolled ? 'ghost' : 'outline'}>
                    Sign In
                  </Button>
                </Link>
                <Link href="/register">
                  <Button>Get Started</Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className={cn(
              'md:hidden p-2 rounded-lg transition-colors',
              isScrolled ? 'text-gray-900' : 'text-white'
            )}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-100">
          <div className="px-4 py-4 space-y-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={cn(
                  'block px-4 py-2 rounded-lg font-medium transition-colors',
                  pathname === link.href
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                {link.label}
              </Link>
            ))}
            <hr className="my-2" />
            {user ? (
              <Link
                href={user.role === 'admin' ? '/admin' : '/dashboard'}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Button className="w-full">Dashboard</Button>
              </Link>
            ) : (
              <div className="space-y-2">
                <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button variant="outline" className="w-full">
                    Sign In
                  </Button>
                </Link>
                <Link href="/register" onClick={() => setIsMobileMenuOpen(false)}>
                  <Button className="w-full">Get Started</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
