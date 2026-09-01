'use client';

import { useEffect, useState } from 'react';

// Module-level cache — the price list rarely changes, and every one of
// the many places that display it shouldn't each fire their own
// request. Shared by every caller, refreshed after a short TTL rather
// than kept forever: an indefinite cache meant that once any page in a
// tab loaded prices, that tab kept showing them even after an admin
// saved a new price in /admin/pricing — the one place that actually
// needs to see its own change take effect immediately calls
// invalidatePricingCache() below rather than waiting out the TTL.
let cache: Record<number, number> | null = null;
let cachedAt = 0;
let inFlight: Promise<Record<number, number>> | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

function loadPrices(): Promise<Record<number, number>> {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = fetch('/api/pricing')
      .then(r => r.json())
      .then((data: { prices?: Record<number, number> }) => {
        cache = data.prices ?? {};
        cachedAt = Date.now();
        inFlight = null;
        return cache;
      })
      .catch(() => {
        inFlight = null;
        return cache ?? {};
      });
  }
  return inFlight;
}

/** Call after successfully saving new prices (see /admin/pricing) so
 * this tab's own next read is fresh instead of waiting out the TTL. */
export function invalidatePricingCache() {
  cache = null;
  cachedAt = 0;
  inFlight = null;
}

const DEFAULT_PESEWAS = 5000; // shown only until the real price has loaded

/**
 * The per-level subscription price, fetched once and shared across
 * every component that shows it. Before this, most of the app
 * hardcoded "GHC 50" as a literal string — changing a price in
 * /admin/pricing only ever took effect in the actual Paystack checkout
 * (PaywallModal, the one place that already fetched it dynamically),
 * never in any of the promotional copy around it.
 */
export function usePricing(level: number | null | undefined) {
  const [prices, setPrices] = useState<Record<number, number>>(cache ?? {});

  useEffect(() => {
    let cancelled = false;
    loadPrices().then(p => { if (!cancelled) setPrices(p); });
    return () => { cancelled = true; };
  }, []);

  const amountPesewas = (level && prices[level]) || DEFAULT_PESEWAS;
  const cedis = amountPesewas / 100;
  const label = `GHC ${Number.isInteger(cedis) ? cedis : cedis.toFixed(2)}`;

  return { amountPesewas, cedis, label };
}
