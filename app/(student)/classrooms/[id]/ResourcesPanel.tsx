'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button, Input } from '@/components/ui';
import type { ClassroomMemberProgress } from '@/lib/classrooms';
import { Link2, FileText, Upload, Trash2, ExternalLink, Loader2, FolderOpen } from 'lucide-react';

interface Resource {
  id: string;
  classroom_id: string;
  user_id: string;
  title: string;
  kind: 'link' | 'file';
  url: string | null;
  file_path: string | null;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

interface Props {
  classroomId: string;
  myId: string;
  myName: string;
  members: ClassroomMemberProgress[];
  canModerate: boolean;
}

const BUCKET = 'classroom-files';
const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = '.pdf,.pptx,.ppt,.docx,.doc,.png,.jpg,.jpeg,.webp,.txt';

function sizeLabel(bytes: number | null): string {
  if (!bytes) return '';
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ResourcesPanel({ classroomId, myId, myName, members, canModerate }: Props) {
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'link' | 'file'>('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('classroom_resources')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false });
    setItems((data ?? []) as Resource[]);
    setLoading(false);
  }, [classroomId]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (userId: string) => members.find(m => m.user_id === userId)?.full_name || 'A classmate';

  const share = async () => {
    setError('');
    const cleanTitle = title.trim() || file?.name || '';
    if (!cleanTitle) { setError('Give it a title.'); return; }
    const supabase = createClient();
    setSaving(true);
    try {
      let row: Partial<Resource>;
      if (mode === 'link') {
        const link = url.trim();
        if (!/^https?:\/\/\S+\.\S+/.test(link)) { setError('Paste a full web link starting with https://'); return; }
        row = { kind: 'link', url: link };
      } else {
        if (!file) { setError('Choose a file to upload.'); return; }
        if (file.size > MAX_BYTES) { setError('Files can be up to 15 MB.'); return; }
        const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
        const path = `${classroomId}/${crypto.randomUUID()}-${safe}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (upErr) {
          setError(/mime|type/i.test(upErr.message) ? 'That file type isn’t supported. Use PDF, slides, Word, images or text.' : 'Upload failed. Please try again.');
          return;
        }
        row = { kind: 'file', file_path: path, file_size: file.size, mime_type: file.type || null };
      }
      const { data, error: insErr } = await supabase
        .from('classroom_resources')
        .insert({ ...row, classroom_id: classroomId, user_id: myId, title: cleanTitle.slice(0, 120) })
        .select()
        .single();
      if (insErr || !data) { setError('Could not share it. Please try again.'); return; }
      // Let the class know in the chat.
      await supabase.from('classroom_messages').insert({
        classroom_id: classroomId, user_id: myId, kind: 'resource',
        body: `${myName} shared “${cleanTitle.slice(0, 120)}”`, meta: { resource_id: (data as Resource).id },
      });
      setTitle(''); setUrl(''); setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setItems(prev => [data as Resource, ...prev]);
    } finally {
      setSaving(false);
    }
  };

  const open = async (r: Resource) => {
    if (r.kind === 'link' && r.url) { window.open(r.url, '_blank', 'noopener,noreferrer'); return; }
    if (!r.file_path) return;
    // Open the tab first (popup blockers allow it only inside the tap),
    // then point it at a short-lived private link.
    const tab = window.open('', '_blank');
    const { data } = await createClient().storage.from(BUCKET).createSignedUrl(r.file_path, 300);
    if (data?.signedUrl && tab) tab.location.href = data.signedUrl;
    else if (data?.signedUrl) window.location.href = data.signedUrl;
    else tab?.close();
  };

  const remove = async (r: Resource) => {
    if (!window.confirm(`Remove “${r.title}”?`)) return;
    const supabase = createClient();
    const { error: delErr } = await supabase.from('classroom_resources').delete().eq('id', r.id);
    if (delErr) return;
    if (r.file_path) await supabase.storage.from(BUCKET).remove([r.file_path]);
    setItems(prev => prev.filter(x => x.id !== r.id));
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:bg-white/[0.04] dark:border-white/10">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Share with the class</h2>
        <p className="text-xs text-gray-500 mb-3 dark:text-gray-400">Slides, past questions, notes or a useful video. Only classroom members can open them.</p>
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100 mb-3 dark:bg-white/10">
          {([['link', 'Link', Link2], ['file', 'File', Upload]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => { setMode(key); setError(''); }}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium ${
                mode === key ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title, e.g. Week 5 slides" maxLength={120} />
          {mode === 'link' ? (
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
          ) : (
            <label className="flex items-center gap-3 px-3 py-3 rounded-xl border border-dashed border-gray-300 cursor-pointer hover:border-blue-400 dark:border-white/15">
              <Upload className="w-5 h-5 text-gray-400 flex-shrink-0 dark:text-gray-500" />
              <span className="text-sm text-gray-600 truncate dark:text-gray-300">{file ? `${file.name} · ${sizeLabel(file.size)}` : 'Choose a PDF, slides, Word file or image (max 15 MB)'}</span>
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); }} />
            </label>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button onClick={share} isLoading={saving} className="w-full sm:w-auto">Share</Button>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-gray-900 mb-3 dark:text-gray-100">Class resources</h2>
        {loading ? (
          <div className="flex items-center text-sm text-gray-500 dark:text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center dark:border-white/15">
            <FolderOpen className="w-9 h-9 text-gray-300 mx-auto mb-2 dark:text-gray-600" />
            <p className="font-semibold text-gray-900 dark:text-gray-100">Nothing shared yet</p>
            <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Be the first to share slides or notes with your class.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden dark:bg-white/[0.04] dark:border-white/10 dark:divide-white/10">
            {items.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  r.kind === 'link' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400' : 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400'
                }`}>
                  {r.kind === 'link' ? <Link2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                </span>
                <button onClick={() => open(r)} className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-medium text-gray-900 truncate dark:text-gray-100">{r.title}</p>
                  <p className="text-xs text-gray-500 truncate dark:text-gray-400">
                    {nameOf(r.user_id)} · {new Date(r.created_at).toLocaleDateString()}{r.file_size ? ` · ${sizeLabel(r.file_size)}` : ''}
                  </p>
                </button>
                <button onClick={() => open(r)} aria-label={`Open ${r.title}`} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10">
                  <ExternalLink className="w-4 h-4" />
                </button>
                {(r.user_id === myId || canModerate) && (
                  <button onClick={() => remove(r)} aria-label={`Remove ${r.title}`} className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
