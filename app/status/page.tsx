import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import {
  IMPACT_COLOUR, IMPACT_LABEL, OVERALL_HEADLINE, STATE_COLOUR, STATE_LABEL, STATUS_LABEL,
  clock, dayLabel, fromNow, lasted, overallState, stamp,
  type Incident, type StatusPageData,
} from '@/lib/status';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Wrench, XCircle } from 'lucide-react';
import { UptimeBars, AutoRefresh } from './client';

// status.pastcs.com (proxy.ts rewrites that host to here) and
// pastcs.com/status. Everything comes from get_status_page() (migration 054).

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'PastCS Status',
  description: 'Is PastCS working? Live status, uptime and incident updates.',
};

async function load(): Promise<StatusPageData | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_status_page');
    if (error) {
      console.error('[status] get_status_page failed', error.message);
      return null;
    }
    return data as StatusPageData;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const data = await load();
  // "Now" is when the database answered, so the page renders the same way
  // every time for the same data.
  const now = data ? new Date(data.generated_at).getTime() : 0;

  return (
    <div className="font-jakarta min-h-screen bg-[#fdf8f2] text-[#2b2420]">
      <AutoRefresh seconds={60} />
      <header className="border-b border-[#efe2d0] bg-[#fffdf9]">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <a href="https://pastcs.com" className="flex items-center gap-2.5 min-w-0">
            <Image src="/past.png" alt="" width={64} height={64} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            <span className="font-extrabold tracking-tight truncate">PastCS <span className="font-semibold text-[#8a7f6f]">Status</span></span>
          </a>
          <a href="https://pastcs.com" className="text-sm font-semibold text-[#e8603c] hover:underline flex-shrink-0">Go to PastCS</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {!data ? (
          <section className="rounded-2xl border border-[#f3c2c2] bg-[#fdeaea] p-6">
            <div className="flex items-center gap-2 font-extrabold text-[#b42318] text-lg"><XCircle className="w-6 h-6" /> We can’t check our systems right now</div>
            <p className="mt-2 text-sm text-[#7a2e2e]">This usually means a major problem with our database. We’re on it. This page will update itself.</p>
          </section>
        ) : (
          <>
            <Overall data={data} />

            {data.active.map(i => <IncidentCard key={i.id} incident={i} now={now} live />)}

            {data.maintenance.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-[#8a7f6f]">Planned maintenance</h2>
                {data.maintenance.map(i => <IncidentCard key={i.id} incident={i} now={now} live />)}
              </section>
            )}

            <section className="rounded-2xl border border-[#efe2d0] bg-[#fffdf9] divide-y divide-[#f3e9db]">
              {data.components.map(c => (
                <div key={c.key} className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">{c.name}</p>
                      <p className="text-xs text-[#8a7f6f] mt-0.5">{c.description}</p>
                    </div>
                    <span className="flex items-center gap-1.5 text-sm font-semibold flex-shrink-0" style={{ color: STATE_COLOUR[c.state] }}>
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATE_COLOUR[c.state] }} />
                      {STATE_LABEL[c.state]}
                    </span>
                  </div>
                  <UptimeBars days={c.days} />
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#a89a86]">
                    <span><span className="sm:hidden">30</span><span className="hidden sm:inline">90</span> days ago</span>
                    <span className="font-semibold text-[#8a7f6f]">{c.uptime === null ? 'No data yet' : `${c.uptime}% uptime`}</span>
                    <span>Today</span>
                  </div>
                </div>
              ))}
            </section>

            <History incidents={data.history} now={now} />

            <p className="text-center text-xs text-[#a89a86]">
              Checked automatically every 5 minutes. Times are Ghana time (GMT). Updated {clock(data.generated_at)}.
            </p>
          </>
        )}
      </main>

      <footer className="border-t border-[#efe2d0] py-6 text-center text-xs text-[#a89a86]">
        <Link href="/" className="hover:text-[#2b2420]">PastCS</Link> · Built for University of Ghana Computer Science students
      </footer>
    </div>
  );
}

