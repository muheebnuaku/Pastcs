'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, Button, Input, Avatar, Modal, Badge } from '@/components/ui';
import type { User, Subscription, UserRole } from '@/types';
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
  Shield,
  Users as UsersIcon,
  GraduationCap,
} from 'lucide-react';

interface UserRow extends User {
  total_tests: number;
  avg_score: number;
}

type RoleFilter = 'all' | UserRole;

function levelLabel(level: number, semester: number) {
  return `L${level} S${semester}`;
}

function isFreePass(sub: Subscription) {
  return sub.payment_reference?.startsWith('free_pass_');
}

const roleTabs: { key: RoleFilter; label: string; icon: typeof UsersIcon }[] = [
  { key: 'all', label: 'All', icon: UsersIcon },
  { key: 'student', label: 'Students', icon: GraduationCap },
  { key: 'admin', label: 'Admins', icon: Shield },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [subsMap, setSubsMap] = useState<Record<string, Subscription[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [freePassOnly, setFreePassOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Manage access modal state
  const [modalUser, setModalUser] = useState<UserRow | null>(null);
  const [grantLevel, setGrantLevel] = useState<number>(100);
  const [grantSemester, setGrantSemester] = useState<number>(1);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null); // subscriptionId being revoked
  const [actionError, setActionError] = useState('');

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/users');
    if (res.ok) {
      const { users: rawUsers, subscriptions } = await res.json();

      // Build subscriptions map
      const map: Record<string, Subscription[]> = {};
      for (const sub of subscriptions) {
        if (!map[sub.user_id]) map[sub.user_id] = [];
        map[sub.user_id].push(sub);
      }
      setSubsMap(map);

      setUsers(rawUsers.map((u: User) => ({
        ...u,
        total_tests: u.total_tests_taken ?? 0,
        avg_score: 0,
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const stats = useMemo(() => ({
    total: users.length,
    students: users.filter(u => u.role === 'student').length,
    admins: users.filter(u => u.role === 'admin').length,
    freePasses: Object.values(subsMap).flat().filter(isFreePass).length,
  }), [users, subsMap]);

  const filteredUsers = users
    .filter(u => roleFilter === 'all' || u.role === roleFilter)
    .filter(u => !freePassOnly || (subsMap[u.id] ?? []).some(isFreePass))
    .filter(u =>
      u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.student_id?.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const modalSubs = modalUser ? (subsMap[modalUser.id] ?? []) : [];

  const handleGrantFreePass = async () => {
    if (!modalUser) return;
    setGranting(true);
    setActionError('');
    const res = await fetch('/api/admin/free-pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: modalUser.id, level: grantLevel, semester: grantSemester }),
    });
    const json = await res.json();
    if (!res.ok) {
      setActionError(json.error ?? 'Failed to grant free pass');
    } else {
      await fetchUsers();
    }
    setGranting(false);
  };

  const handleRevoke = async (sub: Subscription) => {
    if (!modalUser) return;
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
      await fetchUsers();
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
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="text-gray-600">{stats.total} registered accounts — students and admins</p>
      </div>

      {/* Stat summary — each is a filter shortcut into the table below */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <button
          onClick={() => { setRoleFilter('all'); setFreePassOnly(false); setCurrentPage(1); }}
          className={`text-left rounded-xl transition-shadow ${roleFilter === 'all' && !freePassOnly ? 'ring-2 ring-gray-300' : ''}`}
        >
          <Card className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
              <UsersIcon className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900 leading-tight">{stats.total}</p>
              <p className="text-xs text-gray-500">Total users</p>
            </div>
          </Card>
        </button>
        <button
          onClick={() => { setRoleFilter('student'); setFreePassOnly(false); setCurrentPage(1); }}
          className={`text-left rounded-xl transition-shadow ${roleFilter === 'student' && !freePassOnly ? 'ring-2 ring-blue-300' : ''}`}
        >
          <Card className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <GraduationCap className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900 leading-tight">{stats.students}</p>
              <p className="text-xs text-gray-500">Students</p>
            </div>
          </Card>
        </button>
        <button
          onClick={() => { setRoleFilter('admin'); setFreePassOnly(false); setCurrentPage(1); }}
          className={`text-left rounded-xl transition-shadow ${roleFilter === 'admin' && !freePassOnly ? 'ring-2 ring-purple-300' : ''}`}
        >
          <Card className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900 leading-tight">{stats.admins}</p>
              <p className="text-xs text-gray-500">Admins</p>
            </div>
          </Card>
        </button>
        <button
          onClick={() => { setFreePassOnly(v => !v); setCurrentPage(1); }}
          className={`text-left rounded-xl transition-shadow ${freePassOnly ? 'ring-2 ring-green-400' : ''}`}
          title="Show only users with an active free pass"
        >
          <Card className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
              <Gift className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900 leading-tight">{stats.freePasses}</p>
              <p className="text-xs text-gray-500">{freePassOnly ? 'Showing free passes' : 'Active free passes'}</p>
            </div>
          </Card>
        </button>
      </div>

      {freePassOnly && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-4 py-2.5">
          <Gift className="w-4 h-4 flex-shrink-0" />
          Showing only users with an active free pass.
          <button onClick={() => setFreePassOnly(false)} className="ml-auto text-green-800 font-medium hover:underline">
            Clear
          </button>
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative sm:max-w-sm w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name, email, or student ID..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="pl-10"
            />
          </div>

          <div className="inline-flex p-1 bg-gray-100 rounded-lg self-start sm:self-auto">
            {roleTabs.map(tab => {
              const active = roleFilter === tab.key;
              const count = tab.key === 'all' ? stats.total : tab.key === 'student' ? stats.students : stats.admins;
              return (
                <button
                  key={tab.key}
                  onClick={() => { setRoleFilter(tab.key); setCurrentPage(1); }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                  <span className={`text-xs ${active ? 'text-gray-400' : 'text-gray-400'}`}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Users Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">User</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Role</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Programme</th>
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
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400 text-sm">
                    Loading users…
                  </td>
                </tr>
              ) : paginatedUsers.map((user) => {
                const subs = subsMap[user.id] ?? [];
                const isAdmin = user.role === 'admin';
                return (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <Avatar
                            src={user.avatar_url}
                            name={user.full_name || user.email}
                            size="md"
                          />
                          {isAdmin && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-purple-600 border-2 border-white flex items-center justify-center">
                              <Shield className="w-2 h-2 text-white" />
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{user.full_name || 'No Name'}</p>
                          <p className="text-sm text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={isAdmin ? 'info' : 'default'} className={isAdmin ? '!bg-purple-100 !text-purple-700' : ''}>
                        {isAdmin ? <Shield className="w-3 h-3 mr-1" /> : <GraduationCap className="w-3 h-3 mr-1" />}
                        {isAdmin ? 'Admin' : 'Student'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      {user.student_id && (
                        <p className="text-xs text-gray-400 mb-0.5">{user.student_id}</p>
                      )}
                      {user.program ? (
                        <span className="text-sm text-gray-700">{user.program}</span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">{isAdmin ? '—' : 'Not set'}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Target className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">{user.total_tests_taken ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Flame className={`w-4 h-4 ${user.practice_streak > 0 ? 'text-orange-500' : 'text-gray-300'}`} />
                        <span className={`font-medium ${user.practice_streak > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                          {user.practice_streak}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-medium text-purple-600">{user.xp}</span>
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
                        onClick={() => { setModalUser(user); setActionError(''); }}
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

        {!loading && filteredUsers.length === 0 && (
          <div className="text-center py-12 text-gray-500">No users found</div>
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

      {/* Manage Access Modal */}
      <Modal
        isOpen={!!modalUser}
        onClose={() => { setModalUser(null); setActionError(''); }}
        title="Manage Access"
      >
        {modalUser && (
          <div className="space-y-5">
            {/* User identity */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <Avatar src={modalUser.avatar_url} name={modalUser.full_name || modalUser.email} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 truncate">{modalUser.full_name || 'No Name'}</p>
                  <Badge
                    size="sm"
                    variant={modalUser.role === 'admin' ? 'info' : 'default'}
                    className={modalUser.role === 'admin' ? '!bg-purple-100 !text-purple-700' : ''}
                  >
                    {modalUser.role === 'admin' ? 'Admin' : 'Student'}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500 truncate">{modalUser.email}</p>
              </div>
            </div>

            {modalUser.role === 'admin' && (
              <div className="flex items-start gap-2 p-3 bg-purple-50 border border-purple-100 rounded-xl text-xs text-purple-700">
                <Shield className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>This is an admin account. You can still grant it a free pass to test or preview student-side course access.</span>
              </div>
            )}

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
