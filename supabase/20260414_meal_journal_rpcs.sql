-- 20260414_meal_journal_rpcs.sql
-- Three RPCs for the meal journal write-path.
--
-- All three use security invoker so they inherit the caller's RLS context.
-- Snapshot formula:  nutrient_value = amount_per_base * amount / base_amount
--   • For base_unit='100g': amount is grams, base_amount=100  → per-gram × grams
--   • For base_unit='serving': amount is serving count, base_amount=1 → per-serving × count
--
-- Unit compatibility rules enforced by insert_meal_journal_entries:
--   base_unit = '100g'    → amount_unit must be 'g'
--   base_unit = 'serving' → amount_unit must be 'serving'

-- ─── RPC 1: insert_meal_journal_entries ─────────────────────────────────────
-- Accepts a JSON array of entry objects, validates units, computes macro
-- snapshots from food_nutrients, inserts rows, and returns the inserted rows.

create or replace function public.insert_meal_journal_entries(
  p_entries jsonb
)
returns setof public.meal_journal_entries
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  _entry         jsonb;
  _food_id       uuid;
  _base_unit     text;
  _base_amount   numeric;
  _amount        numeric;
  _amount_unit   text;
  _kcal          numeric;
  _protein       numeric;
  _carbs         numeric;
  _fat           numeric;
  _fiber         numeric;
  _inserted      public.meal_journal_entries;
begin
  for _entry in select * from jsonb_array_elements(p_entries)
  loop
    _food_id     := (_entry->>'food_id')::uuid;
    _amount      := (_entry->>'amount')::numeric;
    _amount_unit := _entry->>'amount_unit';

    -- Look up base_unit and base_amount for this food
    select f.base_unit, f.base_amount
      into _base_unit, _base_amount
      from public.foods f
     where f.id = _food_id;

    if not found then
      raise exception 'food not found: %', _food_id;
    end if;

    -- Validate unit compatibility
    if _base_unit = '100g' and _amount_unit <> 'g' then
      raise exception 'food % uses base_unit=100g; amount_unit must be ''g'', got ''%''',
        _food_id, _amount_unit;
    end if;
    if _base_unit = 'serving' and _amount_unit <> 'serving' then
      raise exception 'food % uses base_unit=serving; amount_unit must be ''serving'', got ''%''',
        _food_id, _amount_unit;
    end if;

    -- Compute macro snapshots via food_nutrients × nutrients (by slug)
    select
      sum(case when n.slug = 'energy_kcal'  then fn.amount_per_base * _amount / _base_amount end),
      sum(case when n.slug = 'protein'       then fn.amount_per_base * _amount / _base_amount end),
      sum(case when n.slug = 'carbohydrate'  then fn.amount_per_base * _amount / _base_amount end),
      sum(case when n.slug = 'total_fat'     then fn.amount_per_base * _amount / _base_amount end),
      sum(case when n.slug = 'fiber'         then fn.amount_per_base * _amount / _base_amount end)
    into _kcal, _protein, _carbs, _fat, _fiber
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = _food_id
      and n.slug in ('energy_kcal','protein','carbohydrate','total_fat','fiber');

    -- Insert the journal row
    insert into public.meal_journal_entries (
      user_id,
      food_id,
      plan_id,
      logged_date,
      meal_slot,
      amount,
      amount_unit,
      servings,
      servings_unit,
      source,
      confidence,
      notes,
      kcal_snapshot,
      protein_g_snapshot,
      carbs_g_snapshot,
      fat_g_snapshot,
      fiber_g_snapshot
    ) values (
      auth.uid(),
      _food_id,
      (_entry->>'plan_id')::uuid,
      (_entry->>'logged_date')::date,
      _entry->>'meal_slot',
      _amount,
      _amount_unit,
      (_entry->>'servings')::numeric,
      _entry->>'servings_unit',
      _entry->>'source',
      (_entry->>'confidence')::numeric,
      _entry->>'notes',
      _kcal,
      _protein,
      _carbs,
      _fat,
      _fiber
    )
    returning * into _inserted;

    return next _inserted;
  end loop;
end;
$$;

grant execute on function public.insert_meal_journal_entries(jsonb) to authenticated;

-- ─── RPC 2: update_meal_journal_entry ───────────────────────────────────────
-- Updates a single journal entry. Re-computes macro snapshots only when
-- p_amount or p_amount_unit is provided (not null); otherwise the existing
-- frozen snapshots are preserved.

create or replace function public.update_meal_journal_entry(
  p_id           uuid,
  p_amount       numeric  default null,
  p_amount_unit  text     default null,
  p_meal_slot    text     default null,
  p_notes        text     default null,
  p_servings     numeric  default null,
  p_servings_unit text    default null
)
returns public.meal_journal_entries
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  _current       public.meal_journal_entries;
  _base_unit     text;
  _base_amount   numeric;
  _eff_amount    numeric;
  _eff_unit      text;
  _kcal          numeric;
  _protein       numeric;
  _carbs         numeric;
  _fat           numeric;
  _fiber         numeric;
  _updated       public.meal_journal_entries;
