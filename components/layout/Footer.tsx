'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Github } from 'lucide-react';

export function Footer() {
  return (
    <footer className="font-jakarta bg-[#2b2420] text-[#a89680]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <Image src="/past.png" alt="PastCS" width={96} height={96} className="w-8 h-8 rounded-full object-cover" />
              <span className="font-extrabold text-lg text-[#fdf8f2]">PastCS</span>
            </Link>
            <p className="text-sm max-w-md leading-relaxed">
              An exam-practice platform built for University of Ghana Computer Science students.
              Practice smarter, track your progress, and score higher.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-xs font-bold text-[#fdf8f2] uppercase tracking-wider mb-4">Quick Links</h3>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/courses" className="hover:text-[#fdf8f2] transition-colors">
                  Courses
                </Link>
              </li>
              <li>
                <Link href="/leaderboard" className="hover:text-[#fdf8f2] transition-colors">
                  Leaderboard
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-[#fdf8f2] transition-colors">
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>

          {/* Courses */}
          <div>
            <h3 className="text-xs font-bold text-[#fdf8f2] uppercase tracking-wider mb-4">Courses</h3>
            <ul className="space-y-2.5 text-sm">
              <li>DCIT101 — Intro to CS</li>
              <li>DCIT103 — Office Tools</li>
              <li>DCIT105 — Math for IT</li>
              <li>ECON101 — Economics I</li>
              <li>STAT111 — Statistics I</li>
              <li>UGRC150 — Critical Thinking</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 pt-8 border-t border-[#423a33] flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-[#736a5e]">
            © {new Date().getFullYear()} PastCS. Built for University of Ghana Computer Science students.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="hover:text-[#fdf8f2] transition-colors"
              aria-label="GitHub"
            >
              <Github className="w-5 h-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
