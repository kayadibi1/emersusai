-- Weight unit preference for logging loads.
-- Nullable so the client can distinguish "never chosen" from "explicitly kg",
-- enabling locale-based defaults (en-US → lbs) on first visit.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weight_unit text
    CHECK (weight_unit IS NULL OR weight_unit IN ('kg', 'lbs'));
