'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  IMPACT_COLOUR, IMPACT_LABEL, STATE_COLOUR, STATE_LABEL, STATUS_LABEL,
  clock, fromNow, stamp, statusErrorMessage,
  type ComponentState, type Impact, type Incident, type IncidentStatus,
} from '@/lib/status';
import { Activity, AlertTriangle, CalendarClock, ExternalLink, Loader2, Trash2 } from 'lucide-react';

// Admin › Status (migration 054): what the automatic checks see, and the
// incidents and maintenance shown on status.pastcs.com.

interface Health { key: string; name: string; state: ComponentState; last_checked: string | null; last_ok: boolean | null; last_detail: string | null; last_latency: number | null }
interface Overview { components: Health[]; open: Incident[]; recent: Incident[]; checks_running: boolean; last_check_at: string | null }

const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-white/[0.04] dark:border-white/10 dark:text-gray-100';
const label = 'block text-xs font-medium text-gray-600 mb-1 dark:text-gray-400';
const card = 'rounded-2xl border border-gray-200 bg-white dark:bg-white/[0.04] dark:border-white/10';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60';

const IMPACT_HELP: Record<Exclude<Impact, 'maintenance'>, string> = {
  minor: 'Slow or patchy, but works',
  major: 'A part of PastCS isn’t working',
  critical: 'Most students can’t use PastCS',
};

