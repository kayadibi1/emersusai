import { spawn } from "node:child_process";

const DEFAULT_TARGET_PER_TOPIC = 2000;
const DEFAULT_TOPIC_ORDER = [
  "creatine",
  "protein",
  "hypertrophy",
  "strength",
  "power",
  "fat_loss",
  "body_recomposition",
  "endurance",
  "concurrent_training",
  "sleep",
  "recovery",
  "caffeine",
  "hydration",
  "electrolytes",
  "meal_timing",
  "carbohydrates",
  "fiber",
  "caloric_deficit",
  "caloric_surplus",
  "body_composition",
  "resting_heart_rate",
  "vo2_max",
  "zone_2",
  "hiit",
  "sprint_interval_training",
  "lactate_threshold",
  "running_economy",
  "ashwagandha",
  "tongkat_ali",
  "testosterone",
  "sun_exposure",
  "amino_acids",
  "beta_alanine",
  "citrulline",
  "omega_3",
  "vitamin_d",
  "magnesium",
  "beetroot_nitrate",
  "sodium_bicarbonate",
  "collagen",
  "whey_protein",
  "casein",
  "pre_workout",
  "probiotics",
  "hrv",
  "stress",
  "injury_prevention",
  "muscle_soreness",
  "motivation",
  "turkesterone",
  "insulin_sensitivity",
  "blood_glucose",
  "appetite",
  "gut_health",
  "inflammation",
  "blood_pressure",
  "cholesterol",
  "triglycerides",
  "metabolic_syndrome",
  "mitochondrial_function",
  "bone_density",
  "joint_health",
  "tendon_health",
  "mobility",
  "warm_up",
  "cool_down",
  "deload",
  "periodization",
  "volume",
  "frequency",
  "intensity",
  "exercise_selection",
  "adherence",
  "habit_formation",
  "mental_fatigue",
  "focus",
  "circadian_rhythm",
];

