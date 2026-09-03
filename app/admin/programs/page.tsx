'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, Button, Input, Modal, Badge } from '@/components/ui';
import type { Program } from '@/types';
import { Plus, Edit, Trash2, Layers, BookOpen } from 'lucide-react';

export default function AdminProgramsPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [courseCounts, setCourseCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [name, setName] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fetchPrograms = async () => {
    setIsLoading(true);
    const supabase = createClient();
    const [{ data: programsData }, { data: courseProgramsData }] = await Promise.all([
      supabase.from('programs').select('*').order('name'),
      supabase.from('course_programs').select('program_id'),
    ]);

    if (programsData) setPrograms(programsData);
    if (courseProgramsData) {
      const counts: Record<string, number> = {};
      for (const row of courseProgramsData as { program_id: string }[]) {
        counts[row.program_id] = (counts[row.program_id] ?? 0) + 1;
      }
      setCourseCounts(counts);
    }
    setIsLoading(false);
  };

  useEffect(() => { fetchPrograms(); }, []);

  const openModal = (program?: Program) => {
    setSaveError('');
    if (program) {
      setEditingProgram(program);
      setName(program.name);
      setShortCode(program.short_code);
    } else {
      setEditingProgram(null);
      setName('');
      setShortCode('');
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !shortCode.trim()) {
      setSaveError('Both name and short code are required.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const supabase = createClient();

    const payload = { name: name.trim(), short_code: shortCode.trim().toUpperCase() };
    const { error } = editingProgram
      ? await supabase.from('programs').update(payload).eq('id', editingProgram.id)
      : await supabase.from('programs').insert(payload);

    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setShowModal(false);
    fetchPrograms();
  };

  const handleDelete = async (program: Program) => {
    const courseCount = courseCounts[program.id] ?? 0;
    if (!confirm(
      courseCount > 0
        ? `${program.name} has ${courseCount} course${courseCount !== 1 ? 's' : ''} assigned. Delete anyway? This only removes the program — courses themselves aren't deleted.`
        : `Delete ${program.name}?`
    )) return;

    const supabase = createClient();
    const { error } = await supabase.from('programs').delete().eq('id', program.id);
    if (error) {
      // Most likely a student or subscription still references this program
      // (no cascade there on purpose — deleting a program in active use
      // shouldn't silently orphan anyone).
      alert(`Couldn't delete: ${error.message}`);
      return;
    }
    fetchPrograms();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Programs</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Which programme a student picks decides which courses they see — assign courses to a program from the Courses page.
          </p>
        </div>
        <Button onClick={() => openModal()}>
          <Plus className="w-4 h-4 mr-2" />
          Add Program
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500">Loading…</div>
      ) : programs.length === 0 ? (
        <Card>
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <Layers className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No programs yet</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {programs.map(program => (
            <Card key={program.id}>
              <div className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{program.name}</h3>
                      <Badge variant="default" size="sm">{program.short_code}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                      <BookOpen className="w-3 h-3" />
                      {courseCounts[program.id] ?? 0} course{(courseCounts[program.id] ?? 0) !== 1 ? 's' : ''} assigned
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openModal(program)}>
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(program)}>
                    <Trash2 className="w-4 h-4 text-red-500 dark:text-red-400" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingProgram ? 'Edit Program' : 'Add Program'}
      >
        <div className="space-y-4">
          {saveError && (
            <div className="p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg text-sm text-red-700 dark:text-red-400">
              {saveError}
            </div>
          )}
          <Input
            label="Program Name"
            placeholder="e.g., BSc Business Administration"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Short Code"
            placeholder="e.g., BUS"
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value)}
          />
          <div className="flex gap-3 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editingProgram ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
