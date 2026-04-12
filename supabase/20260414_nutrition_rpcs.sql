-- 20260414_nutrition_rpcs.sql
-- Analytics RPCs for the nutrition feature.
-- All functions run SECURITY INVOKER; RLS on the underlying tables gates access.
-- search_path is set explicitly per the match_evidence_chunks lesson.

-- ─── get_nutrition_dashboard ───────────────────────────────────────────────
-- Single call returning today-centric summary for /app/nutrition/#today.

create or replace function public.get_nutrition_dashboard(
  p_date date default current_date
) returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with actuals as (
    select
      sum(kcal_snapshot)      as kcal,
      sum(protein_g_snapshot) as protein_g,
      sum(carbs_g_snapshot)   as carbs_g,
      sum(fat_g_snapshot)     as fat_g,
      sum(fiber_g_snapshot)   as fiber_g
    from public.meal_journal_entries
    where user_id = auth.uid()
      and logged_date = p_date
  ),
  per_meal as (
    select
      meal_slot,
      sum(kcal_snapshot)      as kcal,
      sum(protein_g_snapshot) as protein_g,
      sum(carbs_g_snapshot)   as carbs_g,
      sum(fat_g_snapshot)     as fat_g,
      sum(fiber_g_snapshot)   as fiber_g,
      jsonb_agg(jsonb_build_object(
        'id', mje.id,
        'food_id', mje.food_id,
        'food_description', f.description,
        'food_brand_name', f.brand_name,
        'amount', mje.amount,
        'amount_unit', mje.amount_unit,
        'kcal', mje.kcal_snapshot
      ) order by mje.logged_at) as entries
    from public.meal_journal_entries mje
    join public.foods f on f.id = mje.food_id
    where mje.user_id = auth.uid()
      and mje.logged_date = p_date
    group by meal_slot
  )
  select jsonb_build_object(
    'date', p_date,
    'actuals', jsonb_build_object(
      'kcal',      coalesce((select kcal from actuals), 0),
      'protein_g', coalesce((select protein_g from actuals), 0),
      'carbs_g',   coalesce((select carbs_g from actuals), 0),
      'fat_g',     coalesce((select fat_g from actuals), 0),
      'fiber_g',   coalesce((select fiber_g from actuals), 0)
    ),
    'meal_breakdown', coalesce((select jsonb_agg(row_to_json(per_meal)) from per_meal), '[]'::jsonb)
  );
$$;

grant execute on function public.get_nutrition_dashboard(date) to authenticated;

-- ─── get_daily_journal ─────────────────────────────────────────────────────

create or replace function public.get_daily_journal(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', mje.id,
      'logged_date', mje.logged_date,
      'meal_slot', mje.meal_slot,
      'logged_at', mje.logged_at,
      'amount', mje.amount,
      'amount_unit', mje.amount_unit,
      'kcal_snapshot', mje.kcal_snapshot,
      'protein_g_snapshot', mje.protein_g_snapshot,
      'carbs_g_snapshot', mje.carbs_g_snapshot,
      'fat_g_snapshot', mje.fat_g_snapshot,
      'fiber_g_snapshot', mje.fiber_g_snapshot,
      'food', jsonb_build_object(
        'id', f.id,
        'description', f.description,
        'brand_name', f.brand_name,
        'kind', f.kind
      )
    ) order by mje.logged_at
  ), '[]'::jsonb)
  from public.meal_journal_entries mje
  join public.foods f on f.id = mje.food_id
  where mje.user_id = auth.uid()
    and mje.logged_date = p_date;
$$;

grant execute on function public.get_daily_journal(date) to authenticated;

-- ─── get_weekly_macro_averages ─────────────────────────────────────────────

