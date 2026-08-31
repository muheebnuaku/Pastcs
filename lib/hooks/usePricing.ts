'use client';

import { useEffect, useState } from 'react';

// Module-level cache — the price list rarely changes, and every one of
// the many places that display it shouldn't each fire their own
// request. Fetched once per page load, shared by every caller.
let cache: Record<number, number> | null = null;
let inFlight: Promise<Record<number, number>> | null = null;

function loadPrices(): Promise<Record<number, number>> {
  if (cache) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = fetch('/api/pricing')
      .then(r => r.json())
      .then((data: { prices?: Record<number, number> }) => {
        cache = data.prices ?? {};
        return cache;
      })
      .catch(() => ({}));
  }
  return inFlight;
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
