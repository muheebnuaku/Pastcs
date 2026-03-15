'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, Button, Input, Avatar, Modal } from '@/components/ui';
import type { User, Subscription } from '@/types';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Target,
  Flame,
  Gift,
  X,
  Plus,
  ShieldCheck,
} from 'lucide-react';

interface StudentData extends User {
  total_tests: number;
  avg_score: number;
}

function levelLabel(level: number, semester: number) {
  return `L${level} S${semester}`;
}

function isFreePass(sub: Subscription) {
  return sub.payment_reference?.startsWith('free_pass_');
}

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentData[]>([]);
  const [subsMap, setSubsMap] = useState<Record<string, Subscription[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Free pass modal state
  const [modalStudent, setModalStudent] = useState<StudentData | null>(null);
  const [grantLevel, setGrantLevel] = useState<number>(100);
  const [grantSemester, setGrantSemester] = useState<number>(1);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null); // subscriptionId being revoked
  const [actionError, setActionError] = useState('');

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/students');
    if (res.ok) {
      const { students: rawStudents, subscriptions } = await res.json();

      // Build subscriptions map
      const map: Record<string, Subscription[]> = {};
      for (const sub of subscriptions) {
        if (!map[sub.user_id]) map[sub.user_id] = [];
        map[sub.user_id].push(sub);
      }
      setSubsMap(map);

      // Enrich students with test stats from the response (kept simple — no extra fetches)
      setStudents(rawStudents.map((u: User) => ({
        ...u,
        total_tests: u.total_tests_taken ?? 0,
        avg_score: 0,
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  const filteredStudents = students.filter(s =>
    s.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.student_id?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredStudents.length / pageSize);
  const paginatedStudents = filteredStudents.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const modalSubs = modalStudent ? (subsMap[modalStudent.id] ?? []) : [];

  const handleGrantFreePass = async () => {
    if (!modalStudent) return;
    setGranting(true);
    setActionError('');
    const res = await fetch('/api/admin/free-pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: modalStudent.id, level: grantLevel, semester: grantSemester }),
    });
    const json = await res.json();
    if (!res.ok) {
      setActionError(json.error ?? 'Failed to grant free pass');
    } else {
      await fetchStudents();
    }
    setGranting(false);
  };

  const handleRevoke = async (sub: Subscription) => {
    if (!modalStudent) return;
    setRevoking(sub.id);
    setActionError('');
    const res = await fetch('/api/admin/free-pass', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: sub.user_id, level: sub.level, semester: sub.semester }),
    });
    const json = await res.json();
    if (!res.ok) {
      setActionError(json.error ?? 'Failed to revoke');
    } else {
      await fetchStudents();
      // Keep modal open & update it
      setSubsMap(prev => ({
        ...prev,
        [sub.user_id]: (prev[sub.user_id] ?? []).filter(s => s.id !== sub.id),
      }));
    }
    setRevoking(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Students</h1>
        <p className="text-gray-600">{students.length} registered students</p>
      </div>

      {/* Search */}
      <Card>
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name, email, or student ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="pl-10"
            />
          </div>
        </div>
      </Card>

      {/* Students Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Student</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Student ID</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Tests</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Streak</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">XP</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Access</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-sm">
                    Loading students…
                  </td>
                </tr>
              ) : paginatedStudents.map((student) => {
                const subs = subsMap[student.id] ?? [];
                return (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={student.avatar_url}
                          name={student.full_name || student.email}
                          size="md"
                        />
                        <div>
                          <p className="font-medium text-gray-900">{student.full_name || 'No Name'}</p>
                          <p className="text-sm text-gray-500">{student.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-gray-600">{student.student_id || '-'}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Target className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">{student.total_tests_taken ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Flame className={`w-4 h-4 ${student.practice_streak > 0 ? 'text-orange-500' : 'text-gray-300'}`} />
                        <span className={`font-medium ${student.practice_streak > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                          {student.practice_streak}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-medium text-purple-600">{student.xp}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {subs.length === 0 ? (
                          <span className="text-xs text-gray-400 italic">No access</span>
                        ) : subs.map(sub => (
                          <span
                            key={sub.id}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              isFreePass(sub)
                                ? 'bg-green-100 text-green-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {isFreePass(sub) && <Gift className="w-3 h-3" />}
                            {!isFreePass(sub) && <ShieldCheck className="w-3 h-3" />}
                            {levelLabel(sub.level, sub.semester)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setModalStudent(student); setActionError(''); }}
                      >
                        <Gift className="w-3.5 h-3.5 mr-1" />
                        Manage
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && filteredStudents.length === 0 && (
          <div className="text-center py-12 text-gray-500">No students found</div>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Free Pass Modal */}
      <Modal
        isOpen={!!modalStudent}
        onClose={() => { setModalStudent(null); setActionError(''); }}
        title="Manage Access"
      >
        {modalStudent && (
          <div className="space-y-5">
            {/* Student identity */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <Avatar src={modalStudent.avatar_url} name={modalStudent.full_name || modalStudent.email} size="md" />
              <div>
                <p className="font-semibold text-gray-900">{modalStudent.full_name || 'No Name'}</p>
                <p className="text-sm text-gray-500">{modalStudent.email}</p>
              </div>
            </div>

            {/* Current subscriptions */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Current Access</h3>
              {modalSubs.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No active access</p>
              ) : (
                <div className="space-y-2">
                  {modalSubs.map(sub => (
                    <div key={sub.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        {isFreePass(sub) ? (
                          <Gift className="w-4 h-4 text-green-600" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-blue-600" />
                        )}
                        <span className="text-sm font-medium text-gray-900">
                          Level {sub.level} — Semester {sub.semester}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          isFreePass(sub) ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {isFreePass(sub) ? 'Free Pass' : 'Paid'}
                        </span>
                      </div>
                      {isFreePass(sub) && (
                        <button
                          onClick={() => handleRevoke(sub)}
                          disabled={revoking === sub.id}
                          className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          {revoking === sub.id ? 'Revoking…' : (
                            <><X className="w-3.5 h-3.5" />Revoke</>
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Grant free pass */}
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-green-600" />
                Grant Free Pass
              </h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Level</label>
                  <select
                    value={grantLevel}
                    onChange={e => setGrantLevel(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {[100, 200, 300, 400].map(l => (
                      <option key={l} value={l}>Level {l}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Semester</label>
                  <select
                    value={grantSemester}
                    onChange={e => setGrantSemester(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  >
                    <option value={1}>Semester 1</option>
                    <option value={2}>Semester 2</option>
                  </select>
                </div>
              </div>

              {actionError && (
                <p className="text-sm text-red-600 mb-2">{actionError}</p>
              )}

              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                onClick={handleGrantFreePass}
                disabled={granting}
              >
                <Gift className="w-4 h-4 mr-2" />
                {granting ? 'Granting…' : 'Grant Free Pass'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
