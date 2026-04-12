// scripts/import-usda-foods.js
//
// One-time USDA FoodData Central importer. Populates public.foods and
// public.food_nutrients with four datasets:
//   - Foundation  (~200 items, research-grade)
//   - SR Legacy   (~7,800 items, classic USDA DB)
//   - FNDDS       (~7,000 items, survey/prepared foods)
//   - Branded     (~1,800,000 items, manufacturer-submitted)
//
// Requires supabase_admin-equivalent permissions (uses service_role key
// bypassing RLS). Set SUPABASE_SERVICE_ROLE_KEY in .env / .env.local.
//
// Usage:
//   node scripts/import-usda-foods.js                      # all four
//   node scripts/import-usda-foods.js --datasets=foundation,sr_legacy
//   node scripts/import-usda-foods.js --resume              # pick up from checkpoint
//   node scripts/import-usda-foods.js --dry-run             # parse only, no writes
//
// Idempotent: safe to re-run. Uses fdc_id upserts.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync, statfsSync, renameSync, unlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import StreamArray from "stream-json/streamers/StreamArray.js";
import parserPkg from "stream-json/Parser.js";
const { parser } = parserPkg;
import pickPkg from "stream-json/filters/Pick.js";
const { pick } = pickPkg;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ───── Config ──────────────────────────────────────────────────────────────

const DATASETS = {
  foundation: {
    slug: "foundation",
    source: "usda_foundation",
    // USDA publishes these as a single zipped JSON bundle per dataset.
    // URL format changes periodically; these are as of 2026-04.
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2025-10-31.zip",
    batchSize: 1000,
    jsonKey: "FoundationFoods",
  },
  sr_legacy: {
    slug: "sr_legacy",
    source: "usda_sr_legacy",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip",
    batchSize: 1000,
    jsonKey: "SRLegacyFoods",
  },
  fndds: {
    slug: "fndds",
    source: "usda_fndds",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
    batchSize: 1000,
    jsonKey: "SurveyFoods",
  },
  branded: {
    slug: "branded",
    source: "usda_branded",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_json_2025-10-31.zip",
    batchSize: 500,
    jsonKey: "BrandedFoods",
    streaming: true, // stream-parse instead of loading whole JSON
  },
};

const TEMP_DIR = join(tmpdir(), "emersus-usda-import");
const CHECKPOINT_FILE = join(TEMP_DIR, "checkpoint.json");
const MIN_FREE_GB = 15;

// ───── CLI arg parsing ─────────────────────────────────────────────────────

function parseArgs() {
  const args = { datasets: Object.keys(DATASETS), resume: false, dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--resume") args.resume = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--datasets=")) {
      args.datasets = arg.split("=")[1].split(",").map(s => s.trim());
    }
  }
  return args;
}

// ───── Disk space preflight ────────────────────────────────────────────────

function checkDiskSpace() {
  try {
    const stats = statfsSync(tmpdir());
    const freeGb = (stats.bavail * stats.bsize) / 1e9;
    if (freeGb < MIN_FREE_GB) {
      throw new Error(`Need at least ${MIN_FREE_GB} GB free in ${tmpdir()}, only ${freeGb.toFixed(1)} GB available`);
    }
    console.log(`  disk check: ${freeGb.toFixed(1)} GB free in ${tmpdir()} ✓`);
  } catch (err) {
    if (err.code === "ENOSYS") {
      // statfsSync not available on all platforms; log and continue
      console.warn("  disk check: statfsSync not supported on this platform, skipping");
    } else {
      throw err;
    }
  }
}

// ───── Checkpoint read/write ───────────────────────────────────────────────

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return { completed: {}, lastFdcId: {} };
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8"));
  } catch {
    return { completed: {}, lastFdcId: {} };
  }
}

function saveCheckpoint(checkpoint) {
  const tmp = CHECKPOINT_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(checkpoint, null, 2));
  // `renameSync` replaces the target atomically on POSIX; on Windows it fails
  // if the target exists, so unlink first there. Simplest portable form:
  try {
    renameSync(tmp, CHECKPOINT_FILE);
  } catch (err) {
    // Windows fallback: remove target then rename
    unlinkSync(CHECKPOINT_FILE);
    renameSync(tmp, CHECKPOINT_FILE);
  }
}

// ───── Nutrient ID mapping (loaded from DB) ─────────────────────────────────

let NUTRIENT_MAP = null;

async function loadNutrientMap() {
  if (NUTRIENT_MAP) return NUTRIENT_MAP;
  const { data, error } = await supabase
    .from("nutrients")
    .select("id, fdc_nutrient_id, slug");
  if (error) throw error;
  NUTRIENT_MAP = new Map();
  for (const row of data) NUTRIENT_MAP.set(row.fdc_nutrient_id, row);
  console.log(`  loaded ${NUTRIENT_MAP.size} nutrient mappings`);
  return NUTRIENT_MAP;
}

