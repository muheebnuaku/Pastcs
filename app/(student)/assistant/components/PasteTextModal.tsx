'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardPaste, X } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSubmit: (text: string) => void;
}

const MIN_CHARS = 40;

/** Alternative to "Upload Doc" for a student who has notes as plain text —
 * pasted from a WhatsApp forward, an old assignment, a textbook excerpt —
 * rather than as a PDF/Word/PowerPoint file. Feeds the same generate-lesson
 * pipeline the file-upload path uses, just skipping the parse-pdf step
 * since there's no file to extract text from in the first place. */
export function PasteTextModal({ onClose, onSubmit }: Props) {
  const [text, setText] = useState('');
  const tooShort = text.trim().length > 0 && text.trim().length < MIN_CHARS;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 py-8 sm:py-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <ClipboardPaste className="w-5 h-5 text-blue-600" />
              Paste your notes
            </h2>
            <p className="text-sm text-gray-500 mt-1">No document handy? Paste any text — notes, a textbook excerpt, a WhatsApp forward — and get a full AI lesson from it.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 -m-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-3">
          <textarea
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste your text here…"
            rows={10}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
          <div className="flex items-center justify-between">
            <p className={`text-xs ${tooShort ? 'text-amber-500' : 'text-gray-400'}`}>
              {tooShort ? `A bit more detail helps — at least ${MIN_CHARS} characters.` : `${text.trim().length} characters`}
            </p>
            <button
              onClick={() => onSubmit(text.trim())}
              disabled={text.trim().length < MIN_CHARS}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Create Lesson
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
