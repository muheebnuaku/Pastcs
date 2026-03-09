'use client';

import Link from 'next/link';
import { GraduationCap, Github } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <span className="font-bold text-xl text-white">PastCS</span>
            </Link>
            <p className="text-sm max-w-md leading-relaxed">
              An exam practice platform built for IT students at every level.
              Practice smarter, track your progress, and score higher.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-white mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/courses" className="hover:text-white transition-colors">
                  Courses
                </Link>
              </li>
              <li>
                <Link href="/leaderboard" className="hover:text-white transition-colors">
                  Leaderboard
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-white transition-colors">
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>

          {/* Courses */}
          <div>
            <h3 className="font-semibold text-white mb-4">Courses</h3>
            <ul className="space-y-2 text-sm">
              <li>DCIT101 — Intro to CS</li>
              <li>DCIT103 — Office Tools</li>
              <li>DCIT105 — Math for IT</li>
              <li>ECON101 — Economics I</li>
              <li>STAT111 — Statistics I</li>
              <li>UGRC150 — Critical Thinking</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm">
            © {new Date().getFullYear()} PastCS. Built for IT students.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="hover:text-white transition-colors"
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
