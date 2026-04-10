-- Analytics RPCs for the progress dashboard.
-- All functions take user_id + date range and return JSON.
-- Called from the frontend via supabase.rpc().

-- ── get_progress_dashboard ──────────────────────────────────────────

create or replace function public.get_progress_dashboard(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'sessions_completed', count(distinct case
      when e.category <> 'cardio' then wl.session_id
    end),
    'total_volume_kg', coalesce(sum(
      case when e.category <> 'cardio' and wl.reps is not null and wl.load_kg is not null
           then wl.reps * wl.load_kg
           else 0
      end
    ), 0)::numeric,
    'total_cardio_seconds', coalesce(sum(
      case when e.category = 'cardio' then wl.duration_seconds else 0 end
    ), 0),
    'cardio_session_count', count(distinct case
      when e.category = 'cardio' then wl.session_id
    end),
    'unique_exercises', count(distinct wl.exercise_id),
    -- Adherence: count scheduled sessions from the active plan JSONB
    'sessions_scheduled', (
      select count(*)
      from public.workout_plans wp,
           lateral jsonb_array_elements(wp.plan -> 'sessions') as s
      where wp.user_id = p_user_id
        and wp.archived_at is null
        and (s ->> 'date')::date between p_range_start and p_range_end
    ),
    'adherence_pct', case
      when (
        select count(*)
        from public.workout_plans wp,
             lateral jsonb_array_elements(wp.plan -> 'sessions') as s
        where wp.user_id = p_user_id
          and wp.archived_at is null
          and (s ->> 'date')::date between p_range_start and p_range_end
      ) > 0 then round(
        count(distinct case when e.category <> 'cardio' then wl.session_id end)::numeric * 100 /
        (select count(*)
         from public.workout_plans wp,
              lateral jsonb_array_elements(wp.plan -> 'sessions') as s
         where wp.user_id = p_user_id
           and wp.archived_at is null
           and (s ->> 'date')::date between p_range_start and p_range_end
        )
      ) else 0 end
  ) into v_result
  from public.workout_logs wl
  join public.exercises e on e.id = wl.exercise_id
  where wl.user_id = p_user_id
    and wl.performed_at between p_range_start and p_range_end;

  return v_result;
end;
$$;

-- ── get_weekly_activity ─────────────────────────────────────────────

