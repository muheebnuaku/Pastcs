'use client';

import { useRef, useState } from 'react';
import type { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/ui';
import { Camera, Loader2, X } from 'lucide-react';

// Referencing the return type of our own client factory (rather than
// importing SupabaseClient from @supabase/supabase-js directly) avoids
// a real cross-version generic mismatch — see lib/gamification.ts.
type Db = ReturnType<typeof createClient>;

interface AvatarUploadProps {
  supabase: Db;
  userId: string;
  avatarUrl: string | null;
  name: string;
  onChange: (url: string | null) => void;
}

const MAX_SIZE_MB = 5;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// One fixed path per user (no extension — Content-Type carries the type),
// so every re-upload overwrites the last one instead of piling up files.
function avatarPath(userId: string) {
  return `${userId}/avatar`;
}

export function AvatarUpload({ supabase, userId, avatarUrl, name, onChange }: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (file: File) => {
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please choose a JPEG, PNG, WEBP, or GIF image.');
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`Image must be under ${MAX_SIZE_MB}MB.`);
      return;
    }

    setIsBusy(true);
    try {
      const path = avatarPath(userId);
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      // The path never changes on re-upload, so bust any CDN/browser cache
      // with a version query param — otherwise the old image keeps showing.
      const bustedUrl = `${data.publicUrl}?v=${Date.now()}`;

      const { error: dbError } = await supabase
        .from('users')
        .update({ avatar_url: bustedUrl })
        .eq('id', userId);
      if (dbError) throw dbError;

      onChange(bustedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setIsBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    setError('');
    setIsBusy(true);
    try {
      await supabase.storage.from('avatars').remove([avatarPath(userId)]);

      const { error: dbError } = await supabase
        .from('users')
        .update({ avatar_url: null })
        .eq('id', userId);
      if (dbError) throw dbError;

      onChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove image.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div>
      <div className="relative w-fit">
        <Avatar src={avatarUrl} name={name} size="xl" />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isBusy}
          className="absolute -bottom-1 -right-1 w-7 h-7 bg-[#e8603c] hover:bg-[#c94f2f] text-white rounded-full flex items-center justify-center shadow-md ring-2 ring-white dark:ring-[#16140f] disabled:opacity-50 transition-colors"
          aria-label={avatarUrl ? 'Change profile picture' : 'Add profile picture'}
        >
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
        </button>

        {avatarUrl && !isBusy && (
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-1 -right-1 w-5 h-5 bg-gray-700 hover:bg-red-600 dark:bg-white/20 dark:hover:bg-red-500 text-white rounded-full flex items-center justify-center shadow-md ring-2 ring-white dark:ring-[#16140f] transition-colors"
            aria-label="Remove profile picture"
          >
            <X className="w-3 h-3" />
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && <p className="text-xs text-red-500 dark:text-red-400 mt-1.5 max-w-[160px]">{error}</p>}
    </div>
  );
}