create or replace function public.get_weekly_macro_averages(
  p_range_start date,
  p_range_end   date
) returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with days as (
    select generate_series(p_range_start, p_range_end, interval '1 day')::date as d
  ),
  per_day as (
    select
      days.d as date,
      coalesce(sum(mje.kcal_snapshot), 0)      as kcal_actual,
      coalesce(sum(mje.protein_g_snapshot), 0) as protein_g_actual,
      coalesce(sum(mje.carbs_g_snapshot), 0)   as carbs_g_actual,
      coalesce(sum(mje.fat_g_snapshot), 0)     as fat_g_actual,
      coalesce(sum(mje.fiber_g_snapshot), 0)   as fiber_g_actual
    from days
    left join public.meal_journal_entries mje
      on mje.logged_date = days.d and mje.user_id = auth.uid()
    group by days.d
  )
  select coalesce(jsonb_agg(row_to_json(per_day) order by date), '[]'::jsonb)
  from per_day;
$$;

grant execute on function public.get_weekly_macro_averages(date, date) to authenticated;

-- ─── get_macro_hit_streak ──────────────────────────────────────────────────
-- Consecutive days where all 4 macros landed within ±10% of target, using
-- the user's active meal plan's targets for the day-type on each date.

create or replace function public.get_macro_hit_streak()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_plan record;
  v_date date := current_date;
  v_current int := 0;
  v_best int := 0;
  v_temp int := 0;
  v_hit boolean;
  v_day_type text;
  v_targets jsonb;
  v_actuals record;
begin
  -- Load active meal plan (one per user enforced by unique partial index)
  select id, plan
    into v_plan
  from public.meal_plans
  where user_id = auth.uid() and archived_at is null
  limit 1;
  if v_plan.id is null then
    return jsonb_build_object('current', 0, 'best', 0);
  end if;

  -- Walk backwards up to 365 days computing streak
  for i in 0..364 loop
    v_date := current_date - i;
    v_day_type := coalesce(
      v_plan.plan->'assignments'->'overrides'->>(v_date::text),
      v_plan.plan->'assignments'->>'default_day_type',
      'rest_day'
    );
    v_targets := v_plan.plan->'targets'->v_day_type;
    if v_targets is null then
      v_hit := false;
    else
      select
        coalesce(sum(kcal_snapshot),0)      as kcal,
        coalesce(sum(protein_g_snapshot),0) as protein_g,
        coalesce(sum(carbs_g_snapshot),0)   as carbs_g,
        coalesce(sum(fat_g_snapshot),0)     as fat_g
      into v_actuals
      from public.meal_journal_entries
      where user_id = auth.uid() and logged_date = v_date;
      v_hit := (
        abs(v_actuals.kcal      - (v_targets->>'kcal')::numeric)      <= (v_targets->>'kcal')::numeric      * 0.1
        and abs(v_actuals.protein_g - (v_targets->>'protein_g')::numeric) <= (v_targets->>'protein_g')::numeric * 0.1
        and abs(v_actuals.carbs_g   - (v_targets->>'carbs_g')::numeric)   <= (v_targets->>'carbs_g')::numeric   * 0.1
        and abs(v_actuals.fat_g     - (v_targets->>'fat_g')::numeric)     <= (v_targets->>'fat_g')::numeric     * 0.1
      );
    end if;

    if v_hit then
      v_temp := v_temp + 1;
      if i = 0 then v_current := v_temp; end if;
      if v_temp > v_best then v_best := v_temp; end if;
    else
      if i = 0 then v_current := 0; end if;
      v_temp := 0;
    end if;
  end loop;

  return jsonb_build_object('current', v_current, 'best', v_best);
end;
$$;

grant execute on function public.get_macro_hit_streak() to authenticated;

-- ─── get_micronutrient_status ──────────────────────────────────────────────
-- Returns all 25 non-macro nutrients with actual, DRI target, pct_dri, status.