export default function AdminStatusPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'' | 'incident' | 'maintenance'>('');

  const load = useCallback(async () => {
    const { data: d, error: err } = await createClient().rpc('admin_status_overview');
    if (err) setError(statusErrorMessage(err.message));
    else { setData(d as Overview); setError(''); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const statusUrl = typeof window !== 'undefined' && window.location.hostname.endsWith('pastcs.com') ? 'https://status.pastcs.com' : '/status';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Status</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            What students see on <a href={statusUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline dark:text-blue-400">status.pastcs.com <ExternalLink className="inline w-3.5 h-3.5" /></a>.
            Checks run every 5 minutes; a part failing twice opens an incident by itself.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setMode(mode === 'incident' ? '' : 'incident')} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
            <AlertTriangle className="w-4 h-4" /> Report a problem
          </button>
          <button onClick={() => setMode(mode === 'maintenance' ? '' : 'maintenance')} className={`${btn} border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5`}>
            <CalendarClock className="w-4 h-4" /> Plan maintenance
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {!data && !error ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : data && (
        <>
          {!data.checks_running && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              {data.last_check_at
                ? `The automatic checks haven’t run since ${stamp(data.last_check_at)}. `
                : 'The automatic checks haven’t run yet. '}
              They need pg_cron and pg_net switched on in Supabase (Database › Extensions) and the push drain set up. Run migration 054 again after switching them on.
            </p>
          )}

          {mode && <OpenForm maintenance={mode === 'maintenance'} components={data.components} onDone={() => { setMode(''); load(); }} onCancel={() => setMode('')} />}

          <section className={card}>
            <h2 className="flex items-center gap-2 px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-gray-100"><Activity className="w-4 h-4" /> Live checks</h2>
            <ul className="divide-y divide-gray-100 dark:divide-white/5">
              {data.components.map(c => (
                <li key={c.key} className="px-4 py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{c.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 break-words">
                      {c.last_checked ? `Checked ${clock(c.last_checked)}` : 'Not checked yet'}
                      {c.last_latency !== null && ` · ${c.last_latency} ms`}
                      {c.last_ok === false && c.last_detail && <span className="text-red-600 dark:text-red-400"> · {c.last_detail}</span>}
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold flex-shrink-0" style={{ color: STATE_COLOUR[c.state] }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOUR[c.state] }} /> {STATE_LABEL[c.state]}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Open ({data.open.length})</h2>
            {data.open.length === 0 ? (
              <p className={`${card} p-6 text-center text-sm text-gray-500 dark:text-gray-400`}>Nothing open. Everything students see is marked as working.</p>
            ) : data.open.map(i => <OpenIncident key={i.id} incident={i} components={data.components} onChanged={load} />)}
          </section>

          {data.recent.length > 0 && (
            <section className={card}>
              <h2 className="px-4 pt-4 pb-2 font-semibold text-gray-900 dark:text-gray-100">Recently closed</h2>
              <ul className="divide-y divide-gray-100 dark:divide-white/5">
                {data.recent.map(i => (
                  <li key={i.id} className="px-4 py-2.5 text-sm flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 break-words">{i.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{stamp(i.started_at)}{i.is_auto ? ' · opened and closed by the checks' : ''}</p>
                    </div>
                    <DeleteButton id={i.id} onDone={load} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// "When will it be fixed?" as a choice of durations or an exact time.
function FixTime({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const [choice, setChoice] = useState(value ? 'custom' : 'unknown');
  const [custom, setCustom] = useState(() => {
    if (!value) return '';
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const pick = (c: string) => {
    setChoice(c);
    const mins: Record<string, number> = { '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440 };
    if (c in mins) onChange(new Date(Date.now() + mins[c] * 60_000).toISOString());
    else if (c === 'unknown') onChange(null);
    else if (custom) onChange(new Date(custom).toISOString());
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <select className={input} value={choice} onChange={e => pick(e.target.value)} aria-label="Expected fix">
        <option value="unknown">Not sure yet</option>
        <option value="30m">In 30 minutes</option>
        <option value="1h">In 1 hour</option>
        <option value="2h">In 2 hours</option>
        <option value="4h">In 4 hours</option>
        <option value="1d">By tomorrow</option>
        <option value="custom">At a set time…</option>
      </select>
      {choice === 'custom' && (
        <input type="datetime-local" className={input} value={custom} aria-label="Expected fix time"
          onChange={e => { setCustom(e.target.value); onChange(e.target.value ? new Date(e.target.value).toISOString() : null); }} />
      )}
    </div>
  );
}

function PartsPicker({ components, value, onChange }: { components: Health[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {components.map(c => (
        <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" className="h-4 w-4 rounded" checked={value.includes(c.key)}
            onChange={e => onChange(e.target.checked ? [...value, c.key] : value.filter(k => k !== c.key))} />
          {c.name}
        </label>
      ))}
    </div>
  );
}

function OpenForm({ maintenance, components, onDone, onCancel }: { maintenance: boolean; components: Health[]; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [parts, setParts] = useState<string[]>([]);
  const [impact, setImpact] = useState<Exclude<Impact, 'maintenance'>>('major');
  const [status, setStatus] = useState<IncidentStatus>(maintenance ? 'scheduled' : 'investigating');
  const [message, setMessage] = useState('');
  const [fix, setFix] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const { error: err } = await createClient().rpc('admin_status_open', {
      p_title: title, p_impact: maintenance ? null : impact, p_components: parts, p_status: status, p_message: message,
      p_expected_fix_at: maintenance ? null : fix, p_is_maintenance: maintenance,
      p_scheduled_for: maintenance && from ? new Date(from).toISOString() : null,
      p_scheduled_until: maintenance && until ? new Date(until).toISOString() : null,
    });
    setBusy(false);
    if (err) setError(statusErrorMessage(err.message)); else onDone();
  };

  return (
    <form onSubmit={save} className="rounded-2xl border border-blue-200 bg-white p-4 space-y-4 dark:bg-white/[0.04] dark:border-blue-500/30">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100">{maintenance ? 'Plan maintenance' : 'Report a problem'}</h2>
      <div>
        <label className={label} htmlFor="st-title">Title (what students would notice)</label>
        <input id="st-title" className={input} value={title} onChange={e => setTitle(e.target.value)}
          placeholder={maintenance ? 'Database upgrade' : 'Payments not going through'} />
      </div>
      <div>
        <span className={label}>Affected parts</span>
        <PartsPicker components={components} value={parts} onChange={setParts} />
      </div>
      {maintenance ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={label} htmlFor="st-from">Starts</label><input id="st-from" type="datetime-local" className={input} value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className={label} htmlFor="st-until">Ends</label><input id="st-until" type="datetime-local" className={input} value={until} onChange={e => setUntil(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2 dark:text-gray-300">
            <input type="checkbox" className="h-4 w-4 rounded" checked={status === 'in_progress'} onChange={e => setStatus(e.target.checked ? 'in_progress' : 'scheduled')} />
            It’s already started
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="st-impact">How bad</label>
            <select id="st-impact" className={input} value={impact} onChange={e => setImpact(e.target.value as typeof impact)}>
              {(['minor', 'major', 'critical'] as const).map(k => <option key={k} value={k}>{IMPACT_LABEL[k]}: {IMPACT_HELP[k]}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="st-status">Where you are</label>
            <select id="st-status" className={input} value={status} onChange={e => setStatus(e.target.value as IncidentStatus)}>
              {(['investigating', 'identified', 'monitoring'] as const).map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <span className={label}>Expected fix</span>
            <FixTime value={null} onChange={setFix} />
          </div>
        </div>
      )}
      <div>
        <label className={label} htmlFor="st-msg">Message for students</label>
        <textarea id="st-msg" rows={3} className={input} value={message} onChange={e => setMessage(e.target.value)}
          placeholder={maintenance ? 'PastCS will be unavailable for about an hour while we upgrade the database.' : 'Some payments are failing. We’re working with Paystack to fix it.'} />
      </div>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${btn} border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300`}>Cancel</button>
        <button type="submit" disabled={busy} className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Post to status page</button>
      </div>
    </form>
  );
}

function OpenIncident({ incident: i, components, onChanged }: { incident: Incident; components: Health[]; onChanged: () => void }) {
  const statuses: IncidentStatus[] = i.is_maintenance ? ['scheduled', 'in_progress', 'completed'] : ['investigating', 'identified', 'monitoring', 'resolved'];
  const [status, setStatus] = useState<IncidentStatus>(i.status);
  const [impact, setImpact] = useState<Impact>(i.impact);
  const [message, setMessage] = useState('');
  const [fix, setFix] = useState<string | null>(i.expected_fix_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const names = i.components.map(k => components.find(c => c.key === k)?.name ?? k).join(', ');
  const closing = status === 'resolved' || status === 'completed';

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const { error: err } = await createClient().rpc('admin_status_update', {
      p_incident: i.id, p_status: status, p_message: message, p_expected_fix_at: closing ? null : fix,
      p_impact: i.is_maintenance || impact === i.impact ? null : impact,
    });
    setBusy(false);
    if (err) setError(statusErrorMessage(err.message)); else { setMessage(''); onChanged(); }
  };

  return (
    <article className={`${card} overflow-hidden`} style={{ borderColor: IMPACT_COLOUR[i.impact] }}>
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full text-white" style={{ background: IMPACT_COLOUR[i.impact] }}>{IMPACT_LABEL[i.impact]}</span>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{STATUS_LABEL[i.status]}</span>
            {i.is_auto && <span className="text-xs text-gray-400">opened by the checks: closes itself when they pass, unless you post an update</span>}
          </div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 break-words">{i.title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{names} · since {stamp(i.started_at)}</p>
          {i.expected_fix_at && <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-0.5">Expected fix {clock(i.expected_fix_at)} ({fromNow(i.expected_fix_at)})</p>}
        </div>
        <DeleteButton id={i.id} onDone={onChanged} />
      </div>
      <ol className="px-4 pb-3 space-y-1.5 text-sm">
        {i.updates.slice(0, 4).map(u => (
          <li key={u.id} className="text-gray-600 dark:text-gray-400 break-words"><strong className="text-gray-800 dark:text-gray-200">{STATUS_LABEL[u.status]}</strong> · {u.message} <span className="text-xs text-gray-400">{stamp(u.created_at)}</span></li>
        ))}
      </ol>
      <form onSubmit={post} className="border-t border-gray-100 p-4 space-y-3 bg-gray-50/60 dark:border-white/10 dark:bg-white/[0.02]">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor={`s-${i.id}`}>Status</label>
            <select id={`s-${i.id}`} className={input} value={status} onChange={e => setStatus(e.target.value as IncidentStatus)}>
              {statuses.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          {!i.is_maintenance && (
            <div>
              <label className={label} htmlFor={`i-${i.id}`}>How bad</label>
              <select id={`i-${i.id}`} className={input} value={impact} onChange={e => setImpact(e.target.value as Impact)}>
                {(['minor', 'major', 'critical'] as const).map(k => <option key={k} value={k}>{IMPACT_LABEL[k]}</option>)}
              </select>
            </div>
          )}
          {!i.is_maintenance && !closing && (
            <div className="sm:col-span-2">
              <span className={label}>Expected fix</span>
              <FixTime value={i.expected_fix_at} onChange={setFix} />
            </div>
          )}
        </div>
        <div>
          <label className={label} htmlFor={`m-${i.id}`}>Update for students</label>
          <textarea id={`m-${i.id}`} rows={2} className={input} value={message} onChange={e => setMessage(e.target.value)}
            placeholder={closing ? 'This is fixed. Everything is working normally.' : 'We found the cause and are fixing it.'} />
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={`${btn} ${closing ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} text-white`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {closing ? (i.is_maintenance ? 'Mark completed' : 'Mark resolved') : 'Post update'}
          </button>
        </div>
      </form>
    </article>
  );
}

function DeleteButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!confirm('Delete this from the status page? Use this only for something posted by mistake.')) return;
    setBusy(true);
    const { error } = await createClient().rpc('admin_status_delete', { p_incident: id });
    setBusy(false);
    if (error) alert(statusErrorMessage(error.message)); else onDone();
  };
  return (
    <button onClick={del} disabled={busy} title="Delete (posted by mistake)" aria-label="Delete"
      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0 dark:hover:bg-red-500/10">
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