function Overall({ data }: { data: StatusPageData }) {
  const state = overallState(data.components);
  const colour = STATE_COLOUR[state];
  const Icon = state === 'operational' ? CheckCircle2 : state === 'maintenance' ? Wrench : AlertTriangle;
  return (
    <section className="rounded-2xl p-5 sm:p-6 text-white flex items-center gap-3 shadow-sm" style={{ background: colour }}>
      <Icon className="w-7 h-7 flex-shrink-0" />
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-extrabold leading-tight">{OVERALL_HEADLINE[state]}</h1>
        {state !== 'operational' && data.active[0]?.expected_fix_at && (
          <p className="text-sm text-white/90 mt-0.5">Expected fix by {clock(data.active[0].expected_fix_at)} GMT</p>
        )}
      </div>
    </section>
  );
}

function IncidentCard({ incident: i, now, live = false }: { incident: Incident; now: number; live?: boolean }) {
  const colour = IMPACT_COLOUR[i.impact];
  return (
    <article className="rounded-2xl border bg-[#fffdf9] overflow-hidden" style={{ borderColor: live ? colour : '#efe2d0' }}>
      <div className="px-5 py-4" style={live ? { background: `${colour}14` } : undefined}>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full text-white" style={{ background: colour }}>
            {i.is_maintenance ? 'Maintenance' : IMPACT_LABEL[i.impact]}
          </span>
          <span className="text-xs font-semibold text-[#8a7f6f]">{STATUS_LABEL[i.status]}</span>
        </div>
        <h2 className="text-lg font-extrabold leading-snug break-words">{i.title}</h2>

        {live && !i.is_maintenance && (
          <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold" style={{ color: colour }}>
            <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {i.expected_fix_at
              ? <span>Expected fix by {clock(i.expected_fix_at)} GMT ({fromNow(i.expected_fix_at, now)})</span>
              : <span>We’ll post an expected fix time as soon as we know it</span>}
          </p>
        )}
        {i.is_maintenance && i.scheduled_for && i.scheduled_until && (
          <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-[#3b82f6]">
            <CalendarClock className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{stamp(i.scheduled_for)} to {clock(i.scheduled_until)} GMT ({lasted(i.scheduled_for, i.scheduled_until)})</span>
          </p>
        )}
        {!live && i.resolved_at && (
          <p className="mt-1 text-xs text-[#8a7f6f]">Lasted {lasted(i.started_at, i.resolved_at)}</p>
        )}
      </div>
      <ol className="px-5 py-4 space-y-4 border-t border-[#f3e9db]">
        {i.updates.map(u => (
          <li key={u.id} className="text-sm">
            <p className="text-[#4a4038] leading-relaxed break-words">
              <strong className="text-[#2b2420]">{STATUS_LABEL[u.status]}</strong> · {u.message}
            </p>
            <p className="text-xs text-[#a89a86] mt-0.5">
              {stamp(u.created_at)}
              {u.expected_fix_at && ` · expected fix ${clock(u.expected_fix_at)}`}
            </p>
          </li>
        ))}
      </ol>
    </article>
  );
}

function History({ incidents, now }: { incidents: Incident[]; now: number }) {
  // The last 14 days, each with its incidents or "No incidents".
  const days = Array.from({ length: 14 }, (_, n) => new Date(now - n * 864e5));
  const key = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Africa/Accra' });
  return (
    <section>
      <h2 className="text-lg font-extrabold mb-4">Past incidents</h2>
      <div className="space-y-5">
        {days.map(d => {
          const list = incidents.filter(i => key(i.started_at) === key(d));
          return (
            <div key={key(d)}>
              <p className="text-sm font-bold border-b border-[#efe2d0] pb-1.5 mb-2.5">{dayLabel(d.toISOString(), true)}</p>
              {list.length === 0 ? (
                <p className="text-sm text-[#a89a86]">No incidents.</p>
              ) : (
                <div className="space-y-3">{list.map(i => <IncidentCard key={i.id} incident={i} now={now} />)}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