const TOPIC_QUERIES = {
  creatine: "creatine AND resistance training",
  protein: "protein intake AND hypertrophy",
  hypertrophy: "hypertrophy AND resistance training",
  strength: "strength training OR maximal strength OR resistance training adaptation",
  power: "power training OR explosive performance OR rate of force development",
  fat_loss: "fat loss AND body composition AND resistance training",
  body_recomposition:
    "\"body recomposition\" OR ((fat loss OR fat mass) AND (lean mass OR muscle mass) AND resistance training)",
  endurance: "zone 2 OR vo2 max OR endurance training",
  concurrent_training:
    "\"concurrent training\" OR ((endurance training) AND (resistance training) AND interference)",
  sleep: "sleep AND athletic recovery",
  recovery:
    "athletic recovery OR exercise recovery OR post-exercise recovery OR training recovery",
  caffeine: "caffeine AND exercise performance",
  hydration:
    "hydration AND (exercise performance OR athletes OR training)",
  electrolytes:
    "(electrolytes OR sodium OR potassium) AND (exercise performance OR hydration OR athletes)",
  meal_timing:
    "\"meal timing\" OR nutrient timing OR pre-workout nutrition OR post-workout nutrition",
  carbohydrates:
    "(carbohydrate intake OR glycogen OR carbohydrates) AND (exercise performance OR endurance OR resistance training)",
  fiber:
    "fiber AND (satiety OR gut health OR glycemic control OR body composition)",
  caloric_deficit:
    "\"caloric deficit\" OR energy deficit AND (fat loss OR body composition OR resistance training)",
  caloric_surplus:
    "\"caloric surplus\" OR energy surplus AND (muscle gain OR hypertrophy OR resistance training)",
  body_composition:
    "\"body composition\" AND (exercise OR resistance training OR nutrition OR athletes)",
  resting_heart_rate:
    "\"resting heart rate\" AND (exercise OR training OR fitness OR athlete)",
  vo2_max:
    "\"VO2 max\" OR \"maximal oxygen uptake\" OR cardiorespiratory fitness",
  zone_2:
    "\"zone 2\" OR (low-intensity steady-state AND endurance training) OR aerobic base training",
  hiit:
    "\"high-intensity interval training\" OR HIIT AND (fitness OR endurance OR body composition)",
  sprint_interval_training:
    "\"sprint interval training\" OR SIT AND (performance OR endurance OR metabolic health)",
  lactate_threshold:
    "\"lactate threshold\" AND (endurance OR running OR cycling OR training)",
  running_economy:
    "\"running economy\" AND (training OR endurance OR performance)",
  ashwagandha:
    "(ashwagandha OR withania somnifera) AND (exercise OR stress OR recovery OR testosterone)",
  tongkat_ali:
    "(\"tongkat ali\" OR eurycoma longifolia OR eurycoma longifolia jack) AND (testosterone OR libido OR stress OR exercise)",
  eurycoma_longifolia:
    "(\"tongkat ali\" OR eurycoma longifolia OR eurycoma longifolia jack) AND (testosterone OR libido OR stress OR exercise)",
  eurycome_longfolia:
    "(\"tongkat ali\" OR eurycoma longifolia OR eurycoma longifolia jack OR eurycome longfolia) AND (testosterone OR libido OR stress OR exercise)",
  turkesterone:
    "(turkesterone OR ecdysteroid OR ecdysterone) AND (muscle OR hypertrophy OR resistance training OR exercise)",
  testosterone:
    "testosterone AND (resistance training OR exercise performance OR muscle OR recovery)",
  sun_exposure:
    "(\"sun exposure\" OR sunlight OR ultraviolet OR UVB) AND (vitamin D OR circadian OR sleep OR athletic performance)",
  amino_acids:
    "(amino acids OR essential amino acids OR branched-chain amino acids OR BCAA OR leucine) AND (muscle protein synthesis OR hypertrophy OR exercise)",
  beta_alanine:
    "(beta-alanine OR carnosine) AND (exercise performance OR fatigue OR resistance training)",
  citrulline:
    "(citrulline OR citrulline malate) AND (exercise performance OR blood flow OR resistance training)",
  omega_3:
    "(omega-3 OR fish oil OR EPA OR DHA) AND (recovery OR inflammation OR muscle OR exercise)",
  vitamin_d:
    "\"vitamin D\" AND (muscle OR athletic performance OR recovery OR testosterone)",
  magnesium:
    "magnesium AND (sleep OR recovery OR exercise performance OR muscle)",
  beetroot_nitrate:
    "(beetroot OR nitrate supplementation OR dietary nitrate) AND (exercise performance OR endurance OR blood flow)",
  sodium_bicarbonate:
    "(sodium bicarbonate OR bicarbonate loading) AND (exercise performance OR buffering OR high-intensity exercise)",
  collagen:
    "collagen AND (joint health OR tendon OR recovery OR exercise)",
  whey_protein:
    "\"whey protein\" AND (muscle protein synthesis OR hypertrophy OR recovery)",
  casein:
    "casein AND (muscle protein synthesis OR overnight recovery OR hypertrophy)",
  pre_workout:
    "\"pre-workout\" OR preworkout AND (exercise performance OR resistance training)",
  probiotics:
    "probiotics AND (gut health OR athletes OR immune function OR exercise)",
  hrv:
    "\"heart rate variability\" OR HRV AND (recovery OR training load OR athletes)",
  stress:
    "stress AND (athletes OR exercise performance OR recovery OR cortisol)",
  injury_prevention:
    "\"injury prevention\" AND (athletes OR exercise OR resistance training OR sport)",
  muscle_soreness:
    "\"muscle soreness\" OR DOMS AND (recovery OR exercise OR resistance training)",
  motivation:
    "motivation AND (exercise adherence OR training adherence OR physical activity)",
  insulin_sensitivity:
    "\"insulin sensitivity\" AND (exercise OR resistance training OR endurance training OR nutrition)",
  blood_glucose:
    "(\"blood glucose\" OR glycemic control) AND (exercise OR nutrition OR athletes OR training)",
  appetite:
    "appetite AND (exercise OR protein intake OR weight loss OR satiety)",
  gut_health:
    "(gut health OR gut microbiome OR microbiota) AND (exercise OR nutrition OR athletes)",
  inflammation:
    "inflammation AND (exercise recovery OR muscle damage OR athletic performance OR training)",
  blood_pressure:
    "\"blood pressure\" AND (exercise OR aerobic training OR resistance training OR nutrition)",
  cholesterol:
    "cholesterol AND (exercise OR diet OR cardiovascular health OR training)",
  triglycerides:
    "triglycerides AND (exercise OR diet OR metabolic health)",
  metabolic_syndrome:
    "\"metabolic syndrome\" AND (exercise OR diet OR physical activity)",
  mitochondrial_function:
    "\"mitochondrial function\" OR mitochondrial biogenesis AND (exercise OR endurance training OR metabolism)",
  bone_density:
    "\"bone density\" OR BMD AND (resistance training OR exercise OR vitamin D)",
  joint_health:
    "\"joint health\" AND (exercise OR supplementation OR recovery)",
  tendon_health:
    "\"tendon health\" OR tendinopathy AND (loading OR collagen OR exercise)",
  mobility:
    "mobility AND (range of motion OR flexibility OR resistance training OR performance)",
  warm_up:
    "\"warm up\" OR warm-up AND (performance OR injury prevention OR exercise)",
  cool_down:
    "\"cool down\" OR cooldown AND (recovery OR exercise)",
  deload:
    "deload AND (resistance training OR periodization OR recovery)",
  periodization:
    "periodization AND (resistance training OR endurance training OR performance)",
  volume:
    "\"training volume\" AND (hypertrophy OR strength OR endurance)",
  frequency:
    "\"training frequency\" AND (hypertrophy OR strength OR resistance training)",
  intensity:
    "\"training intensity\" AND (hypertrophy OR strength OR endurance)",
  exercise_selection:
    "\"exercise selection\" AND (hypertrophy OR strength OR resistance training)",
  adherence:
    "adherence AND (exercise program OR nutrition intervention OR athletes)",
  habit_formation:
    "\"habit formation\" AND (exercise adherence OR physical activity OR nutrition behavior)",
  mental_fatigue:
    "\"mental fatigue\" AND (exercise performance OR endurance OR cognitive performance)",
  focus:
    "focus AND (exercise performance OR cognition OR caffeine OR athletes)",
  circadian_rhythm:
    "\"circadian rhythm\" AND (sleep OR exercise timing OR athletic performance OR sunlight)",
};