// ───── Downloader ──────────────────────────────────────────────────────────

async function downloadDataset(dataset) {
  mkdirSync(TEMP_DIR, { recursive: true });
  const zipPath = join(TEMP_DIR, `${dataset.slug}.zip`);
  const jsonPath = join(TEMP_DIR, `${dataset.slug}.json`);

  if (existsSync(jsonPath)) {
    console.log(`  ${dataset.slug}: reusing cached JSON at ${jsonPath}`);
    return jsonPath;
  }

  console.log(`  ${dataset.slug}: downloading ${dataset.url}...`);
  const res = await fetch(dataset.url);
  if (!res.ok) throw new Error(`Download failed for ${dataset.slug}: ${res.status}`);
  const { Readable } = await import("node:stream");
  const { createWriteStream } = await import("node:fs");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  console.log(`  ${dataset.slug}: downloaded ${(statSync(zipPath).size / 1e6).toFixed(1)} MB`);

  // Use unzip via child_process (avoids another npm dep for zip handling)
  const { execSync } = await import("node:child_process");
  execSync(`unzip -p "${zipPath}" > "${jsonPath}"`, { stdio: "inherit" });
  console.log(`  ${dataset.slug}: unzipped to ${jsonPath}`);
  return jsonPath;
}

// ───── Quality filter (Branded Foods) ──────────────────────────────────────

function isValidFood(food, nutrientMap) {
  if (!food.description || food.description.trim().length < 2) return false;
  const nutrients = (food.foodNutrients || food.nutrients || []).filter(n =>
    nutrientMap.has(n.nutrientId ?? n.nutrient?.id)
  );
  if (nutrients.length === 0) return false;
  const hasKcal = nutrients.some(n => {
    const nid = n.nutrientId ?? n.nutrient?.id;
    return nutrientMap.get(nid)?.slug === "energy_kcal";
  });
  if (!hasKcal) return false;
  return true;
}

// ───── Food row → DB row mappers ───────────────────────────────────────────

function mapFoodToRow(food, source) {
  const description = (food.description || "").slice(0, 500);
  const brandName = food.brandOwner || food.brandName || null;
  const categoryObj = food.foodCategory || food.wweiaFoodCategory;
  const category =
    typeof categoryObj === "string"
      ? categoryObj
      : categoryObj?.description || food.brandedFoodCategory || null;
  let commonUnit = null;
  let commonUnitGrams = null;
  const portions = food.foodPortions || [];
  if (portions.length > 0) {
    const p = portions[0];
    commonUnit = p.modifier || p.measureUnit?.name || null;
    commonUnitGrams = p.gramWeight || null;
  }
  return {
    fdc_id: food.fdcId,
    description,
    kind: "food",
    source,
    category: category?.slice(0, 200) ?? null,
    common_unit: commonUnit?.slice(0, 50) ?? null,
    common_unit_grams: commonUnitGrams,
    base_unit: "100g",
    base_amount: 100,
    brand_name: brandName?.slice(0, 200) ?? null,
    gtin_upc: food.gtinUpc?.slice(0, 50) ?? null,
    ingredients_text: food.ingredients?.slice(0, 4000) ?? null,
    data_points: typeof food.dataPoints === "number" ? food.dataPoints : null,
  };
}

function mapNutrientsToRows(food, foodId, nutrientMap) {
  const rows = [];
  const seen = new Set();
  for (const n of food.foodNutrients || food.nutrients || []) {
    const fdcNutrientId = n.nutrientId ?? n.nutrient?.id;
    const mapping = nutrientMap.get(fdcNutrientId);
    if (!mapping) continue;
    if (seen.has(mapping.id)) continue; // dedup same nutrient twice
    const amount = n.amount ?? n.value;
    if (typeof amount !== "number" || isNaN(amount) || amount < 0) continue;
    rows.push({
      food_id: foodId,
      nutrient_id: mapping.id,
      amount_per_base: amount,
    });
    seen.add(mapping.id);
  }
  return rows;
}

// ───── Dataset processor (non-streaming — Foundation/SR/FNDDS) ─────────────

