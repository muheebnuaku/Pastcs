import type { SupabaseClient } from '@supabase/supabase-js';
import { CLASS_DEAL_MIN_PAID, CLASS_DEAL_PERCENT } from '@/lib/classDeal';

// Matches the price the UI shows before a program's real price has loaded.
const DEFAULT_PRICE_PESEWAS = 5000;

export interface ClassDeal {
  classroomId: string;
  classroomName: string;
  paidCount: number;
  needed: number;
  percent: number;
  active: boolean;
}

export interface CoursePrice {
  /** The amount to charge, in pesewas, after any class deal. */
  amount: number;
  /** The normal price, in pesewas. */
  fullAmount: number;
  deal: ClassDeal | null;
}

/** The admin price list's normal price for a level, in pesewas. */
async function listPriceFor(admin: SupabaseClient, programId: string, level: number): Promise<number> {
  const { data: priceRow } = await admin
    .from('subscription_prices')
    .select('amount')
    .eq('program_id', programId)
    .eq('level', level)
    .maybeSingle();
  return Number((priceRow as { amount?: number } | null)?.amount) || DEFAULT_PRICE_PESEWAS;
}

/**
 * The price a student must pay to unlock a level+semester, computed on the
 * server from the admin price list and the student's classrooms. Payment
 * verification checks the amount Paystack actually charged against this:
 * the amount used to come only from the browser, so it could be changed.
 */
export async function coursePriceFor(
  admin: SupabaseClient,
  userId: string,
  programId: string,
  level: number,
  semester: number
): Promise<CoursePrice> {
  const fullAmount = await listPriceFor(admin, programId, level);

  let deal: ClassDeal | null = null;
  // Classrooms may not be set up yet on this database — no deal then.
  const { data: dealRows, error } = await admin.rpc('class_deal_for', { p_user: userId, p_level: level, p_semester: semester });
  const best = !error ? (dealRows as { classroom_id: string; classroom_name: string; paid_count: number }[] | null)?.[0] : undefined;
  if (best) {
    deal = {
      classroomId: best.classroom_id,
      classroomName: best.classroom_name,
      paidCount: best.paid_count,
      needed: Math.max(0, CLASS_DEAL_MIN_PAID - best.paid_count),
      percent: CLASS_DEAL_PERCENT,
      active: best.paid_count >= CLASS_DEAL_MIN_PAID,
    };
  }

  const amount = deal?.active ? Math.round(fullAmount * (100 - CLASS_DEAL_PERCENT) / 100) : fullAmount;
  return { amount, fullAmount, deal };
}

/**
 * Extra subscription columns (migration 032) that let the admin classroom
 * dashboard measure what the class deal costs. Kept separate so a
 * database that hasn't run 032 yet can retry the insert without them.
 */
export function dealColumns(price: CoursePrice): { full_amount: number; deal_classroom_id: string | null } {
  return { full_amount: price.fullAmount, deal_classroom_id: price.deal?.active ? price.deal.classroomId : null };
}

export interface GroupUnitPrice {
  /** Per student, in pesewas, after any class deal. */
  unitAmount: number;
  fullUnitAmount: number;
  paidCount: number;
  dealActive: boolean;
  percent: number;
}

/**
 * The price per classmate when a rep pays for several at once (migration
 * 036). The class deal applies when it is already on in this classroom —
 * the classmates being paid for don't count towards it until they've paid.
 */
export async function groupUnitPriceFor(
  admin: SupabaseClient,
  classroomId: string,
  programId: string,
  level: number
): Promise<GroupUnitPrice> {
  const fullUnitAmount = await listPriceFor(admin, programId, level);
  const { data, error } = await admin.rpc('classroom_paid_count', { p_classroom: classroomId, p_exclude: null });
  const paidCount = !error && typeof data === 'number' ? data : 0;
  const dealActive = paidCount >= CLASS_DEAL_MIN_PAID;
  const unitAmount = dealActive ? Math.round(fullUnitAmount * (100 - CLASS_DEAL_PERCENT) / 100) : fullUnitAmount;
  return { unitAmount, fullUnitAmount, paidCount, dealActive, percent: CLASS_DEAL_PERCENT };
}
