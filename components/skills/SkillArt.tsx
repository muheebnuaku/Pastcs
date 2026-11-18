import { Bot, FileSpreadsheet, Mail, Sparkles } from 'lucide-react';

// The picture at the top of a skill course: the admin's uploaded image if
// there is one, otherwise a drawing of what the course builds: an AI
// writing code, an automation flow, or a WhatsApp bot chat.

export type SkillKind = 'code' | 'flow' | 'bot';

export function skillKind(slug: string): SkillKind {
  if (slug.includes('whatsapp') || slug.includes('bot')) return 'bot';
  if (slug.includes('cod')) return 'code';
  return 'flow';
}

export function SkillArt({ slug, title, imageUrl, size = 'card' }: { slug: string; title: string; imageUrl: string | null; size?: 'card' | 'hero' }) {
  const h = size === 'hero' ? 'h-56 sm:h-72' : 'h-40';
  if (imageUrl) {
    return (
      <div className={`${h} w-full overflow-hidden bg-[#f7ede1]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
      </div>
    );
  }
  const kind = skillKind(slug);
  return (
    <div className={`${h} w-full overflow-hidden relative`} role="img" aria-label={`${title} illustration`}>
      {kind === 'code' && <CodeArt big={size === 'hero'} />}
      {kind === 'flow' && <FlowArt big={size === 'hero'} />}
      {kind === 'bot' && <BotArt big={size === 'hero'} />}
    </div>
  );
}

function CodeArt({ big }: { big: boolean }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#fde3da] to-[#f9c9b6] flex items-center justify-center p-4">
      <div className={`w-full ${big ? 'max-w-md' : 'max-w-[300px]'} rounded-xl bg-[#1f1b18] shadow-xl overflow-hidden rotate-[-2deg]`}>
        <div className="flex items-center gap-1.5 px-3 py-2 bg-[#2b2420]">
          <span className="w-2 h-2 rounded-full bg-[#e8603c]" />
          <span className="w-2 h-2 rounded-full bg-[#dba514]" />
          <span className="w-2 h-2 rounded-full bg-[#2f9e8f]" />
          <span className="ml-2 text-[10px] text-[#a89a86] font-mono">app/page.tsx</span>
        </div>
        <div className={`px-3 ${big ? 'py-4 space-y-2' : 'py-2.5 space-y-1.5'} font-mono text-[10px] leading-none`}>
          <div className="flex items-center gap-1.5 rounded-md bg-[#e8603c]/20 px-2 py-1.5 text-[#ffb59c]">
            <Sparkles className="w-3 h-3 flex-shrink-0" /> <span className="truncate">“Build a quiz app for my class”</span>
          </div>
          <p><span className="text-[#c792ea]">export</span> <span className="text-[#82aaff]">function</span> <span className="text-[#ffcb6b]">Quiz</span><span className="text-[#d6cfc6]">() {'{'}</span></p>
          <p className="pl-3"><span className="text-[#c792ea]">const</span> <span className="text-[#d6cfc6]">[score, setScore] =</span> <span className="text-[#82aaff]">useState</span><span className="text-[#d6cfc6]">(0)</span></p>
          <p className="pl-3"><span className="text-[#c792ea]">return</span> <span className="text-[#89ddff]">&lt;Question</span> <span className="text-[#ffcb6b]">onRight</span><span className="text-[#d6cfc6]">=…</span><span className="text-[#89ddff]">/&gt;</span></p>
          {big && <p className="pl-3 text-[#6f6458]">{'// '}AI wrote this. You steer it.</p>}
          <p className="text-[#d6cfc6]">{'}'}</p>
        </div>
      </div>
    </div>
  );
}

function FlowArt({ big }: { big: boolean }) {
  const node = 'flex flex-col items-center gap-1.5 rounded-xl bg-white shadow-md px-3 py-2.5 text-[10px] font-bold text-[#2b2420] flex-shrink-0';
  const icon = big ? 'w-6 h-6' : 'w-5 h-5';
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#dcf1ee] to-[#b9e3dc] flex items-center justify-center p-4">
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <div className={node}><Mail className={`${icon} text-[#e8603c]`} />New email</div>
        <Arrow />
        <div className={`${node} ring-2 ring-[#2f9e8f]`}><Sparkles className={`${icon} text-[#2f9e8f]`} />AI sorts it</div>
        <Arrow />
        <div className={node}><FileSpreadsheet className={`${icon} text-[#1e8a56]`} />Saved to sheet</div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" className="flex-shrink-0" aria-hidden>
      <path d="M1 5h17M14 1l5 4-5 4" fill="none" stroke="#2f9e8f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0" />
    </svg>
  );
}

function BotArt({ big }: { big: boolean }) {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-[#fbe9b8] to-[#f3d27a] flex items-center justify-center p-4">
      <div className={`w-full ${big ? 'max-w-sm' : 'max-w-[260px]'} rounded-2xl bg-[#efe7dd] shadow-xl overflow-hidden rotate-[1.5deg]`}>
        <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2">
          <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-white" /></span>
          <div className="leading-none">
            <p className="text-[11px] font-bold text-white">Ama’s Salon</p>
            <p className="text-[9px] text-white/70 mt-0.5">bot · online</p>
          </div>
        </div>
        <div className={`px-3 ${big ? 'py-4 space-y-2' : 'py-2.5 space-y-1.5'} text-[10.5px] leading-snug`}>
          <p className="ml-auto w-fit max-w-[80%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-2 py-1 text-[#1f2c22]">How much for braids?</p>
          <p className="w-fit max-w-[85%] rounded-lg rounded-tl-none bg-white px-2 py-1 text-[#1f2c22]">Knotless braids are GHC 250. Want to book Saturday? 💇🏾‍♀️</p>
          {big && <p className="ml-auto w-fit max-w-[80%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-2 py-1 text-[#1f2c22]">Yes, 10am please</p>}
        </div>
      </div>
    </div>
  );
}