async function processDatasetInMemory(dataset, nutrientMap, checkpoint, dryRun) {
  const jsonPath = await downloadDataset(dataset);
  console.log(`  ${dataset.slug}: loading ${jsonPath} into memory...`);
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const foods = data[dataset.jsonKey] || data;
  if (!Array.isArray(foods)) {
    throw new Error(`${dataset.slug}: expected an array at key ${dataset.jsonKey}`);
  }
  console.log(`  ${dataset.slug}: ${foods.length} entries`);

  let inserted = 0;
  let skipped = 0;
  const startId = checkpoint.lastFdcId[dataset.slug] ?? 0;
  let batch = [];

  for (const food of foods) {
    if (food.fdcId <= startId) continue;
    if (!isValidFood(food, nutrientMap)) {
      skipped++;
      continue;
    }
    batch.push(food);
    if (batch.length >= dataset.batchSize) {
      if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
      inserted += batch.length;
      checkpoint.lastFdcId[dataset.slug] = batch[batch.length - 1].fdcId;
      saveCheckpoint(checkpoint);
      process.stdout.write(`  ${dataset.slug}: ${inserted} inserted / ${skipped} skipped\r`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
    inserted += batch.length;
  }
  console.log(`\n  ${dataset.slug}: done — ${inserted} inserted, ${skipped} skipped`);
  checkpoint.completed[dataset.slug] = true;
  saveCheckpoint(checkpoint);
}

// ───── Streaming dataset processor (Branded Foods) ─────────────────────────

async function processDatasetStreaming(dataset, nutrientMap, checkpoint, dryRun) {
  const jsonPath = await downloadDataset(dataset);
  console.log(`  ${dataset.slug}: streaming parse of ${jsonPath}`);
  let inserted = 0;
  let skipped = 0;
  const startId = checkpoint.lastFdcId[dataset.slug] ?? 0;
  let batch = [];

  const stream = createReadStream(jsonPath)
    .pipe(parser())
    .pipe(pick({ filter: dataset.jsonKey }))
    .pipe(new StreamArray());

  for await (const chunk of stream) {
    const food = chunk.value;
    if (food.fdcId <= startId) continue;
    if (!isValidFood(food, nutrientMap)) {
      skipped++;
      continue;
    }
    batch.push(food);
    if (batch.length >= dataset.batchSize) {
      if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
      inserted += batch.length;
      checkpoint.lastFdcId[dataset.slug] = batch[batch.length - 1].fdcId;
      saveCheckpoint(checkpoint);
      process.stdout.write(`  ${dataset.slug}: ${inserted} inserted / ${skipped} skipped\r`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    if (!dryRun) await flushBatch(batch, dataset.source, nutrientMap);
    inserted += batch.length;
  }
  console.log(`\n  ${dataset.slug}: done — ${inserted} inserted, ${skipped} skipped`);
  checkpoint.completed[dataset.slug] = true;
  saveCheckpoint(checkpoint);
}

// ───── Batch flusher (upserts foods then food_nutrients) ───────────────────

async function flushBatch(foods, source, nutrientMap) {
  const foodRows = foods.map(f => mapFoodToRow(f, source));
  const { data: insertedFoods, error: foodErr } = await supabase
    .from("foods")
    .upsert(foodRows, { onConflict: "fdc_id" })
    .select("id, fdc_id");
  if (foodErr) throw foodErr;

  const fdcIdToUuid = new Map(insertedFoods.map(r => [r.fdc_id, r.id]));
  const nutrientRows = [];
  for (const food of foods) {
    const uuid = fdcIdToUuid.get(food.fdcId);
    if (!uuid) continue;
    nutrientRows.push(...mapNutrientsToRows(food, uuid, nutrientMap));
  }
  if (nutrientRows.length === 0) return;
  const { error: nutrientErr } = await supabase
    .from("food_nutrients")
    .upsert(nutrientRows, { onConflict: "food_id,nutrient_id" });
  if (nutrientErr) throw nutrientErr;
}

// ───── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  console.log(`[import-usda-foods] datasets=${args.datasets.join(",")} resume=${args.resume} dryRun=${args.dryRun}`);
  checkDiskSpace();
  await loadNutrientMap();
  const checkpoint = args.resume ? loadCheckpoint() : { completed: {}, lastFdcId: {} };

  // Small datasets first, branded last (biggest + longest)
  const order = ["foundation", "sr_legacy", "fndds", "branded"];
  for (const slug of order) {
    if (!args.datasets.includes(slug)) continue;
    if (checkpoint.completed[slug]) {
      console.log(`[${slug}] already completed (from checkpoint), skipping`);
      continue;
    }
    const dataset = DATASETS[slug];
    console.log(`\n[${slug}] starting...`);
    const started = Date.now();
    if (dataset.streaming) {
      await processDatasetStreaming(dataset, NUTRIENT_MAP, checkpoint, args.dryRun);
    } else {
      await processDatasetInMemory(dataset, NUTRIENT_MAP, checkpoint, args.dryRun);
    }
    console.log(`[${slug}] elapsed ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  console.log("\n[import-usda-foods] done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
