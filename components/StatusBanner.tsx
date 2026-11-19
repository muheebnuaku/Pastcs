'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { clock } from '@/lib/status';
import { AlertTriangle, Wrench, X } from 'lucide-react';

// A strip across the top of the app while something students would notice
// is broken, or maintenance is under way (get_status_banner, migration
// 054). Links to the status page. Dismissing hides that incident for this
// visit only.

interface Banner { id: string; title: string; impact: string; status: string; expected_fix_at: string | null; is_maintenance: boolean }

const STATUS_URL = 'https://status.pastcs.com';

export function StatusBanner() {
  const [items, setItems] = useState<Banner[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      createClient().rpc('get_status_banner').then(({ data, error }: { data: Banner[] | null; error: unknown }) => {
        if (alive && !error) setItems(data ?? []);
      });
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const shown = items.find(i => !hidden.includes(i.id));
  if (!shown) return null;

  const href = typeof window !== 'undefined' && window.location.hostname.endsWith('pastcs.com') ? STATUS_URL : '/status';
  const Icon = shown.is_maintenance ? Wrench : AlertTriangle;
  const tone = shown.is_maintenance ? 'bg-[#2563eb]' : shown.impact === 'critical' ? 'bg-[#d93b3b]' : 'bg-[#e8700c]';

  return (
    <div role="status" className={`${tone} text-white text-sm`}>
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2.5">
        <Icon className="w-4 h-4 flex-shrink-0" />
        <p className="flex-1 min-w-0">
          <span className="font-semibold">{shown.title}.</span>{' '}
          {shown.expected_fix_at && <span>{shown.is_maintenance ? 'Until' : 'Expected fix by'} {clock(shown.expected_fix_at)} GMT. </span>}
          <a href={href} className="underline font-semibold whitespace-nowrap">See status</a>
        </p>
        <button onClick={() => setHidden(h => [...h, shown.id])} aria-label="Hide this notice" className="p-1 rounded hover:bg-white/15 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
