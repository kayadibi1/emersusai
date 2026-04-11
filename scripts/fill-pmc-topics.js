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

  // ══ NEW DOMAINS ══

  // ── 11. Women's health / female physiology ───────────────────
  "menstrual_cycle_training",
  "perimenopause_training",
  "postmenopause_training",
  "pregnancy_exercise",
  "postpartum_return_to_training",
  "pcos_and_exercise",
  "low_energy_availability",
  "hormonal_contraception_training",
  "female_strength_norms",
  "female_athlete_triad",
  "menarche_training",
  "pelvic_floor_training",
  "diastasis_recti",
  "female_hypertrophy_protocols",
  "female_sex_hormones_performance",
  "breast_support_exercise",

  // ── 12. Youth / long-term athletic development ───────────────
  "youth_resistance_training",
  "peak_height_velocity",
  "long_term_athletic_development",
  "youth_endurance_training",
  "growth_plate_safety",
  "early_specialization",
  "physical_literacy",
  "youth_power_training",
  "motor_skill_acquisition",
  "youth_hypertrophy",
  "pediatric_athlete_nutrition",
  "adolescent_sleep_athlete",
  "youth_plyometrics",
  "youth_sprint_training",
  "biological_maturation",
  "prepubescent_strength",

  // ── 13. Masters / 40+ athletes ───────────────────────────────
  "sarcopenia",
  "strength_training_older_adults",
  "vo2_max_preservation",
  "bone_density_exercise",
  "balance_fall_prevention",
  "masters_endurance_training",
  "recovery_older_athletes",
  "anabolic_resistance_aging",
  "age_adjusted_programming",
  "masters_powerlifting",
  "testosterone_replacement_training",
  "growth_hormone_aging",
  "frailty_prevention",
  "power_training_aging",
  "reaction_time_aging",
  "masters_hypertrophy",

  // ── 14. Injury rehab / return to play ────────────────────────
  "acl_rehab",
  "rotator_cuff_rehab",
  "low_back_rehab",
  "achilles_tendinopathy",
  "patellar_tendinopathy",
  "tennis_elbow_rehab",
  "hamstring_strain_rehab",
  "concussion_return_to_play",
  "tendinopathy_loading",
  "pain_science_exercise",
  "meniscus_rehab",
  "shoulder_impingement_rehab",
  "ankle_sprain_rtp",
  "plantar_fasciitis_loading",
  "hip_labrum_rehab",
  "mcl_lcl_rehab",
  "groin_strain_rehab",
  "adductor_rehab",
  "piriformis_syndrome",
  "si_joint_dysfunction",

  // ── 15. Endurance specialization ─────────────────────────────
  "marathon_training",
  "triathlon_training",
  "cycling_training",
  "altitude_training",
  "polarized_training",
  "pyramidal_training",
  "race_tapering",
  "heat_acclimation",
  "cold_water_immersion_endurance",
  "ftp_testing",
  "critical_power",
  "training_zones_endurance",
  "lactate_testing",
  "fat_oxidation_max",
  "running_form_drills",
  "glycogen_supercompensation",
  "race_pacing_strategy",
  "endurance_periodization",

  // ── 16. Advanced programming methodologies ───────────────────
  "block_periodization",
  "conjugate_method",
  "bulgarian_method",
  "autoregulation_rpe_rir",
  "daily_undulating_periodization",
  "peaking_for_competition",
  "accumulation_intensification",
  "mesocycle_design",
  "microcycle_design",
  "velocity_based_training",
  "cluster_sets",
  "drop_sets_hypertrophy",
  "rest_pause_training",
  "mechanical_tension_vs_metabolic_stress",
  "prilepin_chart_strength",
  "training_to_failure",
];