create or replace function public.get_weekly_activity(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub) order by sub.week_start)
    from (
      select
        date_trunc('week', wl.performed_at::timestamp)::date as week_start,
        coalesce(sum(case
          when e.category <> 'cardio' and wl.reps is not null and wl.load_kg is not null
          then wl.reps * wl.load_kg else 0
        end), 0)::numeric as resistance_volume_kg,
        coalesce(sum(case
          when e.category = 'cardio' then wl.duration_seconds else 0
        end), 0) as cardio_duration_seconds
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
        and wl.performed_at between p_range_start and p_range_end
      group by 1
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_muscle_volume ───────────────────────────────────────────────

create or replace function public.get_muscle_volume(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub) order by sub.volume_kg desc)
    from (
      select
        mg as muscle_group,
        sum(wl.reps * wl.load_kg)::numeric as volume_kg
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id,
      lateral unnest(e.muscle_groups) as mg
      where wl.user_id = p_user_id
        and wl.performed_at between p_range_start and p_range_end
        and e.category <> 'cardio'
        and wl.reps is not null
        and wl.load_kg is not null
      group by mg
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_recent_sessions ─────────────────────────────────────────────

create or replace function public.get_recent_sessions(
  p_user_id uuid,
  p_limit   int default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        wl.plan_id,
        wl.session_id,
        wl.performed_at,
        -- Extract session title from plan JSONB
        coalesce((
          select s ->> 'title'
          from public.workout_plans wp,
               lateral jsonb_array_elements(wp.plan -> 'sessions') as s
          where wp.id = wl.plan_id
            and s ->> 'id' = wl.session_id
          limit 1
        ), wl.session_id) as session_title,
        count(distinct wl.exercise_id) as exercise_count,
        coalesce(sum(
          case when wl.reps is not null and wl.load_kg is not null
               then wl.reps * wl.load_kg else 0 end
        ), 0)::numeric as volume_kg,
        coalesce(sum(wl.duration_seconds), 0) as cardio_seconds,
        case
          when bool_or(e.category = 'cardio') and not bool_or(e.category <> 'cardio') then 'cardio'
          when bool_or(e.category <> 'cardio') and not bool_or(e.category = 'cardio') then 'resistance'
          else 'mixed'
        end as category
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
      group by wl.plan_id, wl.session_id, wl.performed_at
      order by wl.performed_at desc
      limit p_limit
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_top_exercises ───────────────────────────────────────────────

create or replace function public.get_top_exercises(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date,
  p_limit       int default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        e.id as exercise_id,
        e.slug,
        e.name,
        e.category,
        e.movement_type,
        count(distinct (wl.plan_id, wl.session_id)) as session_count,
        case when e.category <> 'cardio' then
          max(wl.load_kg)
        end as best_load_kg,
        case when e.category <> 'cardio' then
          max(case when wl.reps is not null and wl.load_kg is not null
                   then wl.load_kg * (1 + wl.reps::numeric / 30)
          end)::numeric(6,1)
        end as best_e1rm_kg,
        case when e.category = 'cardio' then
          sum(wl.duration_seconds)
        end as total_duration_seconds,
        case when e.category = 'cardio' then
          sum(wl.distance_meters)::numeric(10,1)
        end as total_distance_meters
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
        and wl.performed_at between p_range_start and p_range_end
      group by e.id, e.slug, e.name, e.category, e.movement_type
      order by session_count desc
      limit p_limit
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_exercise_history ────────────────────────────────────────────

create or replace function public.get_exercise_history(
  p_user_id     uuid,
  p_exercise_id uuid,
  p_limit       int default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        wl.performed_at,
        wl.plan_id,
        wl.session_id,
        count(*) as set_count,
        max(wl.load_kg) as max_load_kg,
        max(wl.reps) as max_reps,
        sum(case when wl.reps is not null and wl.load_kg is not null
                 then wl.reps * wl.load_kg else 0 end)::numeric as volume_kg,
        max(case when wl.reps is not null and wl.load_kg is not null
                 then wl.load_kg * (1 + wl.reps::numeric / 30)
        end)::numeric(6,1) as e1rm_kg,
        sum(wl.duration_seconds) as total_duration_seconds,
        sum(wl.distance_meters)::numeric(10,1) as total_distance_meters
      from public.workout_logs wl
      where wl.user_id = p_user_id
        and wl.exercise_id = p_exercise_id
      group by wl.performed_at, wl.plan_id, wl.session_id
      order by wl.performed_at desc
      limit p_limit
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_session_detail ──────────────────────────────────────────────

create or replace function public.get_session_detail(
  p_user_id    uuid,
  p_plan_id    uuid,
  p_session_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      select
        e.name as exercise_name,
        e.slug as exercise_slug,
        e.category,
        wl.set_number,
        wl.reps,
        wl.load_kg,
        wl.rpe,
        wl.duration_seconds,
        wl.distance_meters,
        wl.avg_heart_rate,
        wl.calories,
        wl.notes,
        wl.performed_at
      from public.workout_logs wl
      join public.exercises e on e.id = wl.exercise_id
      where wl.user_id = p_user_id
        and wl.plan_id = p_plan_id
        and wl.session_id = p_session_id
      order by e.name, wl.set_number
    ) sub
  ), '[]'::jsonb);
end;
$$;

-- ── get_personal_records ────────────────────────────────────────────

create or replace function public.get_personal_records(
  p_user_id     uuid,
  p_range_start date,
  p_range_end   date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(sub))
    from (
      -- For each exercise, find the all-time best e1RM and check if
      -- it was achieved within the requested date range.
      select
        e.name as exercise_name,
        e.slug,
        e.category,
        'e1rm' as pr_type,
        best_in_range.e1rm as value,
        best_in_range.performed_at as achieved_at
      from (
        select
          wl.exercise_id,
          wl.performed_at,
          (wl.load_kg * (1 + wl.reps::numeric / 30))::numeric(6,1) as e1rm,
          row_number() over (
            partition by wl.exercise_id
            order by (wl.load_kg * (1 + wl.reps::numeric / 30)) desc
          ) as rn
        from public.workout_logs wl
        join public.exercises e2 on e2.id = wl.exercise_id
        where wl.user_id = p_user_id
          and e2.category <> 'cardio'
          and wl.reps is not null
          and wl.load_kg is not null
          and wl.load_kg > 0
      ) best_in_range
      join public.exercises e on e.id = best_in_range.exercise_id
      where best_in_range.rn = 1
        and best_in_range.performed_at between p_range_start and p_range_end
      order by best_in_range.e1rm desc
    ) sub
  ), '[]'::jsonb);
end;
$$;