create or replace function public.get_micronutrient_status(p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with per_nutrient as (
    select
      n.slug,
      n.name,
      n.unit,
      n.category,
      n.display_order,
      n.default_dri_male,
      n.dri_upper_limit,
      sum(fn.amount_per_base * mje.amount / f.base_amount) as amount
    from public.meal_journal_entries mje
    join public.foods f on f.id = mje.food_id
    join public.food_nutrients fn on fn.food_id = mje.food_id
    join public.nutrients n on n.id = fn.nutrient_id
    where mje.user_id = auth.uid()
      and mje.logged_date = p_date
      and n.category in ('vitamin','mineral')
    group by n.id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'slug', slug,
      'name', name,
      'unit', unit,
      'category', category,
      'amount', amount,
      'dri', default_dri_male,
      'pct_dri', case when default_dri_male > 0 then round((amount / default_dri_male) * 100, 0) else null end,
      'status', case
        when amount is null or default_dri_male is null then 'unknown'
        when amount < default_dri_male * 0.5   then 'under'
        when amount < default_dri_male * 0.8   then 'low'
        when amount <= default_dri_male * 1.5  then 'ok'
        when dri_upper_limit is not null and amount > dri_upper_limit then 'excess'
        else 'high'
      end
    )
    order by display_order
  ), '[]'::jsonb)
  from per_nutrient;
$$;

grant execute on function public.get_micronutrient_status(date) to authenticated;

-- ─── get_top_foods ─────────────────────────────────────────────────────────

create or replace function public.get_top_foods(
  p_range_start date,
  p_range_end   date,
  p_limit       int default 10
) returns jsonb
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with agg as (
    select
      f.id,
      f.description,
      f.brand_name,
      f.kind,
      count(*) as log_count,
      sum(mje.kcal_snapshot) as total_kcal
    from public.meal_journal_entries mje
    join public.foods f on f.id = mje.food_id
    where mje.user_id = auth.uid()
      and mje.logged_date between p_range_start and p_range_end
    group by f.id, f.description, f.brand_name, f.kind
    order by log_count desc, total_kcal desc
    limit p_limit
  )
  select coalesce(jsonb_agg(row_to_json(agg)), '[]'::jsonb) from agg;
$$;

grant execute on function public.get_top_foods(date, date, int) to authenticated;

-- ─── get_plan_adherence ────────────────────────────────────────────────────
-- Returns macro-level adherence (% of target hit) and meal-level adherence
-- (% of prescribed meals that had a corresponding journal entry). Coarse
-- v1 implementation — considers a meal "hit" if ANY journal entry exists
-- in that meal_slot on that date.