begin
  -- Fetch the existing row (RLS will prevent access to other users' entries)
  select * into _current
    from public.meal_journal_entries
   where id = p_id;

  if not found then
    raise exception 'journal entry not found: %', p_id;
  end if;

  -- Determine effective amount + unit (coalesce with existing)
  _eff_amount := coalesce(p_amount,      _current.amount);
  _eff_unit   := coalesce(p_amount_unit, _current.amount_unit);

  -- Re-snapshot only when amount or unit explicitly changed
  if p_amount is not null or p_amount_unit is not null then
    select f.base_unit, f.base_amount
      into _base_unit, _base_amount
      from public.foods f
     where f.id = _current.food_id;

    -- Validate unit compatibility for the new effective unit
    if _base_unit = '100g' and _eff_unit <> 'g' then
      raise exception 'food % uses base_unit=100g; amount_unit must be ''g'', got ''%''',
        _current.food_id, _eff_unit;
    end if;
    if _base_unit = 'serving' and _eff_unit <> 'serving' then
      raise exception 'food % uses base_unit=serving; amount_unit must be ''serving'', got ''%''',
        _current.food_id, _eff_unit;
    end if;

    select
      sum(case when n.slug = 'energy_kcal'  then fn.amount_per_base * _eff_amount / _base_amount end),
      sum(case when n.slug = 'protein'       then fn.amount_per_base * _eff_amount / _base_amount end),
      sum(case when n.slug = 'carbohydrate'  then fn.amount_per_base * _eff_amount / _base_amount end),
      sum(case when n.slug = 'total_fat'     then fn.amount_per_base * _eff_amount / _base_amount end),
      sum(case when n.slug = 'fiber'         then fn.amount_per_base * _eff_amount / _base_amount end)
    into _kcal, _protein, _carbs, _fat, _fiber
    from public.food_nutrients fn
    join public.nutrients n on n.id = fn.nutrient_id
    where fn.food_id = _current.food_id
      and n.slug in ('energy_kcal','protein','carbohydrate','total_fat','fiber');
  else
    -- Preserve frozen snapshots
    _kcal    := _current.kcal_snapshot;
    _protein := _current.protein_g_snapshot;
    _carbs   := _current.carbs_g_snapshot;
    _fat     := _current.fat_g_snapshot;
    _fiber   := _current.fiber_g_snapshot;
  end if;

  update public.meal_journal_entries
     set amount              = _eff_amount,
         amount_unit         = _eff_unit,
         meal_slot           = coalesce(p_meal_slot,     meal_slot),
         notes               = coalesce(p_notes,         notes),
         servings            = coalesce(p_servings,      servings),
         servings_unit       = coalesce(p_servings_unit, servings_unit),
         kcal_snapshot       = _kcal,
         protein_g_snapshot  = _protein,
         carbs_g_snapshot    = _carbs,
         fat_g_snapshot      = _fat,
         fiber_g_snapshot    = _fiber
   where id = p_id
   returning * into _updated;

  return _updated;
end;
$$;

grant execute on function public.update_meal_journal_entry(uuid, numeric, text, text, text, numeric, text) to authenticated;

-- ─── RPC 3: copy_meal_journal_day ───────────────────────────────────────────
-- Clones all (or a filtered subset of) journal entries from source_date to
-- target_date for the authenticated user. Sets source='copied' and
-- confidence=null on the copies. Snapshots are preserved verbatim.

create or replace function public.copy_meal_journal_day(
  p_source_date  date,
  p_target_date  date,
  p_meal_slots   text[] default null
)
returns setof public.meal_journal_entries
language sql
security invoker
set search_path = public, extensions
as $$
  insert into public.meal_journal_entries (
    user_id,
    food_id,
    plan_id,
    logged_date,
    meal_slot,
    amount,
    amount_unit,
    servings,
    servings_unit,
    source,
    confidence,
    notes,
    kcal_snapshot,
    protein_g_snapshot,
    carbs_g_snapshot,
    fat_g_snapshot,
    fiber_g_snapshot
  )
  select
    user_id,
    food_id,
    plan_id,
    p_target_date,
    meal_slot,
    amount,
    amount_unit,
    servings,
    servings_unit,
    'copied',
    null,
    notes,
    kcal_snapshot,
    protein_g_snapshot,
    carbs_g_snapshot,
    fat_g_snapshot,
    fiber_g_snapshot
  from public.meal_journal_entries
  where user_id     = auth.uid()
    and logged_date = p_source_date
    and (p_meal_slots is null or meal_slot = any(p_meal_slots))
  returning *;
$$;

grant execute on function public.copy_meal_journal_day(date, date, text[]) to authenticated;
