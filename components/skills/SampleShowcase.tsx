import Image from 'next/image';
import { ArrowUpRight, Bot, MessageCircle } from 'lucide-react';

// "See a real example": a screenshot of the sample site, or for a WhatsApp
// link, a chat card that opens the demo bot.

const SCREENSHOTS: Record<string, string> = {
  'pastcs.com': '/skills/sample-pastcs.jpg',
  'nyansaai.com': '/skills/sample-nyansaai.jpg',
};

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// wa.me/233270000004 -> +233 27 000 0004
export function whatsappNumber(url: string): string | null {
  const m = /^https:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\d{9,15})/.exec(url);
  if (!m) return null;
  const d = m[1];
  if (d.startsWith('233') && d.length === 12) return `+233 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

export function SampleShowcase({ url, label }: { url: string; label: string | null }) {
  const host = hostOf(url);
  const phone = whatsappNumber(url);

  if (phone) {
    return (
      <section className="rounded-[20px] border border-[#efe2d0] bg-[#fffdf9] overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-5 p-6 items-center">
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-[#e8603c] mb-2">Try a real one</p>
            <h2 className="text-xl font-extrabold text-[#2b2420] mb-2">Chat with our demo bot</h2>
            <p className="text-sm text-[#8a7f6f] leading-relaxed mb-4">{label || 'Send it a message on WhatsApp and see what you’ll build.'}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-2xl bg-[#25a366] hover:bg-[#1e8a56] px-5 py-3 text-sm font-bold text-white transition-colors"
            >
              <MessageCircle className="w-4 h-4" /> Message {phone}
            </a>
          </div>
          <div className="hidden sm:block w-48 rounded-2xl bg-[#efe7dd] shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2">
              <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-white" /></span>
              <p className="text-[11px] font-bold text-white truncate">{phone}</p>
            </div>
            <div className="p-3 space-y-1.5 text-[10.5px] leading-snug">
              <p className="ml-auto w-fit rounded-lg rounded-tr-none bg-[#dcf8c6] px-2 py-1">Hi 👋🏾</p>
              <p className="w-fit max-w-[90%] rounded-lg rounded-tl-none bg-white px-2 py-1">Hello! I’m a demo bot. Ask me anything about the shop.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const shot = SCREENSHOTS[host];
  return (
    <section className="rounded-[20px] border border-[#efe2d0] bg-[#fffdf9] overflow-hidden">
      <div className="p-6 pb-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-[#e8603c] mb-2">A real example</p>
        <h2 className="text-xl font-extrabold text-[#2b2420] mb-1.5 break-words">{host || 'See it live'}</h2>
        {label && <p className="text-sm text-[#8a7f6f] leading-relaxed">{label}</p>}
      </div>
      {shot && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block px-6">
          <div className="rounded-t-xl border border-b-0 border-[#efe2d0] overflow-hidden shadow-sm">
            <div className="flex items-center gap-1.5 bg-[#f7ede1] px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-[#e8cdb5]" />
              <span className="w-2 h-2 rounded-full bg-[#e8cdb5]" />
              <span className="w-2 h-2 rounded-full bg-[#e8cdb5]" />
              <span className="mx-auto text-[10.5px] text-[#a89a86] truncate">{host}</span>
            </div>
            <Image src={shot} alt={`Screenshot of ${host}`} width={1280} height={800} className="w-full h-auto" sizes="(max-width: 1024px) 100vw, 640px" />
          </div>
        </a>
      )}
      <div className={`px-6 py-4 ${shot ? 'border-t border-[#efe2d0]' : ''}`}>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-bold text-[#e8603c] hover:underline">
          Visit {host || 'the example'} <ArrowUpRight className="w-4 h-4" />
        </a>
      </div>
    </section>
  );
}