create or replace function public.get_plan_adherence(
  p_plan_id     uuid,
  p_range_start date,
  p_range_end   date
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  v_plan jsonb;
  v_macro_total numeric := 0;
  v_macro_count int := 0;
  v_meals_prescribed int := 0;
  v_meals_hit int := 0;
  v_supp_prescribed int := 0;
  v_supp_hit int := 0;
  v_date date;
  v_day_type text;
  v_targets jsonb;
  v_meal jsonb;
  v_actuals record;
begin
  select plan into v_plan
    from public.meal_plans
    where id = p_plan_id and user_id = auth.uid();
  if v_plan is null then
    return jsonb_build_object('error', 'plan_not_found');
  end if;

  v_date := p_range_start;
  while v_date <= p_range_end loop
    v_day_type := coalesce(
      v_plan->'assignments'->'overrides'->>(v_date::text),
      v_plan->'assignments'->>'default_day_type',
      'rest_day'
    );
    v_targets := v_plan->'targets'->v_day_type;
    if v_targets is not null then
      select
        coalesce(sum(kcal_snapshot),0)      as kcal,
        coalesce(sum(protein_g_snapshot),0) as protein_g,
        coalesce(sum(carbs_g_snapshot),0)   as carbs_g,
        coalesce(sum(fat_g_snapshot),0)     as fat_g
      into v_actuals
      from public.meal_journal_entries
      where user_id = auth.uid() and logged_date = v_date;

      v_macro_total := v_macro_total + (
        least(v_actuals.kcal      / greatest((v_targets->>'kcal')::numeric, 1), 1)
        + least(v_actuals.protein_g / greatest((v_targets->>'protein_g')::numeric, 1), 1)
        + least(v_actuals.carbs_g   / greatest((v_targets->>'carbs_g')::numeric, 1), 1)
        + least(v_actuals.fat_g     / greatest((v_targets->>'fat_g')::numeric, 1), 1)
      );
      v_macro_count := v_macro_count + 4;

      -- Meal-level: for each prescribed meal in the day_type, check if any
      -- journal entry exists in that meal_slot on this date.
      for v_meal in
        select jsonb_array_elements(dt->'meals')
        from jsonb_array_elements(v_plan->'day_types') dt
        where dt->>'slug' = v_day_type
      loop
        v_meals_prescribed := v_meals_prescribed + 1;
        if exists (
          select 1 from public.meal_journal_entries
          where user_id = auth.uid()
            and logged_date = v_date
            and meal_slot = (v_meal->>'slot')
        ) then
          v_meals_hit := v_meals_hit + 1;
        end if;
      end loop;

      -- Supplement-level: each prescribed supplement "hit" if at least one
      -- supplement-kind journal entry exists that day
      for v_meal in
        select jsonb_array_elements(dt->'supplements')
        from jsonb_array_elements(v_plan->'day_types') dt
        where dt->>'slug' = v_day_type
      loop
        v_supp_prescribed := v_supp_prescribed + 1;
        if exists (
          select 1 from public.meal_journal_entries mje
          join public.foods f on f.id = mje.food_id
          where mje.user_id = auth.uid()
            and mje.logged_date = v_date
            and f.kind = 'supplement'
        ) then
          v_supp_hit := v_supp_hit + 1;
        end if;
      end loop;
    end if;
    v_date := v_date + 1;
  end loop;

  return jsonb_build_object(
    'macro_adherence_pct', case when v_macro_count > 0 then round((v_macro_total / v_macro_count) * 100, 0) else 0 end,
    'meal_adherence_pct', case when v_meals_prescribed > 0 then round((v_meals_hit::numeric / v_meals_prescribed) * 100, 0) else 0 end,
    'supplement_adherence_pct', case when v_supp_prescribed > 0 then round((v_supp_hit::numeric / v_supp_prescribed) * 100, 0) else 0 end,
    'meals_prescribed', v_meals_prescribed,
    'meals_hit', v_meals_hit,
    'supplements_prescribed', v_supp_prescribed,
    'supplements_hit', v_supp_hit
  );
end;
$$;

grant execute on function public.get_plan_adherence(uuid, date, date) to authenticated;

-- ─── resolve_day_type_from_jsonb (test helper) ─────────────────────────────
-- Mirrors shared/meal-plan-day-type.js for the cross-fixture test. Takes the
-- JSONB documents directly so the test doesn't need fixtures in the DB.

create or replace function public.resolve_day_type_from_jsonb(
  p_date         date,
  p_meal_plan    jsonb,
  p_workout_plan jsonb
) returns text
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_override text;
  v_mode text;
  v_has_session boolean;
  v_default text;
begin
  v_override := p_meal_plan->'assignments'->'overrides'->>(p_date::text);
  if v_override is not null then
    return v_override;
  end if;

  v_mode := p_meal_plan->'assignments'->>'mode';
  v_default := coalesce(p_meal_plan->'assignments'->>'default_day_type', 'rest_day');

  if v_mode = 'auto_from_workout' and p_workout_plan is not null then
    -- Check schedule array for a matching date
    select exists (
      select 1
      from jsonb_array_elements(coalesce(p_workout_plan->'schedule', '[]'::jsonb)) as entry
      where entry->>'date' = p_date::text
    ) into v_has_session;
    if v_has_session and exists (
      select 1 from jsonb_array_elements(coalesce(p_meal_plan->'day_types', '[]'::jsonb)) dt
      where dt->>'slug' = 'training_day'
    ) then
      return 'training_day';
    end if;
  end if;

  return v_default;
end;
$$;

grant execute on function public.resolve_day_type_from_jsonb(date, jsonb, jsonb) to authenticated, service_role;
