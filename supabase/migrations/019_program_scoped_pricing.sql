-- ================================================================
-- MIGRATION: Program-scoped subscription pricing
-- Run this in the Supabase SQL Editor once. Safe to re-run (idempotent).
--
-- subscription_prices was one row per level, globally — every program
-- shares the same price at a given level, with no way to charge
-- differently. Adds program_id, backfills every existing row to
-- BSc IT (today's only program), and switches the uniqueness
-- constraint from (level) to (level, program_id) so each program can
-- have its own price per level going forward. A program with no rows
-- yet falls back to the existing hardcoded default (GHC 50) already
-- built into usePricing()/admin's pricing page — no seeding needed for
-- a newly created program.
-- ================================================================

ALTER TABLE public.subscription_prices ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES public.programs(id);

UPDATE public.subscription_prices sp
SET program_id = p.id
FROM public.programs p
WHERE p.short_code = 'IT'
  AND sp.program_id IS NULL;

ALTER TABLE public.subscription_prices ALTER COLUMN program_id SET NOT NULL;

-- Postgres auto-names an inline column UNIQUE as `<table>_<column>_key`.
ALTER TABLE public.subscription_prices DROP CONSTRAINT IF EXISTS subscription_prices_level_key;
ALTER TABLE public.subscription_prices DROP CONSTRAINT IF EXISTS subscription_prices_level_program_id_key;
ALTER TABLE public.subscription_prices ADD CONSTRAINT subscription_prices_level_program_id_key UNIQUE (level, program_id);
