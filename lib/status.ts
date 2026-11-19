// The status page (migration 054): shared types, labels and colours.

export type ComponentState = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
export type Impact = 'minor' | 'major' | 'critical' | 'maintenance';
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'scheduled' | 'in_progress' | 'completed';

export interface StatusDay {
  day: string;
  pct: number | null;
  incidents: { title: string; impact: Impact }[] | null;
}

export interface StatusComponent {
  key: string;
  name: string;
  description: string;
  state: ComponentState;
  last_checked: string | null;
  uptime: number | null;
  days: StatusDay[];
}

export interface IncidentUpdate {
  id: string;
  status: IncidentStatus;
  message: string;
  expected_fix_at: string | null;
  created_at: string;
}

export interface Incident {
  id: string;
  title: string;
  impact: Impact;
  status: IncidentStatus;
  components: string[];
  expected_fix_at: string | null;
  is_maintenance: boolean;
  is_auto: boolean;
  scheduled_for: string | null;
  scheduled_until: string | null;
  started_at: string;
  resolved_at: string | null;
  updates: IncidentUpdate[];
}

export interface StatusPageData {
  generated_at: string;
  components: StatusComponent[];
  active: Incident[];
  maintenance: Incident[];
  history: Incident[];
}

export const STATE_LABEL: Record<ComponentState, string> = {
  operational: 'Working',
  degraded: 'Slow or patchy',
  partial_outage: 'Partly down',
  major_outage: 'Down',
  maintenance: 'Under maintenance',
};

export const STATE_COLOUR: Record<ComponentState, string> = {
  operational: '#22a06b',
  degraded: '#d9a400',
  partial_outage: '#e8700c',
  major_outage: '#d93b3b',
  maintenance: '#3b82f6',
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Cause found',
  monitoring: 'Fix applied, watching',
  resolved: 'Resolved',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const IMPACT_LABEL: Record<Impact, string> = {
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
  maintenance: 'Maintenance',
};

export const IMPACT_COLOUR: Record<Impact, string> = {
  minor: '#d9a400',
  major: '#e8700c',
  critical: '#d93b3b',
  maintenance: '#3b82f6',
};

const RANK: Record<ComponentState, number> = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };

export function overallState(components: StatusComponent[]): ComponentState {
  return components.reduce<ComponentState>((w, c) => (RANK[c.state] > RANK[w] ? c.state : w), 'operational');
}

export const OVERALL_HEADLINE: Record<ComponentState, string> = {
  operational: 'All systems working',
  degraded: 'Some things are slow',
  partial_outage: 'Some things aren’t working',
  major_outage: 'Something is down',
  maintenance: 'Maintenance in progress',
};

// Uptime bar colour for a day.
export function dayColour(pct: number | null): string {
  if (pct === null) return '#d9d2c7';
  if (pct >= 99.5) return STATE_COLOUR.operational;
  if (pct >= 97) return STATE_COLOUR.degraded;
  if (pct >= 90) return STATE_COLOUR.partial_outage;
  return STATE_COLOUR.major_outage;
}

// Times are shown in Ghana time (GMT, no daylight saving).
const TZ = 'Africa/Accra';

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).replace(' ', ' ');
}

export function dayLabel(iso: string, withYear = false): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: TZ });
}

export function stamp(iso: string): string {
  return `${dayLabel(iso)}, ${clock(iso)} GMT`;
}

/** "in about 2 hours", "in 25 minutes", "overdue" */
export function fromNow(iso: string, now = Date.now()): string {
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins <= 0) return 'any time now';
  if (mins < 60) return `in about ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in about ${days} day${days === 1 ? '' : 's'}`;
}

/** "2 hours 10 minutes" between two times */
export function lasted(fromIso: string, toIso: string): string {
  const mins = Math.max(1, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minute${m === 1 ? '' : 's'}` : ''}`;
}

const ERRORS: Record<string, string> = {
  admins_only: 'Only admins can do that.',
  bad_title: 'Give it a short title.',
  bad_message: 'Write a message for the update.',
  bad_components: 'Pick at least one affected part.',
  bad_status: 'That status doesn’t fit here.',
  bad_impact: 'Pick how bad it is.',
  bad_window: 'The maintenance must end after it starts.',
  not_found: 'That incident no longer exists.',
};

export function statusErrorMessage(raw: string | null | undefined): string {
  if (!raw) return 'Something went wrong. Please try again.';
  if (/function .* does not exist|schema cache/i.test(raw)) return 'Run migration 054_status_page.sql in Supabase to turn on the status page.';
  for (const [code, text] of Object.entries(ERRORS)) if (raw.includes(code)) return text;
  return 'Something went wrong. Please try again.';
}
