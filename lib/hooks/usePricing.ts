'use client';

import { useEffect, useState } from 'react';

// Module-level cache, keyed per program (pricing is program-scoped — a
// price list loaded for one program must never leak into another's
// display). The price list rarely changes, and every one of the many
// places that show it shouldn't each fire their own request. Shared by
// every caller, refreshed after a short TTL rather than kept forever:
// an indefinite cache meant that once any page in a tab loaded prices,
// that tab kept showing them even after an admin saved a new price in
// /admin/pricing — the one place that actually needs to see its own
// change take effect immediately calls invalidatePricingCache() below
// rather than waiting out the TTL.
const cache = new Map<string, Record<number, number>>();
const cachedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<Record<number, number>>>();
const CACHE_TTL_MS = 2 * 60 * 1000;

function loadPrices(programId: string): Promise<Record<number, number>> {
  const cached = cache.get(programId);
  const at = cachedAt.get(programId) ?? 0;
  if (cached && Date.now() - at < CACHE_TTL_MS) return Promise.resolve(cached);

  let promise = inFlight.get(programId);
  if (!promise) {
    promise = fetch(`/api/pricing?programId=${encodeURIComponent(programId)}`)
      .then(r => r.json())
      .then((data: { prices?: Record<number, number> }) => {
        const prices = data.prices ?? {};
        cache.set(programId, prices);
        cachedAt.set(programId, Date.now());
        inFlight.delete(programId);
        return prices;
      })
      .catch(() => {
        inFlight.delete(programId);
        return cache.get(programId) ?? {};
      });
    inFlight.set(programId, promise);
  }
  return promise;
}

/** Call after successfully saving new prices (see /admin/pricing) so
 * this tab's own next read is fresh instead of waiting out the TTL.
 * Clears every program's cache — cheap, and saving is rare enough that
 * there's no reason to track which program just changed. */
export function invalidatePricingCache() {
  cache.clear();
  cachedAt.clear();
  inFlight.clear();
}

const DEFAULT_PESEWAS = 5000; // shown only until the real price has loaded

/**
 * The per-level subscription price for one program, fetched once and
 * shared across every component that shows it. Before this, most of
 * the app hardcoded "GHC 50" as a literal string — changing a price in
 * /admin/pricing only ever took effect in the actual Paystack checkout
 * (PaywallModal, the one place that already fetched it dynamically),
 * never in any of the promotional copy around it.
 */
export function usePricing(level: number | null | undefined, programId: string | null | undefined) {
  const [prices, setPrices] = useState<Record<number, number>>(programId ? (cache.get(programId) ?? {}) : {});

  useEffect(() => {
    if (!programId) { setPrices({}); return; }
    let cancelled = false;
    loadPrices(programId).then(p => { if (!cancelled) setPrices(p); });
    return () => { cancelled = true; };
  }, [programId]);

  const amountPesewas = (level && prices[level]) || DEFAULT_PESEWAS;
  const cedis = amountPesewas / 100;
  const label = `GHC ${Number.isInteger(cedis) ? cedis : cedis.toFixed(2)}`;

  return { amountPesewas, cedis, label };
}
