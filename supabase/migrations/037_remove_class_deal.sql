-- ================================================================
-- MIGRATION: Remove the class deal
-- ================================================================
-- The class deal (20% off once 10 classmates had unlocked) is gone:
-- everyone pays the admin price list, including a rep paying for
-- classmates. Run this after deploying the app that no longer calls
-- these functions.
--
-- Kept on purpose: subscriptions.full_amount and deal_classroom_id, and
-- classroom_group_payments.deal, so past payments and the admin
-- analytics stay correct. classroom_paid_count stays (service role only).
--
-- Safe to run more than once.
-- ================================================================

-- Let members see how many classmates had paid, for the deal's progress bar.
DROP FUNCTION IF EXISTS public.get_class_deal(UUID);
-- Priced the deal for the payment routes.
DROP FUNCTION IF EXISTS public.class_deal_for(UUID, INTEGER, INTEGER);

NOTIFY pgrst, 'reload schema';
