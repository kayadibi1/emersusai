// Internal helper for seeding demo/screenshot accounts.
// Requires explicit credentials so we do not commit a real demo login.

import "dotenv/config";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(scriptDir, "..", ".env.local") });
config({ path: path.join(scriptDir, "..", ".env") });

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const DEFAULT_EMAIL = process.env.SCREENSHOT_PROFILE_EMAIL || null;
const DEFAULT_PASSWORD = process.env.SCREENSHOT_PROFILE_PASSWORD || null;
const DEFAULT_NAME = process.env.SCREENSHOT_PROFILE_NAME || "Screenshot Demo";
const KG_PER_LB = 0.45359237;
const M_PER_MI = 1609.34;

function parseArgs(argv) {
  const opts = {
    email: DEFAULT_EMAIL,
    password: DEFAULT_PASSWORD,
    name: DEFAULT_NAME,
    reset: true,
    dryRun: false,
    startDate: null,
    endDate: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--email") opts.email = argv[++i];
    else if (arg === "--password") opts.password = argv[++i];
    else if (arg === "--name") opts.name = argv[++i];
    else if (arg === "--no-reset") opts.reset = false;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--start-date") opts.startDate = argv[++i];
    else if (arg === "--end-date") opts.endDate = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/seed-screenshot-profile.js [options]

Options:
  --email <email>         Screenshot account email
  --password <password>   Screenshot account password
  --name <full name>      Full name for the fake profile
  --start-date <YYYY-MM-DD>
  --end-date <YYYY-MM-DD>
  --no-reset              Keep existing journal/workout rows
  --dry-run               Print what would happen without writing
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.email) {
    throw new Error("Missing screenshot account email. Pass --email or set SCREENSHOT_PROFILE_EMAIL.");
  }
  if (!opts.password) {
    throw new Error("Missing screenshot account password. Pass --password or set SCREENSHOT_PROFILE_PASSWORD.");
  }

  return opts;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function atLocalDate(dateString, timeString = "12:00:00Z") {
  return new Date(`${dateString}T${timeString}`);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function enumerateDates(startDate, endDate) {
  const dates = [];
  let cursor = atLocalDate(startDate);
  const end = atLocalDate(endDate);
  while (cursor <= end) {
    dates.push(formatDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function lbs(value) {
  return round(value * KG_PER_LB, 2);
}

function miles(value) {
  return round(value * M_PER_MI, 2);
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

function timeFor(dateString, hhmmss) {
  return `${dateString}T${hhmmss}-04:00`;
}

function scaleAmount(amount, factor, min = 0) {
  return Math.max(min, Math.round(amount * factor));
}

function getWeekProfile(week) {
  const deload = week > 0 && week % 5 === 4;
  const travelDip = week === 7;
  const baseGain = week * 0.022;
  const factor = deload
    ? 0.9 + baseGain * 0.45
    : travelDip
      ? 0.96 + baseGain
      : 1 + baseGain;

  return {
    factor,
    deload,
    travelDip,
  };
}

async function findUserByEmail({ supabaseUrl, serviceRoleKey, email }) {
  const response = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase admin lookup failed: ${response.status} ${body.slice(0, 160)}`);
  }
  const payload = await response.json();
  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function ensureUser(admin, opts) {
  const existing = await findUserByEmail({
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    email: opts.email,
  });

  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, {
      password: opts.password,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata || {}),
        full_name: opts.name,
      },
    });
    return { id: existing.id, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: {
      full_name: opts.name,
    },
  });
  if (error) throw error;
  return { id: data.user.id, created: true };
}

async function resolveFood(admin, configItem) {
  const { data, error } = await admin.rpc("foods_search", {
    p_query: configItem.query,
    p_kind: configItem.kind || "food",
    p_generic_only: configItem.kind !== "supplement",
    p_limit: 8,
  });
  if (error) throw error;
  const match = (data || []).find((row) => configItem.match.test(row.description));
  if (!match) {
    throw new Error(`Could not resolve food for ${configItem.key} from query "${configItem.query}"`);
  }
  return match;
}

async function resolveExercise(admin, name) {
  const { data, error } = await admin
    .from("exercises")
    .select("id,name,category")
    .ilike("name", name)
    .limit(1);
  if (error) throw error;
  if (!data?.length) {
    throw new Error(`Exercise not found: ${name}`);
  }
  return data[0];
}

function buildProfile(userId, opts) {
  return {
    id: userId,
    email: opts.email,
    full_name: opts.name,
    display_name_public: opts.name,
    goal: "Build lean muscle, stay athletic, and keep energy high for work.",
    experience_level: "intermediate",
    dietary_preferences: "High-protein Mediterranean-style diet. Eats dairy, eggs, fish, and poultry.",
    injuries_limitations: "No active injuries. Occasionally tight hips from desk work, so prefers a smart warm-up.",
    onboarding_completed: true,
    primary_use_case: "body recomposition",
    equipment_access: "Full commercial gym with barbells, cables, dumbbells, treadmill, and cardio machines.",
    available_days_per_week: 5,
    available_minutes_per_session: 75,
    sleep_stress_context: "Usually sleeps 7-8 hours, moderate work stress, walks most days.",
    weight_unit: "lbs",
    distance_unit: "mi",
    preferred_sports: ["strength", "walking", "conditioning"],
    body_weight_kg: 61.8,
    height_cm: 168,
    date_of_birth: "1996-08-19",
    biological_sex: "female",
    activity_level: "moderate",
    mapbox_privacy_radius_m: 150,
  };
}

function buildMealRows(userId, foods, macroMap, startDate, endDate) {
  const rows = [];
  const dates = enumerateDates(startDate, endDate);

  for (const [index, dateString] of dates.entries()) {
    const day = atLocalDate(dateString).getUTCDay();
    const week = Math.floor(index / 7);
    const { deload, travelDip } = getWeekProfile(week);
    const trainingDay = [1, 2, 4, 6].includes(day);
    const restaurantDinner = day === 6 && week % 3 === 1;
    const lightAppetiteDay = day === 3 || (travelDip && day === 2);
    const missedSnackDay = day === 5 || (deload && day === 0);
    const skippedSupplements = travelDip && day === 1;
    const carbFactor = trainingDay ? 1.06 : 0.95;
    const appetiteFactor = lightAppetiteDay ? 0.88 : restaurantDinner ? 1.12 : 1;
    const recoveryFactor = deload ? 0.94 : 1;
    const baseFactor = carbFactor * appetiteFactor * recoveryFactor;

    const bananaAmount = trainingDay ? scaleAmount(118, baseFactor, 75) : scaleAmount(88, appetiteFactor, 60);
    const oatsAmount = scaleAmount(trainingDay ? 68 : 54, baseFactor, 40);
    const riceAmount = scaleAmount(trainingDay ? 205 : 145, baseFactor, 110);
    const sweetPotatoAmount = scaleAmount(trainingDay ? 235 : 180, appetiteFactor * (deload ? 0.96 : 1), 140);
    const almondAmount = missedSnackDay ? 0 : scaleAmount(trainingDay ? 26 : 20, appetiteFactor, 14);
    const blueberryAmount = scaleAmount(90 + ((index % 3) * 10), lightAppetiteDay ? 0.85 : 1, 70);
    const chickenAmount = scaleAmount(168 + ((index % 2) * 12), trainingDay ? 1.04 : 0.96, 145);
    const salmonAmount = restaurantDinner
      ? scaleAmount(210, 1.08, 170)
      : scaleAmount(160 + (((index + 1) % 2) * 15), appetiteFactor, 145);
    const broccoliAmount = scaleAmount(140 + ((index % 2) * 20), restaurantDinner ? 0.6 : 1, 80);
    const yogurtAmount = scaleAmount(trainingDay ? 195 : 175, lightAppetiteDay ? 0.92 : 1, 140);
    const avocadoAmount = restaurantDinner ? scaleAmount(95, 1.1, 80) : scaleAmount(trainingDay ? 58 : 78, appetiteFactor, 45);

    const plan = [
      {
        food: foods.oats,
        amount: oatsAmount,
        meal_slot: "breakfast",
        logged_at: timeFor(dateString, "08:05:00"),
      },
      {
        food: foods.greekYogurt,
        amount: yogurtAmount,
        meal_slot: "breakfast",
        logged_at: timeFor(dateString, "08:08:00"),
      },
      {
        food: foods.blueberries,
        amount: blueberryAmount,
        meal_slot: "breakfast",
        logged_at: timeFor(dateString, "08:10:00"),
      },
      {
        food: foods.chicken,
        amount: chickenAmount,
        meal_slot: "lunch",
        logged_at: timeFor(dateString, "12:35:00"),
      },
      {
        food: foods.rice,
        amount: riceAmount,
        meal_slot: "lunch",
        logged_at: timeFor(dateString, "12:37:00"),
      },
      {
        food: foods.broccoli,
        amount: broccoliAmount,
        meal_slot: "lunch",
        logged_at: timeFor(dateString, "12:39:00"),
      },
      {
        food: foods.salmon,
        amount: salmonAmount,
        meal_slot: "dinner",
        logged_at: timeFor(dateString, "19:05:00"),
      },
      {
        food: foods.sweetPotato,
        amount: sweetPotatoAmount,
        meal_slot: "dinner",
        logged_at: timeFor(dateString, "19:08:00"),
      },
      {
        food: foods.avocado,
        amount: avocadoAmount,
        meal_slot: "dinner",
        logged_at: timeFor(dateString, "19:10:00"),
      },
    ];

    if (!skippedSupplements) {
      plan.unshift({
        food: foods.creatine,
        amount: 5,
        meal_slot: "supplements_am",
        logged_at: timeFor(dateString, "07:15:00"),
      });
    }

    if (almondAmount > 0) {
      plan.push({
        food: foods.almonds,
        amount: almondAmount,
        meal_slot: "afternoon",
        logged_at: timeFor(dateString, "16:00:00"),
      });
    }

    if (trainingDay) {
      plan.push(
        {
          food: foods.banana,
          amount: bananaAmount,
          meal_slot: "post_workout",
          logged_at: timeFor(dateString, "18:05:00"),
        },
        {
          food: foods.whey,
          amount: scaleAmount(deload ? 24 : 30, lightAppetiteDay ? 0.9 : 1, 20),
          meal_slot: "post_workout",
          logged_at: timeFor(dateString, "18:10:00"),
        }
      );
    } else {
      plan.push({
        food: foods.eggs,
        amount: 140,
        meal_slot: "mid_morning",
        logged_at: timeFor(dateString, "10:45:00"),
      });
    }

    if (restaurantDinner) {
      plan.push({
        food: foods.rice,
        amount: 120,
        meal_slot: "evening",
        logged_at: timeFor(dateString, "21:05:00"),
      });
    }

    for (const entry of plan) {
      const macros = macroMap[entry.food.id];
      const factor = entry.amount / entry.food.base_amount;
      rows.push({
        user_id: userId,
        food_id: entry.food.id,
        logged_date: dateString,
        meal_slot: entry.meal_slot,
        logged_at: entry.logged_at,
        amount: entry.amount,
        amount_unit: "g",
        source: "manual_search",
        confidence: 0.98,
        notes: null,
        kcal_snapshot: round(macros.energy_kcal * factor),
        protein_g_snapshot: round(macros.protein * factor),
        carbs_g_snapshot: round(macros.carbohydrate * factor),
        fat_g_snapshot: round(macros.total_fat * factor),
        fiber_g_snapshot: round(macros.fiber * factor),
      });
    }
  }

  return rows;
}

function buildWorkoutRows(userId, exercises, startDate, endDate) {
  const rows = [];
  const dates = enumerateDates(startDate, endDate);
  let trainingWeek = -1;

  for (const dateString of dates) {
    const date = atLocalDate(dateString);
    const day = date.getUTCDay();

    if (day === 1) trainingWeek += 1;
    const week = Math.max(trainingWeek, 0);
    const weekProfile = getWeekProfile(week);
    const missedSaturdayLift = week === 7 || (week % 6 === 5 && day === 6);
    const skippedRecoveryWalk = (week % 4 === 2 && day === 0) || weekProfile.travelDip;

    if (day === 1) {
      addResistanceDay(rows, userId, dateString, [
        sessionExercise(exercises.backSquat, 4, 5, 135 + week * 5, 8.0, { week }),
        sessionExercise(exercises.rdl, 3, 8, 95 + week * 5, 8.0, { week }),
        sessionExercise(exercises.legPress, 3, 10, 180 + week * 10, 8.5, { week }),
        sessionExercise(exercises.dumbbellLunge, 3, 10, 25 + Math.floor(week / 2) * 5, 8.0, { week }),
        sessionExercise(exercises.legCurl, 3, 12, 70 + week * 5, 8.5, { week }),
      ]);
    }

    if (day === 2) {
      addResistanceDay(rows, userId, dateString, [
        sessionExercise(exercises.bench, 4, 5, 95 + week * 5, 8.0, { week }),
        sessionExercise(exercises.latPulldown, 3, 10, 70 + week * 5, 8.0, { week }),
        sessionExercise(exercises.inclineDbBench, 3, 10, 30 + Math.floor(week / 2) * 5, 8.0, { week }),
        sessionExercise(exercises.cableRow, 3, 10, 70 + week * 5, 8.0, { week }),
        sessionExercise(exercises.dbShoulderPress, 3, 10, 22.5 + Math.floor(week / 2) * 5, 8.5, { week }),
        sessionExercise(exercises.barbellCurl, 2, 12, 35 + Math.floor(week / 2) * 5, 8.5, { week }),
      ]);
    }

    if (day === 4) {
      addResistanceDay(rows, userId, dateString, [
        sessionExercise(exercises.hipThrust, 4, 8, 115 + week * 10, 8.0, { week }),
        sessionExercise(exercises.gobletSquat, 3, 12, 45 + Math.floor(week / 2) * 5, 8.0, { week }),
        sessionExercise(exercises.legPress, 3, 12, 200 + week * 10, 8.5, { week }),
        sessionExercise(exercises.bulgarianSplitSquat, 3, 10, 20 + Math.floor(week / 3) * 5, 8.5, { week }),
        sessionExercise(exercises.legCurl, 3, 12, 75 + week * 5, 8.5, { week }),
      ]);
    }

    if (day === 6 && !missedSaturdayLift) {
      addResistanceDay(rows, userId, dateString, [
        sessionExercise(exercises.pullUp, 4, 6 + Math.min(week, 4), null, 8.5, { week }),
        sessionExercise(exercises.inclineDbBench, 3, 10, 32.5 + Math.floor(week / 2) * 5, 8.0, { week }),
        sessionExercise(exercises.cableRow, 3, 12, 75 + week * 5, 8.0, { week }),
        sessionExercise(exercises.dbShoulderPress, 3, 10, 25 + Math.floor(week / 2) * 5, 8.5, { week }),
        sessionExercise(exercises.barbellCurl, 3, 12, 40 + Math.floor(week / 2) * 5, 8.5, { week }),
      ]);

      rows.push({
        user_id: userId,
        exercise_id: exercises.elliptical.id,
        plan_id: null,
        session_id: null,
        performed_at: dateString,
        duration_seconds: Math.round((22 * 60 + week * 28) * (weekProfile.deload ? 0.88 : 1)),
        distance_meters: miles((2.1 + week * 0.05) * (weekProfile.deload ? 0.92 : 1)),
        activity_type: "elliptical",
        notes: weekProfile.deload ? "Lighter zone 2 finisher during deload week." : "Steady zone 2 finisher.",
      });
    }

    if (day === 0 && !skippedRecoveryWalk) {
      rows.push({
        user_id: userId,
        exercise_id: exercises.walking.id,
        plan_id: null,
        session_id: null,
        performed_at: dateString,
        duration_seconds: Math.round((42 * 60 + week * 55) * (weekProfile.deload ? 0.9 : 1)),
        distance_meters: miles((2.7 + week * 0.08) * (weekProfile.deload ? 0.92 : 1)),
        activity_type: "walking",
        notes: weekProfile.travelDip ? "Shorter recovery walk after a busy week." : "Easy recovery walk outdoors.",
      });
    }
  }

  return rows;
}

function sessionExercise(exercise, sets, reps, loadLbs, rpe, opts = {}) {
  return { exercise, sets, reps, loadLbs, rpe, ...opts };
}

function addResistanceDay(rows, userId, dateString, exercises) {
  for (const block of exercises) {
    const weekProfile = getWeekProfile(block.week || 0);
    const loadFactor = weekProfile.deload ? 0.9 : weekProfile.travelDip ? 0.96 : 1;
    const repPenalty = weekProfile.deload ? 0 : weekProfile.travelDip ? 1 : 0;
    for (let set = 1; set <= block.sets; set += 1) {
      const repDrift = set === block.sets ? -1 : 0;
      const fatiguePenalty = set === block.sets && !weekProfile.deload ? 1 : 0;
      const variedRpe = block.rpe + (set === block.sets ? 0.5 : 0) + (weekProfile.travelDip ? 0.2 : 0) - (weekProfile.deload ? 0.4 : 0);
      rows.push({
        user_id: userId,
        exercise_id: block.exercise.id,
        plan_id: null,
        session_id: null,
        performed_at: dateString,
        set_number: set,
        reps: Math.max(4, block.reps + repDrift - fatiguePenalty - repPenalty),
        load_kg: block.loadLbs == null ? null : lbs(block.loadLbs * loadFactor),
        rpe: round(variedRpe, 1),
        notes: weekProfile.deload && set === 1 ? "Deload week - moved crisply." : null,
      });
    }
  }
}

async function fetchFoodMacroMap(admin, foods) {
  const requiredSlugs = [
    "energy_kcal",
    "protein",
    "carbohydrate",
    "total_fat",
    "fiber",
  ];
  const { data: nutrients, error: nutrientError } = await admin
    .from("nutrients")
    .select("id,slug")
    .in("slug", requiredSlugs);
  if (nutrientError) throw nutrientError;

  const nutrientIdToSlug = Object.fromEntries(nutrients.map((row) => [row.id, row.slug]));
  const foodIds = Object.values(foods).map((food) => food.id);
  const { data: foodNutrients, error: foodNutrientError } = await admin
    .from("food_nutrients")
    .select("food_id,nutrient_id,amount_per_base")
    .in("food_id", foodIds)
    .in("nutrient_id", nutrients.map((row) => row.id));
  if (foodNutrientError) throw foodNutrientError;

  const macroMap = {};
  for (const food of Object.values(foods)) {
    macroMap[food.id] = {
      energy_kcal: 0,
      protein: 0,
      carbohydrate: 0,
      total_fat: 0,
      fiber: 0,
    };
  }

  for (const row of foodNutrients) {
    const slug = nutrientIdToSlug[row.nutrient_id];
    if (!slug) continue;
    macroMap[row.food_id][slug] = Number(row.amount_per_base || 0);
  }

  return macroMap;
}

async function deleteExistingHistory(admin, userId) {
  const { error: mealError } = await admin
    .from("meal_journal_entries")
    .delete()
    .eq("user_id", userId);
  if (mealError) throw mealError;

  const { error: workoutError } = await admin
    .from("workout_logs")
    .delete()
    .eq("user_id", userId);
  if (workoutError) throw workoutError;
}

async function insertBatches(admin, table, rows, size = 500) {
  for (const batch of chunk(rows, size)) {
    const { error } = await admin.from(table).insert(batch);
    if (error) throw error;
  }
}

async function verifyLogin(email, password) {
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await anon.auth.signOut();
  return data.user?.id || null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const endDate = opts.endDate || formatDate(new Date());
  const startDate = opts.startDate || formatDate(addDays(atLocalDate(endDate), -89));

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const user = await ensureUser(admin, opts);
  const profile = buildProfile(user.id, opts);

  const foods = {
    oats: await resolveFood(admin, {
      key: "oats",
      query: "oats",
      match: /^Oats, raw$/i,
    }),
    blueberries: await resolveFood(admin, {
      key: "blueberries",
      query: "blueberries",
      match: /^Blueberries, raw$/i,
    }),
    banana: await resolveFood(admin, {
      key: "banana",
      query: "banana raw",
      match: /^Banana, raw$/i,
    }),
    greekYogurt: await resolveFood(admin, {
      key: "greekYogurt",
      query: "greek yogurt plain nonfat",
      match: /^Yogurt, Greek, plain, nonfat$/i,
    }),
    chicken: await resolveFood(admin, {
      key: "chicken",
      query: "chicken breast meat only cooked roasted",
      match: /^Chicken, broilers or fryers, breast, meat only, cooked, roasted$/i,
    }),
    rice: await resolveFood(admin, {
      key: "rice",
      query: "rice white cooked no added fat",
      match: /^Rice, white, cooked, no added fat$/i,
    }),
    broccoli: await resolveFood(admin, {
      key: "broccoli",
      query: "broccoli boiled drained without salt",
      match: /^Broccoli, cooked, boiled, drained, without salt$/i,
    }),
    salmon: await resolveFood(admin, {
      key: "salmon",
      query: "salmon atlantic farmed cooked dry heat",
      match: /^Fish, salmon, Atlantic, farmed, cooked, dry heat$/i,
    }),
    sweetPotato: await resolveFood(admin, {
      key: "sweetPotato",
      query: "sweet potato baked no added fat",
      match: /^Sweet potato, baked, no added fat$/i,
    }),
    eggs: await resolveFood(admin, {
      key: "eggs",
      query: "egg whole boiled",
      match: /^Egg, whole, boiled or poached$/i,
    }),
    avocado: await resolveFood(admin, {
      key: "avocado",
      query: "avocado raw",
      match: /^Avocado, raw$/i,
    }),
    almonds: await resolveFood(admin, {
      key: "almonds",
      query: "almonds",
      match: /^Nuts, almonds$/i,
    }),
    whey: await resolveFood(admin, {
      key: "whey",
      query: "whey protein",
      kind: "supplement",
      match: /^Whey protein isolate, powder$/i,
    }),
    creatine: await resolveFood(admin, {
      key: "creatine",
      query: "creatine monohydrate",
      kind: "supplement",
      match: /^Creatine monohydrate, powder$/i,
    }),
  };

  const exercises = {
    backSquat: await resolveExercise(admin, "Barbell Back Squat"),
    rdl: await resolveExercise(admin, "Romanian Deadlift"),
    legPress: await resolveExercise(admin, "Leg Press"),
    dumbbellLunge: await resolveExercise(admin, "Dumbbell Lunge"),
    legCurl: await resolveExercise(admin, "Leg Curl"),
    bench: await resolveExercise(admin, "Barbell Bench Press"),
    latPulldown: await resolveExercise(admin, "Lat Pulldown"),
    inclineDbBench: await resolveExercise(admin, "Incline Dumbbell Bench Press"),
    cableRow: await resolveExercise(admin, "Cable Row"),
    dbShoulderPress: await resolveExercise(admin, "Dumbbell Shoulder Press"),
    hipThrust: await resolveExercise(admin, "Barbell Hip Thrust"),
    gobletSquat: await resolveExercise(admin, "Goblet Squat"),
    bulgarianSplitSquat: await resolveExercise(admin, "Bulgarian Split Squat"),
    pullUp: await resolveExercise(admin, "Pull-Up"),
    barbellCurl: await resolveExercise(admin, "Barbell Curl"),
    walking: await resolveExercise(admin, "Walking"),
    elliptical: await resolveExercise(admin, "Elliptical"),
  };

  const macroMap = await fetchFoodMacroMap(admin, foods);
  const mealRows = buildMealRows(user.id, foods, macroMap, startDate, endDate);
  const workoutRows = buildWorkoutRows(user.id, exercises, startDate, endDate);

  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          account: {
            email: opts.email,
            password: opts.password,
            name: opts.name,
          },
          createdUser: user.created,
          dateRange: { startDate, endDate },
          profile,
          meals: mealRows.length,
          workouts: workoutRows.length,
        },
        null,
        2
      )
    );
    return;
  }

  if (opts.reset) {
    await deleteExistingHistory(admin, user.id);
  }

  const { error: profileError } = await admin.from("profiles").upsert(profile);
  if (profileError) throw profileError;

  await insertBatches(admin, "meal_journal_entries", mealRows, 400);
  await insertBatches(admin, "workout_logs", workoutRows, 400);

  const verifiedUserId = await verifyLogin(opts.email, opts.password);

  const [{ count: mealCount, error: mealCountError }, { count: workoutCount, error: workoutCountError }] =
    await Promise.all([
      admin.from("meal_journal_entries").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      admin.from("workout_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    ]);
  if (mealCountError) throw mealCountError;
  if (workoutCountError) throw workoutCountError;

  console.log(
    JSON.stringify(
      {
        account: {
          email: opts.email,
          password: opts.password,
          name: opts.name,
        },
        userId: user.id,
        verifiedUserId,
        createdUser: user.created,
        resetHistory: opts.reset,
        dateRange: { startDate, endDate },
        rows: {
          mealJournalEntries: mealCount,
          workoutLogs: workoutCount,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