const TOPIC_QUERIES = {
  creatine:
    "(creatine OR \"creatine monohydrate\" OR phosphocreatine) AND (\"resistance training\" OR strength OR hypertrophy OR \"exercise performance\")",
  protein:
    "(\"protein intake\" OR \"dietary protein\" OR \"protein supplementation\" OR \"whey protein\") AND (hypertrophy OR \"muscle protein synthesis\" OR \"lean mass\" OR \"resistance training\")",
  hypertrophy:
    "(hypertrophy OR \"muscle growth\" OR \"muscle hypertrophy\" OR \"lean mass gain\") AND (\"resistance training\" OR \"strength training\" OR \"muscle protein synthesis\")",
  strength: "strength training OR maximal strength OR resistance training adaptation",
  power: "power training OR explosive performance OR rate of force development",
  fat_loss: "fat loss AND body composition AND resistance training",
  body_recomposition:
    "\"body recomposition\" OR ((fat loss OR fat mass) AND (lean mass OR muscle mass) AND resistance training)",
  endurance: "zone 2 OR vo2 max OR endurance training",
  concurrent_training:
    "\"concurrent training\" OR ((endurance training) AND (resistance training) AND interference)",
  sleep:
    "(sleep OR \"sleep duration\" OR \"sleep quality\" OR \"sleep deprivation\" OR \"sleep extension\") AND (\"athletic recovery\" OR \"exercise performance\" OR \"muscle protein synthesis\" OR \"muscle recovery\")",
  recovery:
    "(\"athletic recovery\" OR \"exercise recovery\" OR \"post-exercise recovery\" OR \"muscle recovery\" OR \"training recovery\") AND (sleep OR nutrition OR \"cold water immersion\" OR \"active recovery\")",
  caffeine:
    "(caffeine OR \"caffeine ingestion\" OR \"caffeine supplementation\") AND (\"exercise performance\" OR endurance OR \"time trial\" OR \"resistance training\" OR fatigue)",
  hydration:
    "(hydration OR \"fluid balance\" OR \"water intake\" OR dehydration) AND (\"exercise performance\" OR athletes OR \"thermal regulation\" OR \"endurance performance\")",
  electrolytes:
    "(electrolytes OR sodium OR potassium OR \"sodium chloride\" OR \"electrolyte replacement\") AND (\"exercise performance\" OR hydration OR athletes OR \"muscle cramps\")",
  meal_timing:
    "(\"meal timing\" OR \"nutrient timing\" OR \"protein timing\" OR \"pre-workout nutrition\" OR \"post-workout nutrition\") AND (hypertrophy OR \"muscle protein synthesis\" OR \"exercise performance\")",
  carbohydrates:
    "(carbohydrate OR glycogen OR \"carbohydrate loading\" OR \"glycogen resynthesis\" OR \"carbohydrate ingestion\") AND (\"exercise performance\" OR endurance OR \"resistance training\" OR \"glucose metabolism\")",
  fiber:
    "(fiber OR \"dietary fiber\" OR \"soluble fiber\" OR \"fermentable fiber\") AND (satiety OR \"gut health\" OR \"glycemic control\" OR \"body composition\" OR microbiome)",
  caloric_deficit:
    "(\"caloric deficit\" OR \"energy deficit\" OR \"hypocaloric diet\") AND (\"fat loss\" OR \"lean mass\" OR \"body composition\" OR \"resistance training\")",
  caloric_surplus:
    "(\"caloric surplus\" OR \"energy surplus\" OR \"hypercaloric diet\") AND (\"muscle gain\" OR hypertrophy OR \"resistance training\" OR \"lean mass\")",
  body_composition:
    "(\"body composition\" OR \"body fat percentage\" OR \"lean body mass\" OR \"fat free mass\") AND (exercise OR \"resistance training\" OR nutrition OR athletes)",
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
    "(\"heart rate variability\" OR HRV OR \"vagal tone\") AND (training OR overtraining OR recovery OR \"exercise performance\" OR athletes)",
  stress:
    "(\"psychological stress\" OR \"cortisol response\" OR \"perceived stress\" OR \"allostatic load\") AND (exercise OR \"resistance training\" OR recovery OR athletes)",
  injury_prevention:
    "(\"injury prevention\" OR \"injury reduction\" OR \"injury risk\") AND (exercise OR training OR athletes OR \"warm up\" OR \"strength training\")",
  muscle_soreness:
    "(\"delayed onset muscle soreness\" OR DOMS OR \"muscle soreness\" OR \"muscle damage\") AND (\"eccentric exercise\" OR recovery OR \"resistance training\")",
  motivation:
    "(motivation OR \"exercise motivation\" OR \"self-determination theory\" OR \"autonomous motivation\") AND (\"exercise adherence\" OR \"physical activity\" OR training)",
  insulin_sensitivity:
    "(\"insulin sensitivity\" OR \"insulin resistance\" OR \"glucose tolerance\") AND (\"resistance training\" OR exercise OR \"aerobic training\" OR \"HIIT\")",
  blood_glucose:
    "(\"blood glucose\" OR glycemia OR \"postprandial glucose\" OR \"glycemic response\") AND (exercise OR \"resistance training\" OR endurance OR \"insulin sensitivity\")",
  appetite:
    "(appetite OR \"appetite regulation\" OR satiety OR \"hunger hormones\" OR ghrelin OR leptin) AND (exercise OR \"resistance training\" OR \"energy intake\" OR \"body composition\")",
  gut_health:
    "(\"gut health\" OR microbiome OR \"gut microbiota\" OR \"intestinal permeability\") AND (exercise OR athletes OR nutrition OR \"endurance training\")",
  inflammation:
    "(inflammation OR \"inflammatory response\" OR \"exercise induced inflammation\" OR cytokines) AND (exercise OR recovery OR \"resistance training\" OR \"endurance training\")",
  blood_pressure:
    "\"blood pressure\" AND (exercise OR aerobic training OR resistance training OR nutrition)",
  cholesterol:
    "cholesterol AND (exercise OR diet OR cardiovascular health OR training)",
  triglycerides:
    "triglycerides AND (exercise OR diet OR metabolic health)",
  metabolic_syndrome:
    "\"metabolic syndrome\" AND (exercise OR diet OR physical activity)",
  mitochondrial_function:
    "(\"mitochondrial function\" OR \"mitochondrial biogenesis\" OR \"mitochondrial density\") AND (exercise OR \"endurance training\" OR \"resistance training\" OR aging)",
  bone_density:
    "(\"bone density\" OR \"bone mineral density\" OR BMD OR osteoporosis OR osteopenia) AND (exercise OR \"resistance training\" OR \"impact loading\" OR \"weight bearing\")",
  joint_health:
    "(\"joint health\" OR \"joint function\" OR \"cartilage health\" OR osteoarthritis) AND (exercise OR \"resistance training\" OR \"joint loading\" OR supplementation)",
  tendon_health:
    "(\"tendon health\" OR \"tendon stiffness\" OR \"tendon adaptation\" OR \"tendon loading\" OR tendinopathy) AND (exercise OR \"resistance training\" OR \"eccentric loading\" OR collagen)",
  mobility:
    "(mobility OR \"range of motion\" OR flexibility OR \"dynamic flexibility\") AND (exercise OR \"resistance training\" OR \"athletic performance\" OR aging)",
  warm_up:
    "(\"warm up\" OR \"warm-up\" OR \"dynamic warm-up\" OR \"movement preparation\") AND (\"exercise performance\" OR \"injury prevention\" OR \"power output\")",
  cool_down:
    "(\"cool down\" OR cooldown OR \"active recovery\") AND (\"exercise recovery\" OR \"lactate clearance\" OR \"muscle soreness\")",
  deload:
    "(deload OR \"deload week\" OR \"training tapering\" OR \"recovery week\") AND (\"resistance training\" OR periodization OR recovery OR overtraining)",
  periodization:
    "(periodization OR \"periodized training\" OR \"training periodization\") AND (\"resistance training\" OR \"endurance training\" OR \"strength training\" OR performance)",
  volume:
    "(\"training volume\" OR \"weekly volume\" OR \"total tonnage\" OR \"sets per muscle\" OR \"hard sets\") AND (hypertrophy OR strength OR \"resistance training\" OR \"dose response\")",
  frequency:
    "(\"training frequency\" OR \"weekly frequency\" OR \"session frequency\") AND (hypertrophy OR strength OR \"resistance training\" OR adaptation)",
  intensity:
    "(\"training intensity\" OR \"relative intensity\" OR \"percent of 1RM\" OR \"one repetition maximum\") AND (hypertrophy OR strength OR endurance)",
  exercise_selection:
    "(\"exercise selection\" OR \"exercise variation\" OR \"exercise rotation\" OR \"compound exercises\") AND (hypertrophy OR strength OR \"resistance training\" OR \"muscle activation\")",
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
    "(\"exercise adherence\" OR \"training adherence\" OR \"physical activity maintenance\") AND (intervention OR behavior OR habit OR motivation)",
  habit_formation:
    "(\"habit formation\" OR \"behavior change\" OR \"habit automaticity\") AND (exercise OR \"physical activity\" OR diet OR \"health behavior\")",
  mental_fatigue:
    "(\"mental fatigue\" OR \"cognitive fatigue\" OR \"central fatigue\") AND (\"exercise performance\" OR endurance OR \"resistance training\" OR \"perceived exertion\")",
  focus:
    "(focus OR attention OR concentration OR \"cognitive performance\") AND (exercise OR caffeine OR \"pre-workout\" OR \"athletic performance\")",
  circadian_rhythm:
    "(\"circadian rhythm\" OR chronobiology OR \"time of day\" OR chronotype) AND (exercise OR \"resistance training\" OR performance OR sleep)",

  // ── 11. Women's health / female physiology ───────────────────
  menstrual_cycle_training:
    "(\"menstrual cycle\" OR luteal OR follicular OR \"menstrual phase\" OR \"ovarian hormones\") AND (\"resistance training\" OR strength OR endurance OR \"exercise performance\" OR \"athletic performance\")",
  perimenopause_training:
    "(perimenopause OR \"menopausal transition\" OR \"menopause transition\") AND (\"resistance training\" OR exercise OR \"bone density\" OR \"body composition\" OR \"physical activity\")",
  postmenopause_training:
    "(postmenopause OR \"post-menopausal\" OR \"postmenopausal women\") AND (\"resistance training\" OR exercise OR \"bone density\" OR sarcopenia OR \"body composition\")",
  pregnancy_exercise:
    "(pregnancy OR \"pregnant women\" OR gestation OR gestational) AND (exercise OR \"resistance training\" OR \"aerobic exercise\" OR \"physical activity\" OR safety)",
  postpartum_return_to_training:
    "(postpartum OR \"post-natal\" OR \"postnatal recovery\") AND (\"return to exercise\" OR \"return to sport\" OR \"resistance training\" OR \"pelvic floor\")",
  pcos_and_exercise:
    "(\"polycystic ovary syndrome\" OR PCOS) AND (exercise OR \"resistance training\" OR \"insulin sensitivity\" OR \"body composition\")",
  low_energy_availability:
    "(\"relative energy deficiency in sport\" OR \"RED-S\" OR \"REDs\" OR \"low energy availability\") AND (athlete OR training OR \"bone health\" OR \"menstrual dysfunction\")",
  hormonal_contraception_training:
    "(\"oral contraceptive\" OR \"hormonal contraception\" OR \"combined contraceptive pill\") AND (\"exercise performance\" OR \"resistance training\" OR \"muscle protein synthesis\" OR strength)",
  female_strength_norms:
    "(\"female athletes\" OR \"women's strength\" OR \"female strength\" OR \"sex differences strength\") AND (\"resistance training\" OR \"strength training\" OR hypertrophy OR \"muscle quality\")",
  female_athlete_triad:
    "(\"female athlete triad\" OR \"athlete triad\") AND (\"bone health\" OR \"menstrual dysfunction\" OR \"energy availability\" OR \"stress fracture\")",
  menarche_training:
    "(menarche OR \"menstrual onset\" OR \"premenarcheal\" OR \"peri-menarcheal\") AND (training OR \"physical activity\" OR \"youth athletes\" OR \"bone development\")",
  pelvic_floor_training:
    "(\"pelvic floor\" OR \"pelvic floor muscle training\" OR \"Kegel exercise\") AND (exercise OR \"return to sport\" OR postpartum OR incontinence)",
  diastasis_recti:
    "(\"diastasis recti\" OR \"diastasis rectus abdominis\" OR \"abdominal separation\") AND (exercise OR postpartum OR rehabilitation OR \"core training\")",
  female_hypertrophy_protocols:
    "(\"female hypertrophy\" OR \"women hypertrophy\" OR \"sex-specific training\") AND (\"resistance training\" OR \"muscle growth\" OR \"protein synthesis\")",
  female_sex_hormones_performance:
    "(estrogen OR estradiol OR progesterone OR \"sex hormones\") AND (\"exercise performance\" OR \"resistance training\" OR \"muscle protein synthesis\" OR endurance)",
  breast_support_exercise:
    "(\"sports bra\" OR \"breast support\" OR \"breast pain exercise\" OR \"breast biomechanics\") AND (exercise OR running OR \"physical activity\")",

  // ── 12. Youth / long-term athletic development ───────────────
  youth_resistance_training:
    "(\"youth resistance training\" OR \"pediatric strength training\" OR \"children resistance training\" OR \"adolescent strength training\") AND (safety OR strength OR adaptation OR development)",
  peak_height_velocity:
    "(\"peak height velocity\" OR PHV OR \"biological maturation\" OR \"growth spurt\") AND (\"athletic development\" OR \"injury risk\" OR \"training load\" OR youth)",
  long_term_athletic_development:
    "(\"long-term athletic development\" OR LTAD OR \"youth athletic development\") AND (periodization OR training OR sport OR \"talent development\")",
  youth_endurance_training:
    "(\"youth endurance\" OR \"pediatric endurance\" OR \"child endurance training\" OR \"adolescent aerobic training\") AND (\"VO2 max\" OR \"aerobic capacity\" OR adaptation)",
  growth_plate_safety:
    "(\"growth plate\" OR physis OR epiphysis OR \"epiphyseal plate\") AND (\"resistance training\" OR \"youth strength\" OR injury OR safety OR loading)",
  early_specialization:
    "(\"early sport specialization\" OR \"early specialization\" OR \"sport diversification\" OR \"sport sampling\") AND (youth OR adolescent OR \"injury risk\" OR burnout)",
  physical_literacy:
    "(\"physical literacy\" OR \"fundamental movement skills\" OR \"motor competence\") AND (youth OR children OR development OR \"physical activity\")",
  youth_power_training:
    "(\"youth power training\" OR \"adolescent power\" OR \"pediatric plyometrics\") AND (\"vertical jump\" OR \"power output\" OR \"athletic performance\" OR \"rate of force development\")",
  motor_skill_acquisition:
    "(\"motor skill acquisition\" OR \"motor learning\" OR \"skill acquisition\" OR \"movement learning\") AND (youth OR children OR athletes OR sport)",
  youth_hypertrophy:
    "(\"adolescent hypertrophy\" OR \"youth muscle growth\" OR \"pediatric resistance training\") AND (hypertrophy OR \"lean mass\" OR \"muscle cross-sectional area\")",
  pediatric_athlete_nutrition:
    "(\"pediatric athlete nutrition\" OR \"young athlete nutrition\" OR \"adolescent sports nutrition\") AND (\"protein intake\" OR hydration OR \"energy requirements\" OR growth)",
  adolescent_sleep_athlete:
    "(\"adolescent sleep\" OR \"youth athlete sleep\") AND (\"athletic performance\" OR recovery OR training OR \"sleep duration\")",
  youth_plyometrics:
    "(\"youth plyometrics\" OR \"plyometric training children\" OR \"pediatric plyometric\") AND (\"vertical jump\" OR power OR performance OR safety)",
  youth_sprint_training:
    "(\"youth sprint\" OR \"adolescent sprint\" OR \"pediatric sprint training\") AND (\"sprint performance\" OR speed OR development OR adaptation)",
  biological_maturation:
    "(\"biological maturation\" OR \"somatic maturation\" OR \"skeletal age\") AND (athletes OR training OR \"talent identification\" OR performance)",
  prepubescent_strength:
    "(prepubescent OR \"pre-pubertal\" OR \"before puberty\") AND (\"strength training\" OR \"resistance training\" OR \"neural adaptation\")",

  // ── 13. Masters / 40+ athletes ───────────────────────────────
  sarcopenia:
    "(sarcopenia OR \"age-related muscle loss\" OR \"muscle wasting aging\" OR \"skeletal muscle aging\") AND (\"resistance training\" OR exercise OR \"protein supplementation\" OR \"older adults\")",
  strength_training_older_adults:
    "(\"strength training older adults\" OR \"resistance training elderly\" OR \"resistance training aging\") AND (muscle OR strength OR function OR \"quality of life\")",
  vo2_max_preservation:
    "(\"VO2 max\" OR \"cardiorespiratory fitness\") AND (aging OR \"older adults\" OR preservation OR \"masters athletes\" OR \"age-related decline\")",
  bone_density_exercise:
    "(\"bone mineral density\" OR \"bone density\" OR osteoporosis) AND (\"resistance training\" OR \"impact loading\" OR exercise OR \"older adults\")",
  balance_fall_prevention:
    "(balance OR \"fall prevention\" OR \"falls in older adults\" OR \"postural stability\") AND (\"resistance training\" OR exercise OR \"older adults\" OR \"tai chi\")",
  masters_endurance_training:
    "(\"masters athlete\" OR \"older endurance athlete\" OR \"veteran athlete\") AND (\"endurance training\" OR marathon OR cycling OR adaptation OR recovery)",
  recovery_older_athletes:
    "(\"recovery older athletes\" OR \"aging recovery\" OR \"age-related recovery\") AND (\"resistance training\" OR exercise OR sleep OR inflammation)",
  anabolic_resistance_aging:
    "(\"anabolic resistance\" OR \"age-related anabolic resistance\") AND (\"muscle protein synthesis\" OR leucine OR \"protein intake\" OR \"older adults\")",
  age_adjusted_programming:
    "(\"age-adjusted\" OR \"masters training programming\" OR \"older adult programming\") AND (\"resistance training\" OR periodization OR recovery OR \"training load\")",
  masters_powerlifting:
    "(\"masters powerlifting\" OR \"masters powerlifter\" OR \"masters strength sport\") AND (\"resistance training\" OR strength OR \"age-related decline\")",
  testosterone_replacement_training:
    "(\"testosterone replacement therapy\" OR TRT OR \"testosterone supplementation\") AND (\"resistance training\" OR \"lean mass\" OR \"muscle strength\" OR \"older men\")",
  growth_hormone_aging:
    "(\"growth hormone\" OR GH OR \"human growth hormone\") AND (aging OR \"older adults\" OR sarcopenia OR \"muscle mass\")",
  frailty_prevention:
    "(frailty OR \"frailty prevention\" OR \"pre-frail\" OR \"frailty reversal\") AND (exercise OR \"resistance training\" OR \"physical activity\")",
  power_training_aging:
    "(\"power training\" OR \"explosive training\" OR \"high-velocity resistance training\") AND (aging OR \"older adults\" OR \"muscle power\" OR \"functional capacity\")",
  reaction_time_aging:
    "(\"reaction time\" OR \"reaction speed\" OR \"response time\") AND (aging OR \"older adults\" OR exercise OR training)",
  masters_hypertrophy:
    "(\"masters hypertrophy\" OR \"older adult hypertrophy\" OR \"aging hypertrophy\") AND (\"resistance training\" OR \"muscle cross-sectional area\" OR \"lean body mass\")",

  // ── 14. Injury rehab / return to play ────────────────────────
  acl_rehab:
    "(\"anterior cruciate ligament\" OR ACL) AND (reconstruction OR rehabilitation OR \"return to sport\" OR \"return to play\" OR prehabilitation)",
  rotator_cuff_rehab:
    "(\"rotator cuff\" OR supraspinatus OR subscapularis OR infraspinatus) AND (rehabilitation OR \"resistance training\" OR \"return to play\" OR \"exercise therapy\")",
  low_back_rehab:
    "(\"low back pain\" OR LBP OR \"lumbar spine\") AND (exercise OR rehabilitation OR \"resistance training\" OR \"motor control\" OR \"core stability\")",
  achilles_tendinopathy:
    "(\"achilles tendinopathy\" OR \"achilles tendinitis\" OR \"Achilles tendon\") AND (\"eccentric loading\" OR \"heavy slow resistance\" OR rehabilitation OR \"exercise therapy\")",
  patellar_tendinopathy:
    "(\"patellar tendinopathy\" OR \"jumper's knee\" OR \"patellar tendinitis\") AND (\"eccentric loading\" OR \"heavy slow resistance\" OR rehabilitation)",
  tennis_elbow_rehab:
    "(\"lateral epicondylitis\" OR \"tennis elbow\" OR \"lateral elbow tendinopathy\") AND (rehabilitation OR \"eccentric training\" OR \"exercise therapy\")",
  hamstring_strain_rehab:
    "(\"hamstring strain\" OR \"hamstring injury\" OR \"hamstring tear\") AND (rehabilitation OR \"Nordic hamstring\" OR \"eccentric training\" OR \"return to play\")",
  concussion_return_to_play:
    "(concussion OR \"mild traumatic brain injury\" OR mTBI) AND (\"return to play\" OR \"return to sport\" OR \"graded exercise\" OR rehabilitation)",
  tendinopathy_loading:
    "(tendinopathy OR \"tendon loading\" OR \"tendon rehabilitation\") AND (\"eccentric loading\" OR \"heavy slow resistance\" OR isometric OR \"progressive loading\")",
  pain_science_exercise:
    "(\"pain neuroscience education\" OR \"pain science\" OR \"central sensitization\") AND (exercise OR rehabilitation OR \"chronic pain\")",
  meniscus_rehab:
    "(meniscus OR meniscal OR \"meniscus tear\") AND (rehabilitation OR \"return to sport\" OR \"exercise therapy\" OR \"meniscal repair\")",
  shoulder_impingement_rehab:
    "(\"shoulder impingement\" OR \"subacromial impingement\" OR \"impingement syndrome\") AND (rehabilitation OR \"exercise therapy\" OR \"scapular stabilization\")",
  ankle_sprain_rtp:
    "(\"ankle sprain\" OR \"lateral ankle sprain\" OR \"chronic ankle instability\") AND (\"return to play\" OR rehabilitation OR balance OR proprioception)",
  plantar_fasciitis_loading:
    "(\"plantar fasciitis\" OR \"plantar fasciopathy\" OR \"plantar heel pain\") AND (\"high load\" OR rehabilitation OR exercise OR \"eccentric loading\")",
  hip_labrum_rehab:
    "(\"hip labrum\" OR \"acetabular labrum\" OR \"femoroacetabular impingement\" OR FAI) AND (rehabilitation OR \"exercise therapy\" OR \"return to sport\")",
  mcl_lcl_rehab:
    "(\"medial collateral ligament\" OR MCL OR \"lateral collateral ligament\" OR LCL) AND (rehabilitation OR \"return to sport\" OR injury OR \"exercise therapy\")",
  groin_strain_rehab:
    "(\"groin strain\" OR \"groin injury\" OR \"athletic pubalgia\" OR \"sports hernia\") AND (rehabilitation OR \"return to sport\" OR \"exercise therapy\")",
  adductor_rehab:
    "(\"adductor strain\" OR \"adductor injury\" OR \"Copenhagen adduction\") AND (rehabilitation OR strengthening OR \"return to play\")",
  piriformis_syndrome:
    "(\"piriformis syndrome\" OR \"deep gluteal syndrome\") AND (exercise OR rehabilitation OR stretching OR strengthening)",
  si_joint_dysfunction:
    "(\"sacroiliac joint\" OR \"SI joint\" OR \"sacroiliac dysfunction\") AND (exercise OR rehabilitation OR \"pelvic stability\")",

  // ── 15. Endurance specialization ─────────────────────────────
  marathon_training:
    "(\"marathon training\" OR \"marathon runners\" OR \"long-distance running\") AND (\"training volume\" OR pacing OR \"race performance\" OR periodization)",
  triathlon_training:
    "(triathlon OR triathlete OR \"multi-sport training\") AND (\"training volume\" OR \"brick workout\" OR performance OR periodization)",
  cycling_training:
    "(\"cycling training\" OR cyclist OR \"road cycling\") AND (\"power output\" OR FTP OR \"functional threshold\" OR \"training zones\" OR periodization)",
  altitude_training:
    "(\"altitude training\" OR \"hypoxic training\" OR \"live high train low\") AND (\"endurance performance\" OR \"VO2 max\" OR hemoglobin OR adaptation)",
  polarized_training:
    "(\"polarized training\" OR \"polarised training\" OR \"80/20 training\" OR \"training intensity distribution\") AND (endurance OR running OR cycling OR \"VO2 max\" OR performance)",
  pyramidal_training:
    "(\"pyramidal training\" OR \"training intensity distribution\") AND (endurance OR \"lactate threshold\" OR \"training zones\" OR performance)",
  race_tapering:
    "(taper OR tapering OR \"pre-competition taper\") AND (\"endurance performance\" OR \"race performance\" OR \"training load\" OR recovery)",
  heat_acclimation:
    "(\"heat acclimation\" OR \"heat acclimatization\" OR \"thermal tolerance\") AND (\"endurance performance\" OR athletes OR \"core temperature\" OR adaptation)",
  cold_water_immersion_endurance:
    "(\"cold water immersion\" OR \"ice bath\" OR cryotherapy) AND (recovery OR \"endurance performance\" OR inflammation OR \"muscle damage\")",
  ftp_testing:
    "(\"functional threshold power\" OR FTP OR \"20-minute test\" OR \"critical power test\") AND (cycling OR endurance OR \"power output\" OR \"training zones\")",
  critical_power:
    "(\"critical power\" OR \"critical velocity\" OR \"W prime\" OR W') AND (endurance OR \"exercise tolerance\" OR cycling OR running)",
  training_zones_endurance:
    "(\"training zones\" OR \"training intensity\" OR \"heart rate zones\" OR \"power zones\") AND (endurance OR aerobic OR \"lactate threshold\" OR \"VO2 max\")",
  lactate_testing:
    "(\"lactate threshold testing\" OR \"lactate profiling\" OR \"blood lactate\") AND (endurance OR cycling OR running OR athletes)",
  fat_oxidation_max:
    "(\"fat oxidation\" OR \"maximal fat oxidation\" OR Fatmax OR \"lipid oxidation\") AND (exercise OR endurance OR \"metabolic flexibility\")",
  running_form_drills:
    "(\"running drills\" OR \"running form\" OR \"running technique drills\" OR \"A-skip\" OR \"B-skip\") AND (\"running economy\" OR \"running biomechanics\" OR performance)",
  glycogen_supercompensation:
    "(\"glycogen supercompensation\" OR \"carbohydrate loading\" OR \"glycogen loading\") AND (endurance OR marathon OR \"race performance\" OR athletes)",
  race_pacing_strategy:
    "(\"pacing strategy\" OR \"pacing pattern\" OR \"race pacing\") AND (marathon OR triathlon OR endurance OR performance)",
  endurance_periodization:
    "(\"endurance periodization\" OR \"reverse periodization\" OR \"traditional periodization endurance\") AND (marathon OR cycling OR running OR triathlon)",

  // ── 16. Advanced programming methodologies ───────────────────
  block_periodization:
    "(\"block periodization\" OR \"block training\") AND (\"resistance training\" OR \"strength training\" OR \"athletic performance\" OR adaptation)",
  conjugate_method:
    "(\"conjugate method\" OR \"Westside Barbell\" OR \"max effort training\" OR \"dynamic effort\") AND (\"strength training\" OR powerlifting OR \"resistance training\")",
  bulgarian_method:
    "(\"Bulgarian method\" OR \"daily max training\" OR \"daily singles\" OR \"maximum daily attempt\") AND (weightlifting OR powerlifting OR \"strength training\")",
  autoregulation_rpe_rir:
    "(autoregulation OR \"rating of perceived exertion\" OR RPE OR \"repetitions in reserve\" OR RIR) AND (\"resistance training\" OR \"strength training\" OR load)",
  daily_undulating_periodization:
    "(\"daily undulating periodization\" OR DUP OR \"undulating periodization\") AND (\"resistance training\" OR hypertrophy OR strength OR adaptation)",
  peaking_for_competition:
    "(peaking OR \"competition preparation\" OR \"pre-competition\") AND (powerlifting OR weightlifting OR \"strength athletes\" OR tapering)",
  accumulation_intensification:
    "(\"accumulation phase\" OR \"intensification phase\" OR \"training phases\") AND (\"resistance training\" OR periodization OR adaptation)",
  mesocycle_design:
    "(mesocycle OR \"training block\" OR \"training cycle\") AND (\"resistance training\" OR periodization OR \"volume progression\")",
  microcycle_design:
    "(microcycle OR \"weekly training\" OR \"training week\") AND (\"resistance training\" OR periodization OR \"training load\" OR recovery)",
  velocity_based_training:
    "(\"velocity based training\" OR VBT OR \"bar velocity\" OR \"lifting velocity\") AND (\"resistance training\" OR strength OR power)",
  cluster_sets:
    "(\"cluster sets\" OR \"cluster training\" OR \"intra-set rest\") AND (\"resistance training\" OR power OR strength OR hypertrophy)",
  drop_sets_hypertrophy:
    "(\"drop sets\" OR \"descending sets\" OR \"strip sets\") AND (hypertrophy OR \"muscle growth\" OR \"resistance training\")",
  rest_pause_training:
    "(\"rest pause\" OR \"rest-pause\" OR \"myo-reps\") AND (hypertrophy OR \"resistance training\" OR \"muscle growth\")",
  mechanical_tension_vs_metabolic_stress:
    "(\"mechanical tension\" OR \"metabolic stress\" OR \"muscle damage hypertrophy\") AND (hypertrophy OR \"muscle growth\" OR \"resistance training\")",
  prilepin_chart_strength:
    "(\"Prilepin chart\" OR \"Prilepin's table\" OR \"training volume prescription\") AND (\"strength training\" OR weightlifting OR powerlifting)",
  training_to_failure:
    "(\"training to failure\" OR \"muscular failure\" OR \"momentary failure\") AND (hypertrophy OR strength OR \"resistance training\")",
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
