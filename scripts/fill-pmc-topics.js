import { spawn } from "node:child_process";

const DEFAULT_TARGET_PER_TOPIC = 2000;
const DEFAULT_TOPIC_ORDER = [
  // ── 1. Core resistance training ──────────────────────────────
  "creatine",
  "protein",
  "hypertrophy",
  "strength",
  "power",
  "progressive_overload",
  "volume",
  "frequency",
  "intensity",
  "periodization",
  "deload",
  "warm_up",
  "cool_down",
  "exercise_selection",
  "training_splits",
  "barbell_training",
  "dumbbell_training",
  "bodyweight_training",
  "fitness_programs",

  // ── 2. Exercise selection & execution ────────────────────────
  "hinge_exercises",
  "unilateral_leg_exercises",
  "glute_training",
  "machine_leg_training",
  "upper_push_exercises",
  "upper_pull_exercises",
  "arm_shoulder_isolation",

  // ── 3. Endurance & cardiovascular ────────────────────────────
  "endurance",
  "concurrent_training",
  "vo2_max",
  "zone_2",
  "hiit",
  "sprint_interval_training",
  "lactate_threshold",
  "running_economy",
  "resting_heart_rate",

  // ── 4. Body composition & general nutrition ──────────────────
  "fat_loss",
  "body_recomposition",
  "body_composition",
  "caloric_deficit",
  "caloric_surplus",
  "meal_timing",
  "carbohydrates",
  "fiber",
  "hydration",
  "electrolytes",
  "appetite",
  "blood_glucose",
  "insulin_sensitivity",

  // ── 5. Supplements — performance ─────────────────────────────
  "caffeine",
  "beta_alanine",
  "citrulline",
  "taurine",
  "betaine_tmg",
  "tyrosine",
  "alpha_gpc",
  "l_carnitine",
  "hmb",
  "beetroot_nitrate",
  "sodium_bicarbonate",
  "amino_acids",
  "whey_protein",
  "casein",
  "collagen",
  "collagen_peptides",
  "pre_workout",
  "pde5_pump",

  // ── 6. Supplements — hormones, adaptogens, micronutrients ────
  "testosterone",
  "ashwagandha",
  "tongkat_ali",
  "turkesterone",
  "rhodiola",
  "shilajit",
  "cordyceps",
  "omega_3",
  "vitamin_d",
  "magnesium",
  "glycine_sleep",
  "sun_exposure",
  "probiotics",
  "nac_tudca",
  "glutathione",
  "cerebrolysin",

  // ── 7. Supplements — peptides & research compounds ───────────
  "peptides",
  "bioactive_peptides",
  "bpc_157",
  "thymosin_beta_4",
  "growth_hormone_peptides",
  "glp_1_peptides",
  "ghrelin_peptides",
  "tesofensine",
  "metabolic_peptides",
  "nootropic_peptides",
  "longevity_peptides",
  "melanocortin_peptides",
  "copper_peptides",
  "nad_longevity",
  "sarms_and_research_compounds",
  "anabolic_agents",

  // ── 8. Recovery, sleep, stress ───────────────────────────────
  "sleep",
  "recovery",
  "hrv",
  "stress",
  "muscle_soreness",
  "injury_prevention",
  "inflammation",

  // ── 9. Metabolic & cardiovascular health ─────────────────────
  "blood_pressure",
  "cholesterol",
  "triglycerides",
  "metabolic_syndrome",
  "mitochondrial_function",
  "bone_density",
  "joint_health",
  "tendon_health",
  "mobility",
  "gut_health",

  // ── 10. Mind, habit, behavior ────────────────────────────────
  "motivation",
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
  taurine:
    "taurine AND (exercise performance OR fatigue OR endurance OR resistance training)",
  betaine_tmg:
    "(betaine OR trimethylglycine OR TMG) AND (exercise performance OR power OR strength OR body composition)",
  tyrosine:
    "(\"L-tyrosine\" OR tyrosine OR \"N-acetyl L-tyrosine\") AND (exercise performance OR cognition OR focus OR stress)",
  alpha_gpc:
    "(\"alpha-GPC\" OR \"alpha glycerylphosphorylcholine\" OR choline) AND (exercise performance OR power OR cognition)",
  l_carnitine:
    "(\"L-carnitine\" OR carnitine) AND (exercise performance OR recovery OR fat oxidation OR body composition)",
  hmb:
    "(HMB OR \"beta-hydroxy-beta-methylbutyrate\") AND (muscle OR hypertrophy OR resistance training OR recovery)",
  omega_3:
    "(omega-3 OR fish oil OR EPA OR DHA) AND (recovery OR inflammation OR muscle OR exercise)",
  vitamin_d:
    "\"vitamin D\" AND (muscle OR athletic performance OR recovery OR testosterone)",
  magnesium:
    "magnesium AND (sleep OR recovery OR exercise performance OR muscle)",
  glycine_sleep:
    "(glycine OR \"magnesium glycinate\" OR \"magnesium bisglycinate\" OR \"magnesium threonate\" OR \"magnesium taurate\" OR \"L-theanine\" OR GABA) AND (sleep OR insomnia OR recovery OR exercise)",
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
  pde5_pump:
    "(tadalafil OR Cialis OR sildenafil) AND (exercise performance OR blood flow OR muscle OR athletes)",
  nac_tudca:
    "(\"N-acetylcysteine\" OR NAC OR TUDCA OR \"tauroursodeoxycholic acid\" OR \"milk thistle\" OR silymarin) AND (exercise OR oxidative stress OR liver OR recovery)",
  glutathione:
    "(glutathione OR \"reduced glutathione\") AND (exercise OR oxidative stress OR recovery OR inflammation)",
  cerebrolysin:
    "cerebrolysin AND (cognition OR recovery OR traumatic brain injury OR neuroprotection)",
  shilajit:
    "(shilajit OR fulvic acid) AND (testosterone OR exercise OR fatigue OR muscle)",
  rhodiola:
    "(rhodiola OR \"Rhodiola rosea\") AND (exercise OR fatigue OR endurance OR stress)",
  cordyceps:
    "(cordyceps OR \"Cordyceps militaris\" OR \"Cordyceps sinensis\") AND (exercise OR endurance OR fatigue)",
  probiotics:
    "probiotics AND (gut health OR athletes OR immune function OR exercise)",
  peptides:
    "(peptide OR peptides) AND (muscle OR exercise performance OR recovery OR metabolism OR body composition)",
  collagen_peptides:
    "(collagen peptides OR hydrolyzed collagen OR gelatin) AND (tendon OR joint OR muscle OR exercise OR recovery)",
  bioactive_peptides:
    "\"bioactive peptides\" AND (exercise OR muscle OR metabolism OR inflammation OR recovery)",
  bpc_157:
    "(BPC-157 OR \"body protection compound 157\" OR \"Wolverine stack\") AND (tendon OR muscle OR healing OR injury OR inflammation)",
  thymosin_beta_4:
    "(\"thymosin beta 4\" OR thymosin beta-4 OR TB-500 OR TB500 OR TB4) AND (muscle OR tendon OR wound healing OR injury OR recovery)",
  growth_hormone_peptides:
    "(growth hormone releasing peptide OR GHRP OR GHRH OR CJC-1295 OR ipamorelin OR tesamorelin OR sermorelin OR \"human growth hormone\" OR HGH OR IGF-1) AND (body composition OR muscle OR exercise OR metabolism)",
  glp_1_peptides:
    "(GLP-1 OR glucagon-like peptide-1 OR semaglutide OR liraglutide OR tirzepatide OR retatrutide OR dulaglutide OR exenatide) AND (weight loss OR body composition OR exercise OR muscle OR lean mass)",
  ghrelin_peptides:
    "(ghrelin OR ghrelin receptor agonist OR growth hormone secretagogue) AND (appetite OR muscle OR metabolism OR exercise)",
  tesofensine:
    "tesofensine AND (weight loss OR appetite OR obesity OR body composition)",
  metabolic_peptides:
    "(\"MOTS-C\" OR \"MOTS-c\" OR \"SS-31\" OR elamipretide OR \"5-amino-1MQ\" OR \"5-amino-1-methylquinolinium\" OR \"SLU-PP-332\" OR \"SLU-PP-32\" OR AOD-9604 OR \"fragment 176-191\") AND (metabolism OR exercise OR mitochondrial OR body composition OR weight loss)",
  nootropic_peptides:
    "(Semax OR Selank OR DSIP OR Dihexa) AND (sleep OR stress OR cognition OR exercise OR neuroprotection)",
  longevity_peptides:
    "(epitalon OR epithalon OR \"thymosin alpha 1\" OR LL-37 OR kisspeptin OR sirolimus OR rapamycin) AND (aging OR immune OR metabolism OR exercise OR recovery)",
  melanocortin_peptides:
    "(\"Melanotan II\" OR melanotan OR \"PT-141\" OR bremelanotide) AND (metabolism OR appetite OR sexual function OR body composition)",
  copper_peptides:
    "(\"GHK-Cu\" OR \"glycyl-L-histidyl-L-lysine\" OR KPV OR \"Glow stack\") AND (wound healing OR inflammation OR recovery OR skin)",
  nad_longevity:
    "(NAD OR \"nicotinamide riboside\" OR \"nicotinamide mononucleotide\" OR NMN OR NR) AND (exercise OR mitochondrial OR metabolism OR aging)",
  sarms_and_research_compounds:
    "(SARM OR SARMs OR ostarine OR enobosarm OR \"MK-2866\" OR ligandrol OR \"LGD-4033\" OR testolone OR \"RAD-140\" OR ibutamoren OR \"MK-677\" OR cardarine OR GW501516) AND (muscle OR body composition OR exercise OR performance OR metabolism)",
  anabolic_agents:
    "(oxandrolone OR Anavar OR clenbuterol OR \"testosterone enanthate\" OR \"testosterone cypionate\" OR HCG OR enclomiphene) AND (muscle OR body composition OR exercise OR performance OR weight loss)",
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
  hinge_exercises:
    "(\"Romanian deadlift\" OR \"Romanian deadlifts\" OR \"stiff-leg deadlift\" OR \"stiff-legged deadlift\" OR \"hip hinge\" OR deadlift) AND (resistance training OR strength OR hypertrophy OR biomechanics)",
  unilateral_leg_exercises:
    "(\"Bulgarian split squat\" OR \"split squat\" OR lunge OR lunges OR \"single-leg squat\") AND (resistance training OR strength OR hypertrophy OR biomechanics)",
  glute_training:
    "(\"hip thrust\" OR \"barbell hip thrust\" OR \"glute bridge\" OR gluteal OR gluteus) AND (hypertrophy OR strength OR resistance training OR biomechanics)",
  machine_leg_training:
    "(\"leg press\" OR \"leg extension\" OR \"knee extension\" OR \"leg curl\" OR \"hamstring curl\" OR \"calf raise\" OR \"plantar flexion\") AND (resistance training OR hypertrophy OR strength)",
  upper_push_exercises:
    "(\"bench press\" OR \"incline bench press\" OR \"chest press\" OR \"push-up\" OR pushup OR dips OR \"overhead press\" OR \"shoulder press\") AND (resistance training OR strength OR hypertrophy OR biomechanics)",
  upper_pull_exercises:
    "(\"lat pulldown\" OR \"pull-up\" OR pullup OR \"chin-up\" OR \"seated row\" OR \"cable row\" OR \"barbell row\") AND (resistance training OR strength OR hypertrophy OR biomechanics)",
  arm_shoulder_isolation:
    "(\"lateral raise\" OR \"rear delt\" OR \"face pull\" OR \"triceps pushdown\" OR \"triceps extension\" OR \"preacher curl\" OR \"hammer curl\" OR \"biceps curl\") AND (resistance training OR hypertrophy OR strength)",
  bodyweight_training:
    "(\"bodyweight training\" OR calisthenics OR \"push-up\" OR \"pull-up\" OR \"dip exercise\") AND (strength OR hypertrophy OR resistance training OR physical fitness)",
  dumbbell_training:
    "(dumbbell OR dumbbells OR \"free weights\") AND (resistance training OR strength OR hypertrophy OR home exercise)",
  training_splits:
    "(\"push pull legs\" OR PPL OR \"upper lower split\" OR \"full body routine\" OR \"split routine\" OR \"training split\") AND (resistance training OR hypertrophy OR strength)",
  progressive_overload:
    "(\"progressive overload\" OR \"progressive resistance training\" OR \"repetitions in reserve\" OR RIR OR \"training to failure\" OR \"reps to failure\") AND (hypertrophy OR strength OR resistance training)",
  barbell_training:
    "(barbell OR \"bench press\" OR squat OR deadlift OR \"overhead press\" OR \"bent-over row\" OR \"Pendlay row\" OR \"military press\") AND (resistance training OR strength OR hypertrophy OR biomechanics)",
  fitness_programs:
    "(\"5/3/1\" OR Wendler OR GZCLP OR nSuns OR PHUL OR PHAT OR \"linear progression\" OR \"power hypertrophy\" OR \"beginner resistance training program\" OR \"periodized resistance training\") AND (resistance training OR strength OR hypertrophy)",
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
    const output = `data/pubmed-${topic}-corpus.jsonl`;
    const rawDir = `data/pubmed-raw-${topic}`;
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
