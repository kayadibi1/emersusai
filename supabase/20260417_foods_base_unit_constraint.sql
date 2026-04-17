-- 20260417_foods_base_unit_constraint.sql
-- Enforce base_unit/base_amount consistency:
--   base_unit='100g'    → base_amount must be 100
--   base_unit='serving' → base_amount must be 1
--
-- Uses NOT VALID to skip existing row checks (fast ALTER on large table),
-- then VALIDATE CONSTRAINT to verify asynchronously.

alter table public.foods
  add constraint foods_base_unit_amount_check
  check (
    (base_unit = '100g' and base_amount = 100) or
    (base_unit = 'serving' and base_amount = 1)
  )
  not valid;

alter table public.foods
  validate constraint foods_base_unit_amount_check;