function parseArgs(argv) {
  const args = {
    targetPerTopic: DEFAULT_TARGET_PER_TOPIC,
    topics: [...DEFAULT_TOPIC_ORDER],
    requestsPerSecond: undefined,
    searchBatch: undefined,
    skipEmbed: false,
    dryRun: false,
  };

  for (const rawArg of argv) {
    if (rawArg === "--skip-embed") {
      args.skipEmbed = true;
      continue;
    }

    if (rawArg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    const [key, ...rest] = rawArg.split("=");
    const value = rest.join("=");

    if (key === "--target-per-topic") {
      args.targetPerTopic = Number(value || DEFAULT_TARGET_PER_TOPIC);
    } else if (key === "--topics") {
      args.topics = String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    } else if (key === "--requests-per-second") {
      args.requestsPerSecond = Number(value || 0);
    } else if (key === "--search-batch") {
      args.searchBatch = Number(value || 0);
    }
  }

  args.targetPerTopic = Math.max(1, Math.floor(args.targetPerTopic || DEFAULT_TARGET_PER_TOPIC));
  args.topics = args.topics.filter((topic) => TOPIC_QUERIES[topic]);

  return args;
}

function printUsage() {
  console.log("Usage:");
  console.log(
    '  node scripts/fill-pmc-topics.js [--target-per-topic=2000] [--topics=creatine,protein,hypertrophy] [--requests-per-second=8] [--search-batch=200] [--skip-embed] [--dry-run]'
  );
  console.log("");
  console.log("Available topics:");
  Object.keys(TOPIC_QUERIES).forEach((topic) => {
    console.log(`  - ${topic}: ${TOPIC_QUERIES[topic]}`);
  });
}

async function runNodeScript(scriptPath, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptPath} exited with code ${code}.`));
    });

    child.on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.topics.length) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  console.log(`Starting multi-topic PubMed corpus fill for ${args.topics.length} topics...`);
  console.log(`Target per topic: ${args.targetPerTopic} new unique articles`);
  console.log(`Topic order: ${args.topics.join(", ")}`);

  for (let index = 0; index < args.topics.length; index += 1) {
    const topic = args.topics[index];
    const query = TOPIC_QUERIES[topic];
    const output = `data\\pubmed-${topic}-corpus.jsonl`;
    const rawDir = `data\\pubmed-raw-${topic}`;
    const topicArgs = [
      `--query=${query}`,
      `--target=${args.targetPerTopic}`,
      `--output=${output}`,
      `--raw-dir=${rawDir}`,
    ];

    if (args.requestsPerSecond) {
      topicArgs.push(`--requests-per-second=${args.requestsPerSecond}`);
    }

    if (args.searchBatch) {
      topicArgs.push(`--search-batch=${args.searchBatch}`);
    }

    if (args.skipEmbed) {
      topicArgs.push("--skip-embed");
    }

    if (args.dryRun) {
      topicArgs.push("--dry-run");
    }

    console.log("");
    console.log(
      `=== Topic ${index + 1}/${args.topics.length}: ${topic} ===`
    );
    console.log(`Query: ${query}`);

    await runNodeScript("scripts/fill-pmc-corpus.js", topicArgs);
  }

  if (args.skipEmbed) {
    console.log("");
    console.log("Topic fill complete. Embeddings were skipped by request.");
    return;
  }

  console.log("");
  console.log("All topic fills complete.");
}

main().catch((error) => {
  console.error("TOPIC FILL ERROR:");
  console.error(error);
  process.exit(1);
});
