'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, Button, Input, Badge, Avatar, Loading } from '@/components/ui';
import { formatPercentage } from '@/lib/utils';
import type { User } from '@/types';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Target,
  Flame,
} from 'lucide-react';

interface StudentData extends User {
  total_tests: number;
  avg_score: number;
}

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<StudentData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    const fetchStudents = async () => {
      const supabase = createClient();

      const { data: usersData } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'student')
        .order('created_at', { ascending: false });

      if (usersData) {
        // Fetch test statistics for each student
        const studentsWithStats = await Promise.all(
          usersData.map(async (user) => {
            const { data: tests } = await supabase
              .from('tests')
              .select('percentage')
              .eq('user_id', user.id);

            const total_tests = tests?.length || 0;
            const avg_score = tests && tests.length > 0
              ? tests.reduce((acc, t) => acc + (t.percentage || 0), 0) / tests.length
              : 0;

            return {
              ...user,
              total_tests,
              avg_score,
            };
          })
        );

        setStudents(studentsWithStats);
      }

      setIsLoading(false);
    };

    fetchStudents();
  }, []);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loading size="lg" text="Loading students..." />
      </div>
    );
  }

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
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
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
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Avg Score</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">Streak</th>
                <th className="text-center px-6 py-4 text-sm font-medium text-gray-500">XP</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-500">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginatedStudents.map((student) => (
                <tr key={student.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={student.avatar_url}
                        name={student.full_name || student.email}
                        size="md"
                      />
                      <div>
                        <p className="font-medium text-gray-900">
                          {student.full_name || 'No Name'}
                        </p>
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
                      <span className="font-medium">{student.total_tests}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Badge
                      variant={
                        student.avg_score >= 70 ? 'success' :
                        student.avg_score >= 50 ? 'warning' : 'error'
                      }
                    >
                      {formatPercentage(student.avg_score)}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Flame className={`w-4 h-4 ${
                        student.practice_streak > 0 ? 'text-orange-500' : 'text-gray-300'
                      }`} />
                      <span className={`font-medium ${
                        student.practice_streak > 0 ? 'text-orange-600' : 'text-gray-400'
                      }`}>
                        {student.practice_streak}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-medium text-purple-600">{student.xp}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-gray-500">
                      {new Date(student.created_at).toLocaleDateString()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredStudents.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No students found
          </div>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
