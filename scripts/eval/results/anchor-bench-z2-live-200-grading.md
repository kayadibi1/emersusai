# Grading subset — anchor-bench-z2-live-200.json

Total claims in run: **723**

## Mode distribution (LLM-judged)

| Mode | Count | In this grading subset |
|---|---:|---:|
| mode_3_fabrication | 2 | 2 (all) |
| mode_4_contradicted | 13 | 13 (all) |
| mode_1_misattribution | 18 | 10 |
| mode_2_overgen | 406 | 10 |
| correct | 163 | 10 |

## How to grade each item

For each claim below: read the cited source(s) and judge whether **the LLM's mode classification was correct**.

- **mode_3 (fabrication)**: judge said NO retrieved source supports the claim. You agree if you also can't find support.
- **mode_4 (contradicted)**: judge said a cited source CONTRADICTS the claim. You agree if you find direct contradiction.
- **mode_2 (over-generalized)**: judge said cited source supports the gist but the claim drops qualifiers (population, dose, duration, study design). You agree if you spot the dropped qualifier.
- **mode_1 (misattribution)**: judge said the cited source doesn't support but a different retrieved source does. You agree if a non-cited source has the support.
- **correct**: judge said cited source fully supports with same scope. You agree if the source clearly states the claim.

**Mark `[x]` next to one verdict** under each item. Add notes if it's ambiguous or you want to flag judge errors.

---

# mode_3 (LLM-flagged fabrication — VERIFY THESE)

## 1. [mode_3_fabrication] Proper assessment matters.

**Grading id:** `g1`
**LLM judge verdict:** `mode_3_fabrication`

**Original chat question:** how can new mothers reduce bladder leaks?

**Claim under audit:**

> Proper assessment matters.

**Cited source ids:** 1, 3, 6, 8

**Retrieved sources:**

**[1] ◀ CITED** Pelvic floor muscle training for urinary incontinence postpartum.
_British journal of nursing (Mark Allen Publishing)_
DOI: `10.12968/bjon.2015.24.11.576`
> The offering of pelvic floor muscle exercises to all women during their first pregnancy is recommended by National Institute for Health and Care Excellence (NICE) guidelines. Pelvic floor muscles suffer significant trauma throughout pregnancy and childbirth, which may sometimes lead to urinary incontinence postpartum. However, it is uncertain how effective pelvic floor muscle exercises are in treating this incontinen

**[2]** Managing stress incontinence in postnatal women.
_Nursing times_
> Urinary incontinence can have a significant impact on quality of life. This article explores the causes of stress urinary incontinence, and the impact of childbirth in particular, and discusses the importance of thorough assessment and treatment options.

**[3] ◀ CITED** Narrative review of pelvic floor muscle training for childbearing women-why, when, what, and how.
_2021 · International urogynecology journal_
DOI: `10.1007/s00192-021-04804-z`
> Urinary incontinence (UI) is prevalent during pregnancy and postpartum. UI in pregnancy strongly predicts UI postpartum and later in life. UI reduces women's wellbeing and quality of life and presents a significant burden to healthcare resource. A narrative review summarizing quantitative and qualitative evidence about pelvic floor muscle training (PFMT) for prevention and treatment of UI for childbearing women. Ther

**[4]** Primary Prevention of Urinary Incontinence: A Case Study of Prenatal and Intrapartum Interventions.
_2016 · Journal of midwifery &amp; women's health_
DOI: `10.1111/jmwh.12420`
> A wealth of information is available regarding the diagnosis and treatment of urinary incontinence. However, there is a dearth of quality information and clinical practice guidelines regarding the primary prevention of urinary incontinence. Given the high prevalence of this concern and the often cited correlation between pregnancy, childbirth, and urinary incontinence, women's health care providers should be aware of

**[5]** Preventing urinary incontinence during pregnancy and postpartum: a review.
_2013 · International urogynecology journal_
DOI: `10.1007/s00192-012-2017-3`
> Urinary incontinence (UI) is a common condition in association with pregnancy. Incident UI in pregnancy or postpartum are significant risk factors for UI later in life. Epidemiological studies on UI during pregnancy and postpartum list numerous variables associated with UI. For women, the main focus is on pelvic floor muscle training to prevent UI. However, several other modifiable risk factors are likely to contribu

**[6] ◀ CITED** Pelvic floor muscle training for prevention and treatment of urinary and fecal incontinence in antenatal and postnatal women: a short version Cochrane review.
_2014 · Neurourology and urodynamics_
DOI: `10.1002/nau.22402`
> Pelvic floor muscle training (PFMT) is commonly recommended during pregnancy and after birth both for prevention and the treatment of incontinence. Effect of pelvic floor muscle training compared to usual antenatal and postnatal care on incontinence. Cochrane Incontinence Group Specialized Register; handsearching (searched February 7, 2012); the references of relevant articles. Randomized or quasi-randomized controll

**[7]** Effects of Training Interventions to Treat Postpartum Urinary Incontinence: A Meta-Analysis.
_2026 · BJOG : an international journal of obstetrics and gynaecology_
DOI: `10.1111/1471-0528.70014`
> Urinary incontinence (UI) is a common symptom after childbirth. Training interventions are recommended for its management. To evaluate the effects of abdominal and/or pelvic floor muscle training (PFMT) combined with other conservative tools. The MEDLINE, Scopus, Cochrane Library, Web of Science and Physiotherapy Evidence Database (PEDro) databases were searched from inception to November 6th, 2024. Three reviewers i

**[8] ◀ CITED** Effectiveness of Pelvic Floor Muscle Training in Preventing Urinary Incontinence After Vaginal Delivery: A Systematic Review.
_2025 · Cureus_
DOI: `10.7759/cureus.88059`
> Urinary incontinence (UI) is a common issue among women after vaginal delivery and can have various impacts on daily life. Pelvic floor muscle training (PFMT) is often used as a preventive intervention, although its effectiveness has shown mixed results in research. This systematic review evaluates the effectiveness of PFMT in preventing UI after vaginal delivery by synthesizing evidence from randomized controlled tr

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 2. [mode_3_fabrication] Excess body fat, especially visceral/central fat, is linked to higher free fatty acids, lo…

**Grading id:** `g2`
**LLM judge verdict:** `mode_3_fabrication`

**Original chat question:** How does excess body fat affect hormone levels and metabolism?

**Claim under audit:**

> Excess body fat, especially visceral/central fat, is linked to higher free fatty acids, lower adiponectin, and increased leptin resistance.

**Cited source ids:** 2, 4, 5, 6

**Retrieved sources:**

**[1]** Visceral Obesity: A “Civilization Syndrome”
_1993 · Review · Obesity Research_
DOI: `10.1002/j.1550-8528.1993.tb00614.x`
> The controversial question of the relationship between obesity and disease has been considerably clearer after the demonstration in several prospective, epidemiological studies that the subgroup of central, visceral obesity is particularly prone to develop cardiovascular disease, stroke, and non-insulin dependent diabetes mellitus. Visceral obesity is associated with multiple central endocrine aberrations. The hypoth

**[2] ◀ CITED** Metabolic Implications of Body Fat Distribution
_1991 · Review · Diabetes Care_
DOI: `10.2337/diacare.14.12.1132`
> Insulin resistance is the cornerstone for the development of non-insulin-dependent diabetes mellitus (NIDDM). Free fatty acids (FFAs) cause insulin resistance in muscle and liver and increase hepatic gluconeogenesis and lipoprotein production and perhaps decrease hepatic clearance of insulin. It is suggested that the depressing effect of insulin on circulating FFA concentration is dependent on the fraction derived fr

**[3]** The Impact of the Endocrine and Immunological Function of Adipose Tissue on Reproduction in Women with Obesity.
_2024 · Journal Article, Review · International journal of molecular sciences_
DOI: `10.3390/ijms25179391`
> Obesity, which leads to metabolic dysregulation and body function impairment, emerges as one of the pressing health challenges worldwide. Excessive body fat deposits comprise a dynamic and biologically active organ possessing its own endocrine function. One of the mechanisms underlying the pathophysiology of obesity is low-grade systemic inflammation mediated by pro-inflammatory factors such as free fatty acids, lipo

**[4] ◀ CITED** Adipose “Talks” to Distant Organs to Regulate Insulin Sensitivity and Vascular Function
_2010 · Review · Obesity_
DOI: `10.1038/oby.2010.91`
> Increased circulating free fatty acid levels and inflammatory cytokines, reduced circulating adiponectin levels, and enhanced leptin resistance may all contribute to the decrease in lipid oxidation in other insulin-sensitive organs, thereby triggering ectopic accumulation of lipids, lipotoxicity, and insulin resistance ((5)) (Figure 1). Chronically positive energy balance gradually progresses to insulin resistance. I

**[5] ◀ CITED** Obesity-Initiated Metabolic Syndrome and the Kidney
_2004 · Review · Journal of the American Society of Nephrology_
DOI: `10.1097/01.asn.0000141965.28037.ee`
> : Intracellular pathways of insulin resistance. Accumulation of FA and its metabolites (fatty acyl CoA and diacylglycerol) induce protein kinase C isoforms, leading to serine/threonine phosphorylation of insulin receptor substrate-1 (IRS-1) on serine 302. This renders the IRS-1 resistant to tyrosine phosphorylation by the activated insulin receptor. As a result, downstream effects of insulin receptor activation—Akt a

**[6] ◀ CITED** Adipocytokines, Metabolic Syndrome, and Exercise
_2014 · International Journal of Endocrinology_
DOI: `10.1155/2014/597162`
> Cardiovascular disease is responsible for about one-third of deaths in developed countries and contributes to substantial health care costs [1]. Even in developing nations, cardiovascular disease is on the rise, especially in urban areas [2]. Increased central adiposity is associated with a clustering of risk factors for cardiovascular disease, including elevation in fasting triglycerides and glucose, increased resti

**[7]** Estrogens and Glucocorticoid Hormones in Adipose Tissue Metabolism
_2007 · Current Medicinal Chemistry_
DOI: `10.2174/092986707782359972`
> Women have a higher percentage of body fat than men, and there is a gender-specific difference in fat distribution: Females tend to accumulate fat around the hips, buttocks, and thighs while men have a larger intra-abdominal (visceral) fat mass. After menopause, there is a redistribution of fat depots, and post-menopausal women develop increased amounts of visceral fat. The risk of developing obesity-related diseases

**[8]** Testosterone and obesity.
_2015 · Journal Article, Research Support, Non-U.S. Gov't, Review · Obesity reviews : an official journal of the International Association for the Study of Obesity_
DOI: `10.1111/obr.12282`
> Testosterone is a key hormone in the pathology of metabolic diseases such as obesity. Low testosterone levels are associated with increased fat mass (particularly central adiposity) and reduced lean mass in males. These morphological features are linked to metabolic dysfunction, and testosterone deficiency is associated with energy imbalance, impaired glucose control, reduced insulin sensitivity and dyslipidaemia. A

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

# mode_4 (LLM-flagged contradicted — VERIFY THESE)

## 3. [mode_4_contradicted] A ketogenic diet can improve insulin sensitivity in people with type 2 diabetes.

**Grading id:** `g3`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** ketogenic diet insulin resistance

**Claim under audit:**

> A ketogenic diet can improve insulin sensitivity in people with type 2 diabetes.

**Cited source ids:** 1, 2, 4, 5

**Retrieved sources:**

**[1] ◀ CITED** Ketogenic Diet as an Adjunct Therapy for Type 2 Diabetes Mellitus: A Systematic Review
_2025 · International Journal of Pharmaceutical Quality Assurance_
DOI: `10.25258/ijpqa.16.3.16`
> The ketogenic diet (KD) is a high-fat, low-carbohydrate regimen that induces ketosis, shifting the body's metabolism from glucose to ketone bodies. This systematic review consolidates evidence from 25 clinical and preclinical studies published between 2000 and 2023 to assess the role of KD as an adjunct therapy for Type 2 Diabetes Mellitus (T2DM). The findings show that KD significantly improves glycemic control, wit

**[2] ◀ CITED** A high-fat, ketogenic diet causes hepatic insulin resistance in mice, despite increasing energy expenditure and preventing weight gain
_2010 · American Journal of Physiology-Endocrinology and Metabolism_
DOI: `10.1152/ajpendo.00361.2010`
> Low-carbohydrate, high-fat ketogenic diets (KD) have been suggested to be more effective in promoting weight loss than conventional caloric restriction, whereas their effect on hepatic glucose and lipid metabolism and the mechanisms by which they may promote weight loss remain controversial. The aim of this study was to explore the role of KD on liver and muscle insulin sensitivity, hepatic lipid metabolism, energy e

**[3]** Modulation of endoplasmic reticulum stress–induced insulin resistance by the low-carbohydrate high-fat ketogenic diet
_2026 · Frontiers in Nutrition_
DOI: `10.3389/fnut.2025.1704597`
> This review aimed to investigate the relationship between endoplasmic reticulum (ER) stress, insulin resistance, and the potential mitigating effects of a low-carbohydrate, high-fat diet, Ketogenic diet (LCHF-KD). A detailed literature search using databases to achieve a comprehensive overview. The keywords of the search were “endoplasmic reticulum stress,” “insulin resistance,” “metabolic syndrome,” and “low carbohy

**[4] ◀ CITED** Short‐term feeding of a ketogenic diet induces more severe hepatic insulin resistance than an obesogenic high‐fat diet
_2018 · The Journal of Physiology_
DOI: `10.1113/jp275173`
> Key points A ketogenic diet is known to lead to weight loss and is considered metabolically healthy; however there are conflicting reports on its effect on hepatic insulin sensitivity. KD fed animals appear metabolically healthy in the fasted state after 3 days of dietary challenge, whereas obesogenic high‐fat diet (HFD) fed animals show elevated insulin levels. A glucose challenge reveals that both KD and HFD fed an

**[5] ◀ CITED** Effect of weight-maintaining ketogenic diet on glycemic control and insulin sensitivity in obese T2D subjects.
_2024 · Journal Article, Randomized Controlled Trial · BMJ open diabetes research & care_
DOI: `10.1136/bmjdrc-2024-004199`
> Low carbohydrate ketogenic diets have received renewed interest for the treatment of obesity and type 2 diabetes. These diets promote weight loss, improve glycemic control, and reduce insulin resistance. However, whether the improvements in glycemic control and insulin sensitivity are secondary to the weight loss or result from a direct effect of hyperketonemia is controversial.

**[6]** Insulin Sensitivity and Glucose Tolerance Are Altered by Maintenance on a Ketogenic Diet
_2010 · Journal Article · Endocrinology_
DOI: `10.1210/en.2010-0175`
> Low-carbohydrate, ketogenic diets (KD) are frequently implemented in efforts to reduce or maintain body weight, although the metabolic effects of long-term exposure to this type of diet remain controversial. This study assessed the responsivity to peripheral and central insulin, glucose tolerance, and meal-induced effects of consuming a KD in the rat. After 8 wk of consuming chow or KD, caloric intake after periphera

**[7]** Beneficial Effects of Carbohydrate Restriction in Type 2 Diabetes Can Be Traced to Changes in Hepatic Metabolism.
_2025 · The Journal of clinical endocrinology and metabolism_
DOI: `10.1210/clinem/dgaf324`
> Carbohydrate restriction benefits metabolic health in patients with type 2 diabetes (T2D), possibly through changes in hepatic metabolism. To test the hypothesis that the ketogenic diet (KD) would decrease de novo lipogenesis (DNL) and liver fat, which would be associated with restored beta-cell function. Participants were 57 adults with mild T2D. A hyperglycemic clamp was used to assess acute C-peptide response (ACP

**[8]** Effect of ketogenic diet in type 2 diabetes mellitus
_2024 · International Journal of Public Health and Medical Research_
DOI: `10.62051/ijphmr.v1n1.08`
> Diabetes is a prevalent chronic condition globally, where dietary intervention plays a crucial role in its management. The ketogenic diet, high in fat, moderate in protein and low in carbohydrates, was studied to determine its impact on people with type 2 diabetes. Pertinent research was collected and analysed. Ketogenic diet has positive effects on type 2 diabetes, which can decrease blood sugar, lose weight and imp

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 4. [mode_4_contradicted] Warm-up can improve cycling performance.

**Grading id:** `g4`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** what is the best way to warm up before intense cycling?

**Claim under audit:**

> Warm-up can improve cycling performance.

**Cited source ids:** 1, 3, 7

**Retrieved sources:**

**[1] ◀ CITED** Effect of Warm-Up on Cycling Time Trial Performance
_2004 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1097/00005768-200405001-00584`
> 0834 Warm-up is a common feature of the pre-competition preparation for most athletes. There are, however, few data documenting whether warm-up actually has an effect on competitive performance. It is expected that warm-up accelerates VO2 kinetics and allows a sparing of anaerobic energy for later use in an event. PURPOSE: This study was designed to determine the effect of warm-up on 3-km cycling time trial performan

**[2]** Effects of work-matched moderate- and high-intensity warm-up on power output during 2-min supramaximal cycling
_2018 · Biology of Sport_
DOI: `10.5114/biolsport.2018.74633`
> We tested the hypothesis that compared with a moderate-intensity warm-up, a work-matched high-intensity warm-up improves final-sprint power output during the last 30 s of a 120-s supramaximal exercise that mimics the final sprint during events such as the 800-m run, 1,500-m speed skate, or Keirin (cycling race). Nine active young males performed a 120-s supramaximal cycling exercise consisting of 90 s of constantwork

**[3] ◀ CITED** Warming Up Before a 20-Minute Endurance Effort: Is It Really Worth It?
_2020 · International Journal of Sports Physiology and Performance_
DOI: `10.1123/ijspp.2019-0554`
> Purpose : To analyze the effects of different warm-up protocols on endurance-cycling performance from an integrative perspective (by assessing perceptual, neuromuscular, physiological, and metabolic variables). Methods : Following a randomized crossover design, 15 male cyclists (35 [9] y; peak oxygen uptake [VO 2 peak] 66.4 [6.8] mL·kg −1 ·min −1 ) performed a 20-minute cycling time trial (TT) preceded by no warm-up,

**[4]** The Effects of a Cycling Warm-up Including High-Intensity Heavy-Resistance Conditioning Contractions on Subsequent 4-km Time Trial Performance
_2017 · Journal Article · The Journal of Strength and Conditioning Research_
DOI: `10.1519/jsc.0000000000001908`
> Chorley, A and Lamb, KL. The effects of a cycling warm-up including high-intensity heavy-resistance conditioning contractions on subsequent 4-km time trial performance. J Strength Cond Res 33(1): 57-65, 2019-Previous exercise has been shown to improve subsequent performance through different mechanisms. Sport-specific conditioning contractions can be used to exploit the "post-activation potentiation" (PAP) phenomenon

**[5]** Effect Of Overload Sprint Cycling On Subsequent Power Output
_2010 · Journal Article · The Journal of Strength and Conditioning Research_
DOI: `10.1097/01.jsc.0000367156.57240.af`
> Research suggests that warm-ups which elicit a post activation potentiation (PAP) effect via high intensity muscular contractions may increase performance in subsequent activities requiring strength and power. Warm-up strategies designed to elicit a PAP may positively impact performance. The purpose of this investigation was to determine if a cycling warm-up that included a maximal overload would elicit a PAP effect

**[6]** Effect of Short-Duration High-Intensity Upper-Body Pre-Load Component on Performance among High-Level Cyclists
_2022 · Article · Sports_
DOI: `10.3390/sports10030032`
> Decades later, successful speeding up of V˙ O₂ kinetics has been investigated in numerous studies; however, only marginal performance-related changes have been detected [ , , , ]. Practical implications should be therefore based instead on standardised approach; while improved physiological changes do not guarantee improved competitiveness [ ]. A traditional warm-up process, consist of light endurance activity and st

**[7] ◀ CITED** Warm-up strategy and high-intensity endurance performance in trained cyclists.
_2015 · Journal Article, Research Support, Non-U.S. Gov't · International journal of sports physiology and performance_
DOI: `10.1123/ijspp.2014-0228`
> Warm-up exercise including race-pace and sprint intervals combined with short recovery can reduce subsequent performance in a 4-min maximal test in highly trained cyclists. Thus, a reduced time at high exercise intensity, a reduced intensity in the warm-up, or an extension of the recovery period after an intense warm-up is advocated.

**[8]** Potentiation of sprint cycling performance: the effects of a high-inertia ergometer warm-up
_2016 · Journal Article · Journal of Sports Sciences_
DOI: `10.1080/02640414.2016.1215492`
> Participant and protocol factors affect post-activation potentiation response. Performance enhancement is more consistent in highly-trained participants following multiple sets of a biomechanically similar conditioning activity. Providing optimal conditions, 6 international-level sprint cyclists executed multiple sets of short maximal conditioning contractions on a high-inertia ergometer before metered sprint perform

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 5. [mode_4_contradicted] In mice and rats, quercetin was associated with mitochondrial biogenesis/oxidative markers…

**Grading id:** `g5`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** Can quercetin supplementation enhance mitochondrial function and endurance?

**Claim under audit:**

> In mice and rats, quercetin was associated with mitochondrial biogenesis/oxidative markers and better exercise tolerance or endurance-related outcomes, but the human trial in untrained men found it was not ergogenic.

**Cited source ids:** 2, 4, 8

**Retrieved sources:**

**[1]** Effect Of Quercetin Feedings On Tissue Mitochondrial Enzymes And Performance In Mice
_2007 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/01.mss.0000273265.07913.e7`
> The naturally occurring dietary flavonoid Quercetin (concentrated in red apples, red onions & red grapes) has been shown to reduce the damaging effects of oxygen radicals (antioxidant effect) during tissue injury and/or metabolic stress. Mitochondria are a major source of reactive oxygen species, which are known to have a negative effect on mitochondrial homeostasis. However, to date the only information about a bene

**[2] ◀ CITED** Quercetin increases brain and muscle mitochondrial biogenesis and exercise tolerance.
_2009 · American Journal of Physiology. Regulatory Integrative and Comparative Physiology_
DOI: `10.1152/ajpregu.90925.2008`
> Quercetin is one of a broad group of natural polyphenolic flavonoid substances that are being investigated for their widespread health benefits. These benefits have generally been ascribed to its combination of antioxidant and anti-inflammatory activity, but recent in vitro evidence suggests that improved mitochondrial biogenesis could play an important role. In addition, the in vivo effects of quercetin on mitochond

**[3]** Quercetin in Endurance Training: A Review of Its Antioxidant and Fatigue-Resisting Properties
_2025 · Natural Product Communications_
DOI: `10.1177/1934578X251400640`
> Quercetin, a ubiquitous dietary flavonoid, has garnered significant scientific interest for its potential as an ergogenic aid in endurance sports. This interest is predicated on robust preclinical evidence demonstrating its potent antioxidant, anti-inflammatory, and mitochondrial biogenesis-stimulating properties. However, a persistent disconnect remains between promising laboratory findings and the equivocal, incons

**[4] ◀ CITED** Effect of Quercetin Treatment on Mitochondrial Biogenesis and Exercise-Induced AMP-Activated Protein Kinase Activation in Rat Skeletal Muscle
_2020 · Journal Article · Nutrients_
DOI: `10.3390/nu12030729`
> The purpose of this study was to evaluate the effect of chronic quercetin treatment on mitochondrial biogenesis, endurance exercise performance and activation levels of AMP-activated protein kinase (AMPK) in rat skeletal muscle. Rats were assigned to a control or quercetin group and were fed for 7 days. Rats treated with quercetin showed no changes in the protein levels of citrate synthase or cytochrome C oxidase IV

**[5]** The Dietary Flavonoid Quercetin Increases VO2max and Endurance Capacity
_2010 · Journal Article · International Journal of Sport Nutrition and Exercise Metabolism_
DOI: `10.1123/ijsnem.20.1.56`
> Quercetin, a natural polyphenolic flavonoid substance present in a variety of food plants, has been shown in vitro and in animal studies to have widespread health and performance benefits resulting from a combination of biological properties, including antioxidant and anti-inflammatory activity, as well as the ability to increase mitochondrial biogenesis. Little is known about these effects in humans, however, especi

**[6]** Quercetin Lowers Blood Lactate Response During Progressively Intense Exercise
_2011 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/01.mss.0000401182.48661.ea`
> Research has demonstrated the potential for mitochondrial biogenesis with chronic quercetin ingestion and such an elevation in mitochondrial content could reduce reliance on anaerobic metabolism at high exercise intensities. PURPOSE: The purpose of this study was to investigate the impact of 21 days of quercetin ingestion (1,000 mg/day) on blood lactate response during incremental exercise to 90% VO2peak. METHODS: Se

**[7]** Ergogenic effects of quercetin supplementation in trained rats
_2013 · Journal of the International Society of Sports Nutrition_
DOI: `10.1186/1550-2783-10-3`
> Quercetin is a natural polyphenolic compound currently under study for its ergogenic capacity to improve mitochondrial biogenesis. Sedentary mice have exhibited increased endurance performance, but results are contradictory in human models.We examined the effects of six weeks of endurance training and quercetin supplementation on markers of endurance performance and training in a rodent model. Rats were randomly assi

**[8] ◀ CITED** Dietary quercetin supplementation is not ergogenic in untrained men.
_2009 · Journal Article, Randomized Controlled Trial, Research Support, Non-U.S. Gov't · Journal of applied physiology (Bethesda, Md. : 1985)_
DOI: `10.1152/japplphysiol.00234.2009`
> Quercetin supplementation increases muscle oxidative capacity and endurance in mice, but its ergogenic effect in humans has not been established. Our study investigates the effects of short-duration chronic quercetin supplementation on muscle oxidative capacity; metabolic, perceptual, and neuromuscular determinants of performance in prolonged exercise; and cycling performance in untrained men. Using a double-blind, p

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 6. [mode_4_contradicted] HRV can differ across athlete types even when both are trained.

**Grading id:** `g6`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** link between heart rhythm patterns and fitness levels

**Claim under audit:**

> HRV can differ across athlete types even when both are trained.

**Cited source ids:** 2, 3, 5, 8

**Retrieved sources:**

**[1]** HEART RATE VARIABILITY ACROSS LEVELS OF FITNESS IN PHYSICALLY FIT INDIVIDUALS
_2002 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1097/00005768-200205001-00228`
> Heart rate variability (HRV) has been shown to correlate with fitness. However, previous studies have compared very low fit to very high fit groups, creating the potential for numerous confounders. It remains unclear if HRV varies across fit groups within individuals with high fitness. PURPOSE: To examine the relationship between maximal aerobic capacity and autonomic balance as assessed by HRV in subjects with high

**[2] ◀ CITED** Resting heart rate variability and cardiorespiratory fitness in healthy young adults
_2016 · Journal Article · Indian Journal of Medical Specialities_
DOI: `10.1016/j.injms.2016.11.004`
> Heart rate recovery (HRR) following maximal or submaximal exercise and Metabolic Equivalents (METs) reflect cardiovascular fitness. In the present study resting Heart Rate Variability (HRV) measures, HRR following submaximal exercise and METs were correlated. Sixty two healthy volunteers in the age group of 18–24 years were subjected to short term baseline HRV evaluation in frequency domains and submaximal treadmill

**[3] ◀ CITED** Heart Rate Variability and Cardiovascular Fitness: What We Know so Far
_2021 · Vascular Health and Risk Management_
DOI: `10.2147/vhrm.s279322`
> Fluctuation analysis in intervals between heartbeats provides important indices related to autonomic modulation of heart rate variability (HRV). These indices are considered predictors of morbidity and mortality as they are frequently altered in patients with chronic degenerative diseases, especially in those with cardiovascular and metabolic diseases. Similarly, a reduction in HRV is common with aging. In all cases,

**[4]** Heart rate variability and aerobic fitness
_1993 · American Heart Journal_
DOI: `10.1016/0002-8703(93)90164-5`
> Heart rate variability, a noninvasive marker of parasympathetic activity, diminishes with aging and is augmented after exercise training. Whether habitual exercise over time can attenuate this loss is unknown. This cross-sectional investigation compared 72 male runners, aged 15 to 83 to 72 age- and weight-matched sedentary control subjects for the amplitude of their heart rate variability. Heart rate variability was

**[5] ◀ CITED** Interaction between age and aerobic fitness in determining heart rate dynamics
_2012 · Journal Article · Physiological Measurement_
DOI: `10.1088/0967-3334/33/6/901`
> Heart rate variability (HRV) and phase-rectified signal averaging (PRSA) estimates of heart rate dynamics are diminished in older people compared with younger people. However, it is not fully elucidated whether these differences are related to age per se or to the concomitant influence of aerobic fitness. Aerobic fitness (peak oxygen uptake, gas exchange threshold, oxygen uptake kinetics, exercise economy) was assess

**[6]** Effects of aerobic training on heart rate
_2003 · Journal Article · Revista Brasileira de Medicina do Esporte_
DOI: `10.1590/s1517-86922003000200006`
> Regular physical exercise is an important factor to reduce the indexes of cardiovascular and all causes morbimortality. However, there is, apparently, additional and independent benefits of the regular practice of physical exercise and the improvement of the level of aerobic condition. Heart rate (HR) is mediated primarily by the direct activity of the autonomic nervous system (ANS), specifically through the sympathe

**[7]** Variability of Heart Rate in Athletes and Non Athletes
_2019 · European Journal of Public Health_
DOI: `10.1093/eurpub/ckz034.098`
> Introduction: Heart rate variability (HRV) consists of measuring the time interval between beats. This describes oscillations in the interval between consecutive heart beats (R-R intervals) that reflect changes in heart rate as a function of the sympathetic and parasympathetic system. Regular practice of physical activity is a factor responsible for the increase in vagal tone due to increased cardiac work, since ther

**[8] ◀ CITED** Heart Rate Variability Reflects Similar Cardiac Autonomic Function in Explosive and Aerobically Trained Athletes
_2021 · Journal Article · International Journal of Environmental Research and Public Health_
DOI: `10.3390/ijerph182010669`
> Autonomic cardiac function can be indirectly detected non-invasively by measuring the variation in microtiming of heart beats by a method known as heart rate variability (HRV). Aerobic training for sport is associated with reduced risk for some factors associated with cardiovascular diseases (CVD), but effects on autonomic function in different athlete types are less known. To compare cardiac autonomic modulation usi

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 7. [mode_4_contradicted] The data on whether proprioceptive stretching reduces post-exercise muscle soreness are li…

**Grading id:** `g7`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** Does proprioceptive stretching reduce muscle soreness after exercise?

**Claim under audit:**

> The data on whether proprioceptive stretching reduces post-exercise muscle soreness are limited.

**Cited source ids:** 1, 7, 6

**Retrieved sources:**

**[1] ◀ CITED** The Effects of Proprioceptive Neuromuscular Facilitation Stretching on Post-Exercise Delayed Onset Muscle Soreness in Young Adults.
_2014 · Journal Article · International journal of exercise science_
DOI: `10.70252/AYJX8444`
> Until recently, the scientific community believed that post-exercise stretching could reduce delayed onset muscle soreness (DOMS), but recent reviews of studies on the topic have concluded that pre- or post-exercise static stretching has no effect on mitigating DOMS. However, the effect of proprioceptive neuromuscular facilitation (PNF) post-exercise stretching on preventing DOMS has not been adequately studied. The

**[2]** Optimizing recovery: how PNF stretching and ice massage alleviate markers of DOMS?
_2024 · Journal Article · Retos_
DOI: `10.47197/retos.v58.107992`
> Delayed onset muscle soreness (DOMS) is a common problem for both trained or untrained individuals that develop after eccentric or unaccustomed exercise. The large number of cases of DOMS and the varying results of research related to the prevention and treatment of DOMS, imply the importance of research in the effective DOMS prevention. The aim of this research was to investigate the post-exercise effects of combina

**[3]** The acute effect of stretching on eccentrically-damaged muscle: analysis of differences between Hold relax stretching and modified PNF stretching
_2020 · Journal Article · Japanese Journal of Physical Fitness and Sports Medicine_
DOI: `10.7600/jspfsm.69.157`
> It is well known that eccentric exercise induces muscle damage that is characterized by a prolonged decrease in muscle strength and range of motion, development of delayed onset muscle soreness. The previous studies showed that hold-relax stretching (HRS) was effective for improving the decreases in range of motion and muscle soreness. In addition, modified proprioceptive neuromuscular facilitation stretching (mPNF)

**[4]** Comparing the effectiveness of static stretching and proprioceptive neuromuscular facilitation stretching in treating delayed onset muscle soreness in calf muscles of runners
_2022 · Anaesthesia, Pain &amp; Intensive Care_
DOI: `10.35975/apic.v26i1.1763`
> Objectives: To evaluate the comparative effectiveness of proprioceptive neuromuscular facilitation (PNF) and static stretching in relieving pain, increasing range of motion and improving functional disability in runners suffering from calf muscle delayed onset muscle soreness (DOMS). Methodology: In this randomized controlled trial a sample size of 48 patients was taken from various gymnasiums of Faisalabad which wer

**[5]** Comparative Effect of Proprioceptive Neuromuscular Facilitation Stretching Technique with and Without Vibration Therapy in Calf Muscles in Prevention of Delayed Onset Muscle Soreness
_2025 · Journal of Health, Wellness and Community Research_
DOI: `10.61919/7551y188`
> Background: Delayed onset muscle soreness (DOMS) is a self-limiting but functionally disruptive condition that typically develops 24–72 hours after unaccustomed eccentric exercise, manifesting as muscle pain, stiffness, and reduced performance. Proprioceptive neuromuscular facilitation (PNF) stretching and vibration therapy are both used to enhance flexibility, neuromuscular control, and circulation; however, their c

**[6] ◀ CITED** The effect of kinesio taping versus stretching techniques on muscle soreness, and flexibility during recovery from nordic hamstring exercise.
_2017 · Journal Article, Randomized Controlled Trial · Journal of bodywork and movement therapies_
DOI: `10.1016/j.jbmt.2016.04.001`
> The purpose of this study was to examine the effects of static stretching, proprioceptive neuromuscular facilitation (PNF) stretching, or kinesio taping (KT) on muscle soreness and flexibility during recovery from exercise. Sixty-five females were randomly assigned to four groups: PNF stretching (n = 15), static stretching (n = 16), KT (n = 17), and control (n = 17). All participants performed nordic hamstring exerci

**[7] ◀ CITED** The Effect of Static Stretching and Proprioceptive Neuromuscular Facilitation Stretching in Reducing Delayed Onset Muscle Soreness among Adults: A Systematic Review
_2024 · International Journal For Multidisciplinary Research_
DOI: `10.36948/ijfmr.2024.v06i06.31533`
> Stretching is typically done as part of a warm-up regimen before training or competition to improve muscle flexibility, and performance and prevent DOMS. Stretching techniques include static, ballistic and proprioceptive neuromuscular facilitation (PNF). Limited data supports the effectiveness of static and PNF stretching in reducing DOMS, despite its perceived ease and safety. Studies indicate stretching had an impa

**[8]** A prophylactic effect of proprioceptive neuromuscular facilitation (PNF) stretching on symptoms of muscle damage induced by eccentric exercise of the wrist extensors
_2010 · Journal Article · Journal of Bodywork and Movement Therapies_
DOI: `10.1016/j.jbmt.2010.07.006`
> Stretching with proprioceptive neuromuscular facilitation (PNF) is frequently used before exercise. The prophylactic effect of PNF on symptoms of muscle damage induced by eccentric exercise of the wrist extensors was examined in this study. Twenty-eight healthy males were randomly divided into the PNF group (n = 14) and the control group (n = 14). PNF was used before eccentric exercise induction in the wrist extensor

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 8. [mode_4_contradicted] Static stretching has no effect on delayed onset muscle soreness.

**Grading id:** `g8`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** Does proprioceptive stretching reduce muscle soreness after exercise?

**Claim under audit:**

> Static stretching has no effect on delayed onset muscle soreness.

**Cited source ids:** 1, 7, 6

**Retrieved sources:**

**[1] ◀ CITED** The Effects of Proprioceptive Neuromuscular Facilitation Stretching on Post-Exercise Delayed Onset Muscle Soreness in Young Adults.
_2014 · Journal Article · International journal of exercise science_
DOI: `10.70252/AYJX8444`
> Until recently, the scientific community believed that post-exercise stretching could reduce delayed onset muscle soreness (DOMS), but recent reviews of studies on the topic have concluded that pre- or post-exercise static stretching has no effect on mitigating DOMS. However, the effect of proprioceptive neuromuscular facilitation (PNF) post-exercise stretching on preventing DOMS has not been adequately studied. The

**[2]** Optimizing recovery: how PNF stretching and ice massage alleviate markers of DOMS?
_2024 · Journal Article · Retos_
DOI: `10.47197/retos.v58.107992`
> Delayed onset muscle soreness (DOMS) is a common problem for both trained or untrained individuals that develop after eccentric or unaccustomed exercise. The large number of cases of DOMS and the varying results of research related to the prevention and treatment of DOMS, imply the importance of research in the effective DOMS prevention. The aim of this research was to investigate the post-exercise effects of combina

**[3]** The acute effect of stretching on eccentrically-damaged muscle: analysis of differences between Hold relax stretching and modified PNF stretching
_2020 · Journal Article · Japanese Journal of Physical Fitness and Sports Medicine_
DOI: `10.7600/jspfsm.69.157`
> It is well known that eccentric exercise induces muscle damage that is characterized by a prolonged decrease in muscle strength and range of motion, development of delayed onset muscle soreness. The previous studies showed that hold-relax stretching (HRS) was effective for improving the decreases in range of motion and muscle soreness. In addition, modified proprioceptive neuromuscular facilitation stretching (mPNF)

**[4]** Comparing the effectiveness of static stretching and proprioceptive neuromuscular facilitation stretching in treating delayed onset muscle soreness in calf muscles of runners
_2022 · Anaesthesia, Pain &amp; Intensive Care_
DOI: `10.35975/apic.v26i1.1763`
> Objectives: To evaluate the comparative effectiveness of proprioceptive neuromuscular facilitation (PNF) and static stretching in relieving pain, increasing range of motion and improving functional disability in runners suffering from calf muscle delayed onset muscle soreness (DOMS). Methodology: In this randomized controlled trial a sample size of 48 patients was taken from various gymnasiums of Faisalabad which wer

**[5]** Comparative Effect of Proprioceptive Neuromuscular Facilitation Stretching Technique with and Without Vibration Therapy in Calf Muscles in Prevention of Delayed Onset Muscle Soreness
_2025 · Journal of Health, Wellness and Community Research_
DOI: `10.61919/7551y188`
> Background: Delayed onset muscle soreness (DOMS) is a self-limiting but functionally disruptive condition that typically develops 24–72 hours after unaccustomed eccentric exercise, manifesting as muscle pain, stiffness, and reduced performance. Proprioceptive neuromuscular facilitation (PNF) stretching and vibration therapy are both used to enhance flexibility, neuromuscular control, and circulation; however, their c

**[6] ◀ CITED** The effect of kinesio taping versus stretching techniques on muscle soreness, and flexibility during recovery from nordic hamstring exercise.
_2017 · Journal Article, Randomized Controlled Trial · Journal of bodywork and movement therapies_
DOI: `10.1016/j.jbmt.2016.04.001`
> The purpose of this study was to examine the effects of static stretching, proprioceptive neuromuscular facilitation (PNF) stretching, or kinesio taping (KT) on muscle soreness and flexibility during recovery from exercise. Sixty-five females were randomly assigned to four groups: PNF stretching (n = 15), static stretching (n = 16), KT (n = 17), and control (n = 17). All participants performed nordic hamstring exerci

**[7] ◀ CITED** The Effect of Static Stretching and Proprioceptive Neuromuscular Facilitation Stretching in Reducing Delayed Onset Muscle Soreness among Adults: A Systematic Review
_2024 · International Journal For Multidisciplinary Research_
DOI: `10.36948/ijfmr.2024.v06i06.31533`
> Stretching is typically done as part of a warm-up regimen before training or competition to improve muscle flexibility, and performance and prevent DOMS. Stretching techniques include static, ballistic and proprioceptive neuromuscular facilitation (PNF). Limited data supports the effectiveness of static and PNF stretching in reducing DOMS, despite its perceived ease and safety. Studies indicate stretching had an impa

**[8]** A prophylactic effect of proprioceptive neuromuscular facilitation (PNF) stretching on symptoms of muscle damage induced by eccentric exercise of the wrist extensors
_2010 · Journal Article · Journal of Bodywork and Movement Therapies_
DOI: `10.1016/j.jbmt.2010.07.006`
> Stretching with proprioceptive neuromuscular facilitation (PNF) is frequently used before exercise. The prophylactic effect of PNF on symptoms of muscle damage induced by eccentric exercise of the wrist extensors was examined in this study. Twenty-eight healthy males were randomly divided into the PNF group (n = 14) and the control group (n = 14). PNF was used before eccentric exercise induction in the wrist extensor

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 9. [mode_4_contradicted] Aerobic work, resistance training, and especially a combination can all help.

**Grading id:** `g9`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** how does exercise affect blood fats?

**Claim under audit:**

> Aerobic work, resistance training, and especially a combination can all help.

**Cited source ids:** 2, 7

**Retrieved sources:**

**[1]** The Influence of Exercise on the Concentrations of Triglyceride and Cholesterol in Human Plasma
_1984 · Review · Exercise and Sport Sciences Reviews_
DOI: `10.1249/00003677-198401000-00009`
> Exercise exerts both acute and chronic effects on plasma lipid and lipoprotein concentrations. Much of the triglyceride-lowering effect is an acute response, with the changes in cholesterol having a greater chronic component. The acute Tg decrease seems to be due to accelerated catabolism resulting from increased LPL activity. Following exercise, and on a more chronic basis, decreased VLDL-Tg synthesis may also occur

**[2] ◀ CITED** Responses of Blood Lipids to Aerobic, Resistance, and Combined Aerobic With Resistance Exercise Training: A Systematic Review of Current Evidence
_2009 · Angiology_
DOI: `10.1177/0003319708324927`
> This review considers the effectiveness of aerobic exercise training with different intensities (moderate and high) as well as the type of exercise (aerobic, resistance, and combined aerobic with resistance) in altering the blood lipids. We reviewed various trials via a systematic search of PubMed, published reviews, and references from original articles. We selected studies that involved aerobic and/or resistance an

**[3]** Exercise training for the management of dyslipidaemia. A position statement from Exercise and Sports Science Australia (ESSA).
_2026 · Journal Article, Review · Journal of science and medicine in sport_
DOI: `10.1016/j.jsams.2025.11.004`
> Total cholesterol (TC), high density lipoprotein (HDL-C), low density lipoprotein (LDL-C), triglycerides (TG) and very low density lipoprotein (VLDL-C) respond favourably to exercise training, but the effect sizes are moderate compared to lipid lowering medication (LLM). Apolipoproteins respond favourably to exercise training, but less evidence currently exists. A combination (CT) of aerobic (AT) and resistance (RT)

**[4]** Lipids, Lipoproteins, and Exercise
_2002 · Journal of Cardiopulmonary Rehabilitation_
DOI: `10.1097/00008483-200211000-00002`
> Dose-response relationships between exercise training volume and blood lipid changes suggest that exercise can favorably alter blood lipids at low training volumes, although the effects may not be observable until certain exercise thresholds are met.Plasma triglyceride reductions are often observed after exercise training regimens requiring energy expenditures similar to those characterized to increase high-density l

**[5]** The Effects of Exercise Training on the Traditional Lipid Profile and Beyond
_2016 · Journal Article · Translational Journal of the American College of Sports Medicine_
DOI: `10.1249/tjx.0000000000000023`
> ABSTRACT The purpose of this review is to provide up-to-date information regarding the effects of aerobic and resistance exercise training on the traditional blood lipid and lipoprotein profile. In addition, emerging coronary artery disease (CAD) risk factors, such as postprandial lipemia (PPL) and metabolic syndrome (MetS), are reviewed. Numerous studies report that aerobic exercise combined with weight loss signifi

**[6]** Impact of exercise on blood lipids and lipoproteins
_2007 · Journal Article · Journal of clinical lipidology_
DOI: `10.1016/j.jacl.2007.05.006`
> Abnormal blood lipids are a significant cardiovascular health risk. Drug therapy and diet continue to be standard management strategies. However, considerable evidence supports physical activity and exercise as having a positive impact on abnormal lipids and such are often recommended as adjunctive interventions. The purpose of this review is to clarify the mechanisms by which exercise facilitates favorable changes i

**[7] ◀ CITED** Effects of different exercise modalities on lipid profiles in overweight and obese children and adolescents: a systematic review and network meta-analysis of randomized controlled trials
_2026 · Research · BMC Sports Science, Medicine and Rehabilitation_
DOI: `10.1186/s13102-026-01544-9`
> The findings revealed differential effects of exercise modalities on lipid regulation. RT ranked highest for reducing total cholesterol (TC). AE was the only intervention that significantly increased high-density lipoprotein cholesterol (HDL-C). HIIT demonstrated the greatest efficacy in lowering low-density lipoprotein cholesterol (LDL-C) and triglycerides (TG). COM showed no superior effect for any single outcome a

**[8]** The effect of exercise on plasma high density lipoproteins.
_1979 · Lipids_
DOI: `10.1007/BF02533428`
> The influence of vigorous activity in man on plasma lipids and lipoproteins is reviewed, with particular emphasis on high density lipoproteins. Both cross sectional and longitudinal (or training) studies have been reported, many of them of less than ideal design. Nonetheless, a consistent pattern emerges in which increased exercise levels lead to lower plasma concentrations of triglycerides and very low density lipop

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 10. [mode_4_contradicted] For elite athletes, the literature is focused more on how to assess readiness and progress…

**Grading id:** `g10`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** best postpartum return timing female athletes?

**Claim under audit:**

> For elite athletes, the literature is focused more on how to assess readiness and progress back to training than on one universal postpartum week number.

**Cited source ids:** 1, 3

**Retrieved sources:**

**[1] ◀ CITED** Health Outcomes after Pregnancy in Elite Athletes: A Systematic Review and Meta-analysis.
_2021 · Medicine and science in sports and exercise_
DOI: `10.1249/MSS.0000000000002617`
> This study aimed to evaluate postpartum maternal health and training outcomes of females who were competing or training as elite athletes before or during pregnancy. Online databases were searched up to August 26, 2020. Studies of any design and language were eligible if they contained information on the relevant population (postpartum athletes [any period after pregnancy]), exposure (engaged in the highest level of

**[2]** Clinical and exercise professional opinion of return-to-running readiness after childbirth: an international Delphi study and consensus statement
_2023 · BMJ_
DOI: `10.1136/bjsports-2023-107489`
> Female athletes have identified a lack of guidance as a barrier to successfully returning to running postpartum, and existing guidelines are vague. Our aim was to define the current practice of determining postpartum run-readiness through a consensus survey of international clinicians and exercise professionals in postpartum exercise to assist clinicians and inform sport policy changes.A three-round Delphi approach w

**[3] ◀ CITED** Timing of Return to Pre-Pregnancy Training for Postpartum Elite Athletes: A Systematic Review and Meta-Analysis
_2024 · Exercise Science_
DOI: `10.15857/ksep.2024.00514`
> PURPOSE: Female athletes often face challenges in returning to exercise training programs after pregnancy and parturition. This study aimed to conduct a meta-analysis to investigate the optimal duration for elite female athletes to resume their pre-pregnancy training programs.METHODS: Nine studies were included in this meta-analysis with a total of 1,466 women, comprising 567 nonathletes and 899 athletes. The effect

**[4]** The "Mother Load" and Return to Sport: A Case Report of Returning to Professional Netball Following Cesarean Section.
_2023 · International journal of sports physical therapy_
DOI: `10.26603/001c.65894`
> Increasing numbers of elite female athletes are competing in professional sport, and many wish to become pregnant and return to competitive sport after childbirth. Athletes have a higher risk of pelvic floor dysfunction (PFD) than non-athletes (54% versus 7%) and there is also an increased prevalence in post-partum women compared to nulliparous women (35% versus 2.8-7.9%). Additionally, PFD has been shown to influenc

**[5]** Navigating the 'new normal': what guidelines exist for postpartum return to physical activity and sport? A scoping review.
_2023 · British journal of sports medicine_
DOI: `10.1136/bjsports-2023-107166`
> Women are often advised to return to activity (RTA) as early as 6 weeks postpartum, despite undergoing significant physical, physiological and psychological changes. Our objective was to examine existing evidence and clinical practice guidelines to navigate a safe and successful RTA or return to sport (RTS) postpartum. We searched CINAHL, Embase, Medline, PsycINFO and SPORTDiscus and included any secondary studies wi

**[6]** Exercise and pregnancy in recreational and elite athletes: 2016/17 evidence summary from the IOC Expert Group Meeting, Lausanne. Part 3—exercise in the postpartum period
_2017 · Review · British Journal of Sports Medicine_
DOI: `10.1136/bjsports-2017-097964`
> This is Part 3 in the series of reviews from the IOC expert committee on exercise and pregnancy in recreational and elite athletes. Part 1 focused on the effects of training during pregnancy and on the management of common pregnancy-related complaints experienced by athletes1; Part 2 addressed maternal and fetal perinatal outcomes.2 In this part, we review the implications of pregnancy and childbirth on return to exe

**[7]** Return to Running for Postpartum Elite and Subelite Athletes
_2024 · Sports Health: A Multidisciplinary Approach_
DOI: `10.1177/19417381241256973`
> Context: There is little evidence to guide elite athletes who desire returning to competition after giving birth to a child. Ultimately, this can result in decreased performance and increased risk of injury. This paper addresses aspects that must be considered when building and monitoring a return to running program for a postpartum elite or subelite athlete, including pelvic floor and core stability, progressive rel

**[8]** Clinical and exercise professional opinion on designing a postpartum return-to-running training programme: an international Delphi study and consensus statement.
_2024 · British journal of sports medicine_
DOI: `10.1136/bjsports-2023-107490`
> Returning to running postpartum presents challenges such as musculoskeletal pain and pelvic floor dysfunction for some females, but there is little guidance on developing and progressing postpartum training programmes. This study aims to establish expert consensus recommendations on designing and modifying a postpartum return-to-running training programme, highlight costs and access to qualified professionals as pote

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 11. [mode_4_contradicted] Intense training and low energy availability are linked to delayed menarche.

**Grading id:** `g11`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** hormone changes female athletes

**Claim under audit:**

> Intense training and low energy availability are linked to delayed menarche.

**Cited source ids:** 2, 4, 5, 6

**Retrieved sources:**

**[1]** Sex hormones and injury in female athletes
_2025 · International Journal of Bone Fragility_
DOI: `10.57582/ijbf.250503.100`
> Background: Sex hormones regulate musculoskeletal tissue properties, influencing bone and muscle health, and injury risk and recovery in female athletes. Hormonal fluctuations during the menstrual cycle, pregnancy, and menopause affect tissue homeostasis and injury susceptibility. Purpose: This narrative review synthesizes current evidence on the effects of oestrogens, androgens and progestogens on musculoskeletal he

**[2] ◀ CITED** The effects of intense exercise on the female reproductive system
_2001 · Journal of Endocrinology_
DOI: `10.1677/joe.0.1700003`
> Women have become increasingly physically active in recent decades. While exercise provides substantial health benefits, intensive exercise is also associated with a unique set of risks for the female athlete. Hypothalamic dysfunction associated with strenuous exercise, and the resulting disturbance of GnRH pulsatility, can result in delayed menarche and disruption of menstrual cyclicity. Specific mechanisms triggeri

**[3]** Reproductive hormones and menstrual changes with exercise in female athletes.
_1995 · Sports medicine (Auckland, N.Z.)_
DOI: `10.2165/00007256-199519040-00005`
> The endocrine equilibrium which regulates reproductive function in women can be affected by physical and psychological factors. Blood levels of hormones depend on a balance between production, metabolism and clearance rates. Intensive physical exercise may affect this balance via different mechanisms, such as stress associated with competition, dieting, reduction of body fat and body weight, production of heat or hyp

**[4] ◀ CITED** Exercise-induced endocrine pathologies
_2003 · Journal of Endocrinological Investigation_
DOI: `10.1007/bf03345238`
> There has been a substantial increase in women practicing sports over the past 30 yr. While exercise provides many health benefits, there appears to be a unique set of risks associated with intense exercise for the female athlete. The female athlete triad encompasses these risks, including amenorrhea, osteoporosis and eating disorders. The incidence of menstrual irregularities including primary and secondary amenorrh

**[5] ◀ CITED** Endocrine Disorders in Adolescent and Young Female Athletes: Impact on Growth, Menstrual Cycles, and Bone Mass Acquisition
_2014 · The Journal of Clinical Endocrinology &amp; Metabolism_
DOI: `10.1210/jc.2013-3030`
> Context: Puberty is a crucial period of dramatic hormonal changes, accelerated growth, attainment of reproductive capacity, and acquisition of peak bone mass. Participation in recreational physical activity is widely acknowledged to provide significant health benefits in this period. Conversely, intense training imposes several constraints, such as training stress and maintenance of very low body fat to maximize perf

**[6] ◀ CITED** Effects of exercise training on the menstrual cycle
_1990 · Medicine &amp; Science in Sports &amp; Exercise_
DOI: `10.1249/00005768-199006000-00001`
> This review evaluates the status of the evidence that exercise training affects the menstrual cycle beginning with evidence for the existence of delayed menarche, amenorrhea, and luteal suppression in athletes. A later age of menarche and a higher prevalence of amenorrhea and luteal suppression have been observed in athletes, but there is no experimental evidence that athletic training delays menarche, and alternativ

**[7]** The Impact of Intensive Physical Training on the Functioning of the Hypothalamic–Pituitary–Ovarian Axis in Female Athletes
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.54.70754`
> Background Intensive physical training plays a crucial role in improving physical fitness and athletic performance; however, in female athletes it may also disrupt hormonal balance, particularly within the hypothalamic–pituitary–ovarian (HPO) axis. These disturbances are often associated with low energy availability and may lead to significant reproductive and systemic health consequences. Aim The aim of this review

**[8]** [Intensive training and menstrual disorders in young female: Impact on bone mass].
_2016 · Gynecologie, obstetrique &amp; fertilite_
DOI: `10.1016/j.gyobfe.2016.09.001`
> Participation in recreational physical activity is widely acknowledged to provide significant health benefits. Conversely, intense training imposes several constraints, such as intermittent or chronic metabolic and psychogenic training stressors and maintenance of very low body fat to maximize performance. Adolescent and adult athletic women are therefore at risk of overtraining and/or poor dietary intake, which may

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 12. [mode_4_contradicted] Pelvic-floor training programs have started at 6 weeks postpartum.

**Grading id:** `g12`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** best timing for doing Kegel exercises

**Claim under audit:**

> Pelvic-floor training programs have started at 6 weeks postpartum.

**Cited source ids:** 1, 2

**Retrieved sources:**

**[1] ◀ CITED** Effect of postpartum pelvic floor muscle training on improving pelvic floor function
_2023 · Editorial Office of Journal of Shanghai Jiao Tong University (Medical Science)_
DOI: `10.3969/j.issn.1674-8115.2023.03.006`
> Objective·To evaluate the effect of pelvic floor muscle training (Kegel training) on the rehabilitation of pelvic floor function within 1 year after delivery.Methods·From January to April 2020, primiparas with different degrees of urinary incontinence or pelvic organ prolapse were selected and divided into exercise group (147 cases) and control group (194 cases). The exercise group received Kegel training at 6 weeks

**[2] ◀ CITED** Testing And Training Of The Pelvic Floor Muscles After Childbirth
_1989 · Acta Obstetricia et Gynecologica Scandinavica_
DOI: `10.3109/00016348909028662`
> In a prospective study of 83 women, two different physiotherapy methods for strengthening the pelvic floor muscles after childbirth were evaluated. The training program was carried out by the patients at home for 12 weeks, starting 8 weeks after spontaneous uneventful delivery. Forty‐two women did pelvic floor exercises in accordance with the method presented by Kegel (1). Forty‐one women used standard vaginal cones

**[3]** Evaluation of the effect of pelvic floor muscle training (PFMT or Kegel exercise) and assisted pelvic floor muscle training (APFMT) by a resistance device (Kegelmaster device) on the urinary incontinence in women “comparison between them: a
_2011 · European Journal of Obstetrics &amp; Gynecology and Reproductive Biology_
DOI: `10.1016/j.ejogrb.2011.06.037`
> Abstract Objective To evaluate the effect of pelvic floor muscle training (PFMT) or Kegel exercise with and without assistance by a resistance device (Kegelmaster device) on the urinary incontinence in women. Study design A randomized clinical trial was performed on 91 women with the complaint of urinary incontinence. In the assisted pelvic floor muscle training (APFMT) group ( n = 41), after complete training, Kegel

**[4]** Urinary Bladder Training Exercise and Quality of Pelvic Muscle Function Among Women With Incontinence: A Retrospective Study
_2025 · Nursing Forum_
DOI: `10.1155/nuf/7569118`
> In addition, well‐structured and regularly scheduled workshops are recommended to educate women on strengthening their pelvic muscles through daily Kegel exercises.

**[5]** Effect of Kegel Exercises on Pelvic Floor Muscle Disorders in Prenatal and Postnatal Women - A Literature Review
_2021 · Current Women s Health Reviews_
DOI: `10.2174/1573404816999200930161059`
> Background: Pelvic floor disorders affect many women globally. Objective: To provide a critical appraisal of the literature on the effects of pelvic floor disorders on the quality of life and functioning of pregnant and postnatal women. Methods: Available literature was reviewed and summarized to discuss the definitions, pelvic floor anatomy, dysfunctions, and the mechanism of the condition, and more specifically, on

**[6]** Does a Kegel Exercise Program Prior to Resistance Training Reduce the Risk of Stress Urinary Incontinence?
_2023 · Journal Article, Research Support, Non-U.S. Gov't · International journal of environmental research and public health_
DOI: `10.3390/ijerph20021481`
> This comparative pre-post intervention study investigated the feasibility and benefits of Kegel exercises amongst incontinent women, prior to commencing resistance training (RT), to reduce the risk of stress urinary incontinence (SUI) compared to a group of women without prior Kegel exercises (KE). Incontinence severity index (ISI) score, pelvic floor muscle strength (PFMS), and body composition (such as body mass in

**[7]** Sexually Induced Orgasm to Improve Postpartum Pelvic Floor Muscle Strength and Sexual Function in Primiparous Women After Vaginal Delivery: A Prospective Randomized Two-Arm Study.
_2022 · The journal of sexual medicine_
DOI: `10.1016/j.jsxm.2022.08.189`
> Postpartum pelvic floor dysfunction is known to affect the quality of life of women and the methods to treat it are more complex with majority requiring training under supervision. To compare the efficacy of sexually induced orgasm along with Kegels exercises versus Kegels exercises alone as a treatment method to enhance postpartum pelvic floor muscle strength and sexual function in primiparous women undergoing uncom

**[8]** Pelvic Floor Muscle Rehabilitation Using Biofeedback
_2014 · Urologic Nursing_
DOI: `10.7257/1053-816x.2014.34.4.193`
> Pelvic floor muscle exercises have been recommended for urinary incontinence since first described by obstetrician gynecologist Dr. Arnold Kegel more than six decades ago. These exercises are performed to strengthen pelvic floor muscles, provide urethral support to prevent urine leakage, and suppress urgency. In clinical urology practice, expert clinicians also teach patients how to relax the muscle to improve bladde

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 13. [mode_4_contradicted] Pelvic-floor training programs have started at 8 weeks after uneventful delivery.

**Grading id:** `g13`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** best timing for doing Kegel exercises

**Claim under audit:**

> Pelvic-floor training programs have started at 8 weeks after uneventful delivery.

**Cited source ids:** 1, 2

**Retrieved sources:**

**[1] ◀ CITED** Effect of postpartum pelvic floor muscle training on improving pelvic floor function
_2023 · Editorial Office of Journal of Shanghai Jiao Tong University (Medical Science)_
DOI: `10.3969/j.issn.1674-8115.2023.03.006`
> Objective·To evaluate the effect of pelvic floor muscle training (Kegel training) on the rehabilitation of pelvic floor function within 1 year after delivery.Methods·From January to April 2020, primiparas with different degrees of urinary incontinence or pelvic organ prolapse were selected and divided into exercise group (147 cases) and control group (194 cases). The exercise group received Kegel training at 6 weeks

**[2] ◀ CITED** Testing And Training Of The Pelvic Floor Muscles After Childbirth
_1989 · Acta Obstetricia et Gynecologica Scandinavica_
DOI: `10.3109/00016348909028662`
> In a prospective study of 83 women, two different physiotherapy methods for strengthening the pelvic floor muscles after childbirth were evaluated. The training program was carried out by the patients at home for 12 weeks, starting 8 weeks after spontaneous uneventful delivery. Forty‐two women did pelvic floor exercises in accordance with the method presented by Kegel (1). Forty‐one women used standard vaginal cones

**[3]** Evaluation of the effect of pelvic floor muscle training (PFMT or Kegel exercise) and assisted pelvic floor muscle training (APFMT) by a resistance device (Kegelmaster device) on the urinary incontinence in women “comparison between them: a
_2011 · European Journal of Obstetrics &amp; Gynecology and Reproductive Biology_
DOI: `10.1016/j.ejogrb.2011.06.037`
> Abstract Objective To evaluate the effect of pelvic floor muscle training (PFMT) or Kegel exercise with and without assistance by a resistance device (Kegelmaster device) on the urinary incontinence in women. Study design A randomized clinical trial was performed on 91 women with the complaint of urinary incontinence. In the assisted pelvic floor muscle training (APFMT) group ( n = 41), after complete training, Kegel

**[4]** Urinary Bladder Training Exercise and Quality of Pelvic Muscle Function Among Women With Incontinence: A Retrospective Study
_2025 · Nursing Forum_
DOI: `10.1155/nuf/7569118`
> In addition, well‐structured and regularly scheduled workshops are recommended to educate women on strengthening their pelvic muscles through daily Kegel exercises.

**[5]** Effect of Kegel Exercises on Pelvic Floor Muscle Disorders in Prenatal and Postnatal Women - A Literature Review
_2021 · Current Women s Health Reviews_
DOI: `10.2174/1573404816999200930161059`
> Background: Pelvic floor disorders affect many women globally. Objective: To provide a critical appraisal of the literature on the effects of pelvic floor disorders on the quality of life and functioning of pregnant and postnatal women. Methods: Available literature was reviewed and summarized to discuss the definitions, pelvic floor anatomy, dysfunctions, and the mechanism of the condition, and more specifically, on

**[6]** Does a Kegel Exercise Program Prior to Resistance Training Reduce the Risk of Stress Urinary Incontinence?
_2023 · Journal Article, Research Support, Non-U.S. Gov't · International journal of environmental research and public health_
DOI: `10.3390/ijerph20021481`
> This comparative pre-post intervention study investigated the feasibility and benefits of Kegel exercises amongst incontinent women, prior to commencing resistance training (RT), to reduce the risk of stress urinary incontinence (SUI) compared to a group of women without prior Kegel exercises (KE). Incontinence severity index (ISI) score, pelvic floor muscle strength (PFMS), and body composition (such as body mass in

**[7]** Sexually Induced Orgasm to Improve Postpartum Pelvic Floor Muscle Strength and Sexual Function in Primiparous Women After Vaginal Delivery: A Prospective Randomized Two-Arm Study.
_2022 · The journal of sexual medicine_
DOI: `10.1016/j.jsxm.2022.08.189`
> Postpartum pelvic floor dysfunction is known to affect the quality of life of women and the methods to treat it are more complex with majority requiring training under supervision. To compare the efficacy of sexually induced orgasm along with Kegels exercises versus Kegels exercises alone as a treatment method to enhance postpartum pelvic floor muscle strength and sexual function in primiparous women undergoing uncom

**[8]** Pelvic Floor Muscle Rehabilitation Using Biofeedback
_2014 · Urologic Nursing_
DOI: `10.7257/1053-816x.2014.34.4.193`
> Pelvic floor muscle exercises have been recommended for urinary incontinence since first described by obstetrician gynecologist Dr. Arnold Kegel more than six decades ago. These exercises are performed to strengthen pelvic floor muscles, provide urethral support to prevent urine leakage, and suppress urgency. In clinical urology practice, expert clinicians also teach patients how to relax the muscle to improve bladde

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 14. [mode_4_contradicted] Severe DOMS can adversely affect athletic performance in general.

**Grading id:** `g14`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** muscle soreness impact on endurance performance

**Claim under audit:**

> Severe DOMS can adversely affect athletic performance in general.

**Cited source ids:** 1, 6

**Retrieved sources:**

**[1] ◀ CITED** Causes of Delayed Onset Muscle Soreness and the Impact on Athletic Performance: A Review
_1992 · Review · The Journal of Strength and Conditioning Research_
DOI: `10.1519/1533-4287(1992)006<0135:codoms>2.3.co;2`
> Delayed onset muscle soreness (DOMS) generally occurs between 24 and 72 hours after a bout of unaccustomed exercise that involves eccentric muscle action. In this review, a variety of aerobic and anaerobic activities are described emphasizing the eccentric component. It is suggested that the experience of severe DOMS can adversely impact various aspects of performance. During endurance events there may be a decrease

**[2]** Mechanisms of exercise-induced delayed onset muscular soreness
_1984 · Medicine &amp; Science in Sports &amp; Exercise_
DOI: `10.1249/00005768-198412000-00002`
> Delayed-onset muscular soreness (DOMS), the sensation of pain and stiffness in the muscles that occurs from 1 to 5 d following unaccustomed exercise, can adversely affect muscular performance, both from voluntary reduction of effort and from inherent loss of capacity of the muscles to produce force. This reduction in performance is temporary; permanent impairment does not occur. A number of clinical correlates are as

**[3]** Delayed onset muscle soreness : treatment strategies and performance factors.
_2003 · Journal Article, Research Support, Non-U.S. Gov't, Review · Sports medicine (Auckland, N.Z.)_
DOI: `10.2165/00007256-200333020-00005`
> Delayed onset muscle soreness (DOMS) is a familiar experience for the elite or novice athlete. Symptoms can range from muscle tenderness to severe debilitating pain. The mechanisms, treatment strategies, and impact on athletic performance remain uncertain, despite the high incidence of DOMS. DOMS is most prevalent at the beginning of the sporting season when athletes are returning to training following a period of re

**[4]** Delayed Onset Muscle Soreness Intensity Affects Muscular Performance
_2021 · Salud UIS_
DOI: `10.18273/saluduis.53.e:21036`
> Background: The study of functional impact of delayed onset muscle soreness has been limited to describe the decline on maximal isometric contraction, but muscular work and time to peak torque has not been examined yet. Purpose: To describe the changes induced by a session of lengthening contractions on muscle performance and delayed onset muscle soreness (DOMS). Methods: A quasi-experimental study was conducted in t

**[5]** Application of Acoustic Radiation Force Impulse Elastography in Imaging of Delayed Onset Muscle Soreness: A Comparative Analysis With 3T MRI.
_2018 · Comparative Study, Journal Article · Journal of sport rehabilitation_
DOI: `10.1123/jsr.2017-0003`
> Delayed onset muscle soreness is one of the most common reasons for impaired muscle performance in sports and is associated with reduced muscle strength and frequently observed both in professional and recreational athletes.

**[6] ◀ CITED** Delayed onset muscle soreness does not alter O2 uptake kinetics during heavy-intensity cycling in humans.
_2007 · Journal Article · International journal of sports medicine_
DOI: `10.1055/s-2007-964840`
> The purpose of this study was to determine if exercise-induced delayed onset muscle soreness (DOMS) would alter O2 uptake kinetics during heavy cycling in 9 untrained females. O2 uptake kinetics were characterised during 8-min of constant-load cycling performed with and without DOMS. DOMS was caused by completing 30 min of bench-stepping at a rate of 15 steps.min(-1). Two days after bench stepping, all subjects repor

**[7]** The Effect of Muscle Strength on Marathon Race-Induced Muscle Soreness
_2021 · International Journal of Environmental Research and Public Health_
DOI: `10.3390/ijerph182111258`
> Background: Muscle soreness after a competition or a training session has been a concern of runners due to its harmful effect on performance. It is not known if stronger individuals present a lower level of muscle soreness after a strenuous physical effort. The aim of this study was to investigate whether the pre-race muscle strength or the V˙O2max level can predict muscle soreness 24, 48 and 72 h after a full marath

**[8]** Sensory, functional and electromyographic variables show different recovery patterns over a seven day period following exercise-induced pain in the hamstrings.
_2023 · Journal Article, Research Support, Non-U.S. Gov't · Clinical biomechanics (Bristol, Avon)_
DOI: `10.1016/j.clinbiomech.2023.106062`
> Delayed-onset muscle soreness (DOMS) is common after unaccustomed exercises and can restrict performance if intense physical activities are performed while the muscle is still sore. This study aimed to evaluate the recovery process following exercise-induced DOMS over a seven-day period by evaluating sensory, functional, and electromyographic parameters.

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 15. [mode_4_contradicted] Severe DOMS may reduce performance during endurance events.

**Grading id:** `g15`
**LLM judge verdict:** `mode_4_contradicted`

**Original chat question:** muscle soreness impact on endurance performance

**Claim under audit:**

> Severe DOMS may reduce performance during endurance events.

**Cited source ids:** 1, 6

**Retrieved sources:**

**[1] ◀ CITED** Causes of Delayed Onset Muscle Soreness and the Impact on Athletic Performance: A Review
_1992 · Review · The Journal of Strength and Conditioning Research_
DOI: `10.1519/1533-4287(1992)006<0135:codoms>2.3.co;2`
> Delayed onset muscle soreness (DOMS) generally occurs between 24 and 72 hours after a bout of unaccustomed exercise that involves eccentric muscle action. In this review, a variety of aerobic and anaerobic activities are described emphasizing the eccentric component. It is suggested that the experience of severe DOMS can adversely impact various aspects of performance. During endurance events there may be a decrease

**[2]** Mechanisms of exercise-induced delayed onset muscular soreness
_1984 · Medicine &amp; Science in Sports &amp; Exercise_
DOI: `10.1249/00005768-198412000-00002`
> Delayed-onset muscular soreness (DOMS), the sensation of pain and stiffness in the muscles that occurs from 1 to 5 d following unaccustomed exercise, can adversely affect muscular performance, both from voluntary reduction of effort and from inherent loss of capacity of the muscles to produce force. This reduction in performance is temporary; permanent impairment does not occur. A number of clinical correlates are as

**[3]** Delayed onset muscle soreness : treatment strategies and performance factors.
_2003 · Journal Article, Research Support, Non-U.S. Gov't, Review · Sports medicine (Auckland, N.Z.)_
DOI: `10.2165/00007256-200333020-00005`
> Delayed onset muscle soreness (DOMS) is a familiar experience for the elite or novice athlete. Symptoms can range from muscle tenderness to severe debilitating pain. The mechanisms, treatment strategies, and impact on athletic performance remain uncertain, despite the high incidence of DOMS. DOMS is most prevalent at the beginning of the sporting season when athletes are returning to training following a period of re

**[4]** Delayed Onset Muscle Soreness Intensity Affects Muscular Performance
_2021 · Salud UIS_
DOI: `10.18273/saluduis.53.e:21036`
> Background: The study of functional impact of delayed onset muscle soreness has been limited to describe the decline on maximal isometric contraction, but muscular work and time to peak torque has not been examined yet. Purpose: To describe the changes induced by a session of lengthening contractions on muscle performance and delayed onset muscle soreness (DOMS). Methods: A quasi-experimental study was conducted in t

**[5]** Application of Acoustic Radiation Force Impulse Elastography in Imaging of Delayed Onset Muscle Soreness: A Comparative Analysis With 3T MRI.
_2018 · Comparative Study, Journal Article · Journal of sport rehabilitation_
DOI: `10.1123/jsr.2017-0003`
> Delayed onset muscle soreness is one of the most common reasons for impaired muscle performance in sports and is associated with reduced muscle strength and frequently observed both in professional and recreational athletes.

**[6] ◀ CITED** Delayed onset muscle soreness does not alter O2 uptake kinetics during heavy-intensity cycling in humans.
_2007 · Journal Article · International journal of sports medicine_
DOI: `10.1055/s-2007-964840`
> The purpose of this study was to determine if exercise-induced delayed onset muscle soreness (DOMS) would alter O2 uptake kinetics during heavy cycling in 9 untrained females. O2 uptake kinetics were characterised during 8-min of constant-load cycling performed with and without DOMS. DOMS was caused by completing 30 min of bench-stepping at a rate of 15 steps.min(-1). Two days after bench stepping, all subjects repor

**[7]** The Effect of Muscle Strength on Marathon Race-Induced Muscle Soreness
_2021 · International Journal of Environmental Research and Public Health_
DOI: `10.3390/ijerph182111258`
> Background: Muscle soreness after a competition or a training session has been a concern of runners due to its harmful effect on performance. It is not known if stronger individuals present a lower level of muscle soreness after a strenuous physical effort. The aim of this study was to investigate whether the pre-race muscle strength or the V˙O2max level can predict muscle soreness 24, 48 and 72 h after a full marath

**[8]** Sensory, functional and electromyographic variables show different recovery patterns over a seven day period following exercise-induced pain in the hamstrings.
_2023 · Journal Article, Research Support, Non-U.S. Gov't · Clinical biomechanics (Bristol, Avon)_
DOI: `10.1016/j.clinbiomech.2023.106062`
> Delayed-onset muscle soreness (DOMS) is common after unaccustomed exercises and can restrict performance if intense physical activities are performed while the muscle is still sore. This study aimed to evaluate the recovery process following exercise-induced DOMS over a seven-day period by evaluating sensory, functional, and electromyographic parameters.

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

# mode_1 control (LLM-flagged misattribution)

## 16. [mode_1_misattribution] Some newer systems combine eye-tracking and EEG for concussion screening.

**Grading id:** `g16`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** can fitness trackers detect brain injuries?

**Claim under audit:**

> Some newer systems combine eye-tracking and EEG for concussion screening.

**Cited source ids:** 3, 5

**Retrieved sources:**

**[1]** Exploring the use of wearables in the management of mild traumatic brain injury
> a) Why is the subject of your thesis important? Every year more than 1 million people attend Accident and Emergency with mild traumatic brain injuries (mTBI), many of which arise from Sports Related Concussion (SRC). Despite the high incidence of such injuries, there is still no gold standard method to monitor the wide variety of impairments (cognitive, visual, motor symptom) accompanying mTBI. Accordingly, there is

**[2]** Secure and Connected Telehealth Approach to Mitigating Concussion Risks in Student Athletes
_2016 · 2016 25th International Conference on Computer Communication and Networks (ICCCN)_
DOI: `10.1109/icccn.2016.7568570`
> This research vision and challenges paper focuses on microprocessor design and activity-recognition data processing for medical devices in student-athlete health care. Sports are the second leading cause of mild traumatic brain injury (mTBI) for people aged between 15 and 24 years. Significant work has been done in the use of sensors to determine the linear and rotational acceleration of head impacts, and their poten

**[3] ◀ CITED** Automatic sleeping time estimation and mild traumatic brain injury (mTBI) detection using actigraphy data
_2021 · Biomedical Signal Processing and Control_
DOI: `10.1016/j.bspc.2021.102430`
> Abstract Sleep schedule and circadian phase irregularity are associated with some health problems and diseases, e.g., narcolepsy, circadian disorder, and concussion. Actigraphy has been widely used in the study of sleep and circadian rhythms. This paper presents a method for estimating the sleep/wake state based on the minute-by-minute actigraphy data measured by wrist actigraphy and its associated scoring software.

**[4]** An Evaluation of the Emerging Techniques in Sports-Related Concussion.
_2023 · Review, Journal Article · Journal of clinical neurophysiology : official publication of the American Electroencephalographic Society_
DOI: `10.1097/WNP.0000000000000879`
> Sports-related concussion is now in public awareness more than ever before. Investigations into underlying pathophysiology and methods of assessment have correspondingly increased at an exponential rate. In this review, we aim to highlight some of the evidence supporting emerging techniques in the fields of neurophysiology, neuroimaging, vestibular, oculomotor, autonomics, head sensor, and accelerometer technology in

**[5] ◀ CITED** SynTec: A Low-Cost Eye-Tracking and EEG-Based Diagnostic System for Concussion Assessment in Sports
_2025 · AHFE International_
DOI: `10.54941/ahfe1006475`
> Concussions are a common form of mild traumatic brain injury (mTBI), particularly among athletes in high-impact sports. Existing diagnostic tools such as SCAT, VOMS, and EEG are limited by cost, subjectivity, or complexity. This paper presents SynTec, a novel wearable system that integrates eye-tracking and EEG technologies to support concussion screening in a compact, affordable format. A user-centered design proces

**[6]** Wireless health monitoring helmet for football players to diagnose concussion and track fatigue
_2013 · SPIE Proceedings_
DOI: `10.1117/12.2009719`
> Football players are regularly exposed to violent impacts. Concussions are mild traumatic brain injuries that are one of the most common injuries experienced by football players. These concussions are often overlooked by football players themselves and the clinical criteria used to diagnose them. The cumulative effect of these mild traumatic brain injuries can cause long-term residual brain dysfunctions. In addition,

**[7]** (Plenary) Wearable Wireless Textile Based Nanosensor System for Early Detection of Concussion and Cardiac Arrest of Football Players
_2015 · ECS Meeting Abstracts_
DOI: `10.1149/ma2015-01/40/2105`
> The prevalence of head injury and its subsequent effects among football players has been a persistent problem at all levels of the game. Research work over the past few decades has brought heightened awareness about the causes and long-term effects of severe or traumatic head injuries (TBI) and repeated concussions. The NFL and NCAA have implemented policies for prevention and protocols for diagnosis and treatment. A

**[8]** Wearable nanosensor system for monitoring mild traumatic brain injuries in football players
_2016 · SPIE Proceedings_
DOI: `10.1117/12.2219516`
> Football players are more to violent impacts and injuries more than any athlete in any other sport. Concussion or mild traumatic brain injuries were one of the lesser known sports injuries until the last decade. With the advent of modern technologies in medical and engineering disciplines, people are now more aware of concussion detection and prevention. These concussions are often overlooked by football players them

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 17. [mode_1_misattribution] Hypoestrogenism has bone consequences.

**Grading id:** `g17`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** hormonal influences on bone density in female athletes

**Claim under audit:**

> Hypoestrogenism has bone consequences.

**Cited source ids:** 2, 3, 8

**Retrieved sources:**

**[1]** Sex Hormones, Bone Mineral Density and Bone Biomarkers in Female Collegiate Athletes with Different Menstrual Status
_2017 · Journal Article · Sports & Exercise Research_
DOI: `10.5297/ser.1902.006`
> The purpose of this study was to investigate the differences and correlations of sex hormones, bone mineral density and bone biomarkers in female collegiate athletes with menstrual irregularities and eumenorrhea. Division I collegiate female athletes from 18 types of sports were recruited into this study. A questionnaire survey was used to select the female athletes with menstrual irregularities and considered them a

**[2] ◀ CITED** CrossRef Listing of Deleted DOIs
_2007 · Journal Article · CrossRef Listing of Deleted DOIs_
DOI: `10.1007/s11932-005-0029-1`
> The etiology of amenorrhea in exercising women is linked to a mismatch between caloric intake and high levels of exercise energy expenditure that results in a chronic energy deficit. This in turn stimulates compensatory mechanisms such as weight loss, metabolic hormone alterations, or energy conservation that subsequently causes a central suppression of reproductive function and concomitant hypoestrogenism. This supp

**[3] ◀ CITED** Beyond Hypoestrogenism in Amenorrheic Athletes
_2005 · Journal Article · Current Sports Medicine Reports_
DOI: `10.1097/01.csmr.0000306070.67390.cb`
> The etiology of amenorrhea in exercising women is linked to a mismatch between caloric intake and high levels of exercise energy expenditure that results in a chronic energy deficit. This in turn stimulates compensatory mechanisms such as weight loss, metabolic hormone alterations, or energy conservation that subsequently causes a central suppression of reproductive function and concomitant hypoestrogenism. This supp

**[4]** Influence of ghrelin and adipocytokines on bone mineral density in adolescent female athletes with amenorrhea and eumenorrheic athletes.
_2010 · Journal Article, Research Support, N.I.H., Extramural, Review · Medicine and sport science_
DOI: `10.1159/000321975`
> Adolescent female athletes are at increased risk for low bone mineral density (BMD) secondary to exercise-induced hypogonadism. Of particular concern is that the adolescent years are also a critical time for bone accrual, and deficits incurred during this period could lead to suboptimal peak bone mass acquisition and subsequent fracture risk in later life. Although weight-bearing exercise is typically associated with

**[5]** Serum Brain-derived Neurotrophic Factor Levels Mirror Bone Mineral Density in Amenorrheic and Eumenorrheic Athletes
_2019 · International Journal of Sports Medicine_
DOI: `10.1055/a-0835-6119`
> Abstract Amenorrhea and osteoporosis are strongly associated in female athletes. Amenorrheic women show lower serum levels of brain-derived neurotrophic factor (BDNF) than eumenorrheic women. BDNF is known to regulate bone tissue development and remodeling; thus, athletes with low serum BDNF levels may show low bone mass. This study investigated the associations between serum BDNF, estradiol, and bone mineral density

**[6]** 2014 Female Athlete Triad Coalition Consensus Statement on Treatment and Return to Play of the Female Athlete Triad: 1st International Conference held in San Francisco, California, May 2012 and 2nd International Conference held in Indianapo
_2014 · British Journal of Sports Medicine_
DOI: `10.1136/bjsports-2013-093218`
> The major gonadal steroids include oestrogen, progesterone and testosterone, all of which are low in the amenorrhoeic athlete. Oestrogen replacement: Overall, investigators have shown that oral oestrogen-progesterone combination pills are not an effective strategy to increase BMD in low-weight conditions such as anorexia nervosa (in adults and adolescents). Studies of COCs or hormone therapy in athletes with FHA are

**[7]** The IOC consensus statement: beyond the Female Athlete Triad—Relative Energy Deficiency in Sport (RED-S)
_2014 · British Journal of Sports Medicine_
DOI: `10.1136/bjsports-2014-093502`
> In collegiate athletes, weight gain is the strongest predictor of recovery of normal menstrual function. Adequate protein and carbohydrate intake is recommended to restore liver glycogen to facilitate LH pulsatility. The time frame for the resumption of menses varies according to the severity of the energy deficiency and the duration of the menstrual dysfunction. Although oral contraceptives (OCs) may be considered f

**[8] ◀ CITED** Altered Hypothalamic-Pituitary-Ovarian Axis Function in Young Female Athletes
_2005 · Treatments in Endocrinology_
DOI: `10.2165/00024677-200504030-00003`
> Young women have become increasingly active in athletics during the 20th century. Those involved in sports that emphasize lean body type are at high risk for the development of menstrual dysfunction, including amenorrhea. This is mediated by an alteration in function of the hypothalamic-pituitary-ovarian (HPO) axis, with loss of normal secretion of luteinizing hormone, and subsequent lack of estrogen production. Disr

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 18. [mode_1_misattribution] Resistance training is associated with muscle remodeling and hypertrophy effects on insuli…

**Grading id:** `g18`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** resistance training benefits metabolic syndrome

**Claim under audit:**

> Resistance training is associated with muscle remodeling and hypertrophy effects on insulin resistance.

**Cited source ids:** 6

**Retrieved sources:**

**[1]** Is it the resistance training itself or the combined associated weight loss that improves the metabolic syndrome-related phenotypes in postmenopausal women?
_Clinical Interventions in Aging_
DOI: `10.2147/cia.s95156`
> Dear editor We read the article entitled “Resistance training improves isokinetic strength and metabolic syndrome-related phenotypes in postmenopausal women” by Oliveira et al1 with great interest. In the study, the authors examined the effects of 12 weeks of resistance training (RT) on metabolic syndrome-related phenotypes in postmenopausal women. They reported that total cholesterol, low-density lipoprotein cholest

**[2]** Resistance Training is Medicine: Focusing on the Positive Impact on Metabolic Syndrome Risk Factors
_2025 · The Asian Journal of Kinesiology_
DOI: `10.15758/ajk.2025.27.2.36`
> OBJECTIVES This review aims to synthesize recent domestic and international research on the effects of resistance exercise on metabolic syndrome risk factors.METHODSA systematic search was conducted using Web of Science, Scopus, PubMed/Medline, and Embase to identify relevant studies published between January 2000 and February 2025. Studies evaluating the effects of resistance exercise on metabolic syndrome risk fact

**[3]** Resistance exercise training and its impact on metabolic syndrome in type 2 diabetes: A systematic review and meta-analysis of randomized controlled trials
_2025 · Diabetes Research and Clinical Practice_
DOI: `10.1016/j.diabres.2025.112077`
> This meta-analysis investigated the impact of resistance exercise training (RET) on metabolic syndrome (MetS) markers in patients with type 2 diabetes mellitus (T2DM) by synthesizing evidence from randomized controlled trials (RCTs). A systematic search was conducted in four databases up to September 2024. Data were analyzed using random-effects models to calculate mean differences (MD) and 95 % confidence intervals

**[4]** Resistance Training in the Treatment of the Metabolic Syndrome
_2010 · Review · Sports Medicine_
DOI: `10.2165/11531380-000000000-00000`
> Over the last decade, investigators have given increased attention to the effects of resistance training (RT) on several metabolic syndrome variables. The metabolic consequences of reduced muscle mass, as a result of normal aging or decreased physical activity, lead to a high prevalence of metabolic disorders. The purpose of this review is: (i) to perform a meta-analysis of randomized controlled trials (RCTs) regardi

**[5]** Comparison of two different resistance training intensities on metabolic syndrome risk factors in obese women
_2019 · International Journal of Applied Exercise Physiology_
DOI: `10.30472/ijaep.v8i1.341`
> The prevalence of obesity and metabolic syndrome has been increasing worldwide. An effective solution to manage and prevent these syndromes is essential. Evidence shows that one of the single most important lifestyle changes for the prevention of many chronic diseases is exercise training. Previous studies have compared different aerobic training intensities in people with metabolic syndrome, but little is known abou

**[6] ◀ CITED** Effect of blood flow restriction training on insulin resistance in men with metabolic syndrome: a randomized controlled trial
_2024 · Bulletin of Rehabilitation Medicine_
DOI: `10.38025/2078-1962-2024-23-5-11-21`
> Changes in body composition, an increase in the proportion of muscle fibers I and IIa and a decrease in the proportion of muscle fibers IIx, an increase in the activity of glucose transporters, and a decrease in systemic inflammation are the main potential mechanisms for the beneficial effects of resistance training, including in combination with blood flow restriction, on insulin resistance in men with metabolic syn

**[7]** Impaired Muscle AMPK Activation in the Metabolic Syndrome May Attenuate Improved Insulin Action after Exercise Training
_2011 · The Journal of Clinical Endocrinology &amp; Metabolism_
DOI: `10.1210/jc.2010-2532`
> Strength training induces muscle remodeling and may improve insulin responsiveness.This study will quantify the impact of resistance training on insulin sensitivity in subjects with the metabolic syndrome and correlate this with activation of intramuscular pathways mediating mitochondrial biogenesis and muscle fiber hypertrophy.Ten subjects with the metabolic syndrome (MS) and nine sedentary controls underwent 8 wk o

**[8]** Twenty-four weeks of combined exercise training prevents metabolic syndrome progression in adult women: evidence from a randomized controlled trial
_2026 · Biology of Sport_
DOI: `10.5114/biolsport.2026.153313`
> The optimal sample size for this study was determined using the G*Power program. Based on the methodology outlined by Santoro American Heart Association recommend that adults engage in at least 150 minutes of moderate or 75 minutes of vigorous aerobic exercise weekly to maintain overall health . Resistance training has been shown to enhance glucose consumption by stimulating muscle hypertrophy and shifting muscle fib

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 19. [mode_1_misattribution] Elite athletes report inadequate support and resources during pregnancy and postpartum.

**Grading id:** `g19`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** What are elite athletes' experiences with pregnancy?

**Claim under audit:**

> Elite athletes report inadequate support and resources during pregnancy and postpartum.

**Cited source ids:** 2, 3, 5, 6, 7

**Retrieved sources:**

**[1]** Exploring the postpartum return to sport and performance in Canadian elite athletes.
_2025 · Frontiers in sports and active living_
DOI: `10.3389/fspor.2025.1665212`
> Athlete-mothers in elite sport were viewed as anomalies until very recently. Perhaps as a consequence of limited research, support and resources available for pregnant and postpartum athletes may be inadequate. To explore the experiences of athletes returning to sport and performance postpartum. Ten elite Canadian athletes who became pregnant during their sporting career and attempted to return to competitive sport a

**[2] ◀ CITED** Pregnancy in Spanish elite sportswomen: A qualitative study
_2016 · Journal Article · Women & Health_
DOI: `10.1080/03630242.2016.1202883`
> Pregnancy and motherhood have been historically considered as reasons why elite sportswomen may end their sport careers. During pregnancy, the safety of both mother and baby has been identified as a key reason for ceasing sport participation. Recent "official" statistics on how many elite athletes are mothers suggest that pregnancy, motherhood, and sport could be no longer mutually exclusive. The aim of this qualitat

**[3] ◀ CITED** Exploring pregnancy and postpartum experiences among geographically diverse elite athletes: A qualitative study.
_2025 · Journal of science and medicine in sport_
DOI: `10.1016/j.jsams.2024.10.001`
> Female athletes who experience childbirth during their athletic careers can expect to return to elite sports postpartum and perform at a comparable or improved level. However, mothering athletes often encounter significant barriers when re-entering elite sports. The aim of this study was to explore the experiences of a geographically diverse group of mothering athletes who returned to elite sports after childbirth. Q

**[4]** Pregnancy in endurance athletes
_1997 · Scandinavian Journal of Medicine & Science in Sports_
DOI: `10.1111/j.1600-0838.1997.tb00144.x`
> The purpose of the present study was to examine pregnancy and delivery among Finnish endurance athletes at the national top level. A questionnaire concerning first pregnancy was sent to 30 Finnish endurance athletes who had been at national top level in cross-country skiing, running, speed-skating or orienteering. Data on labour were collected retrospectively through a questionnaire and from the diaries in the hospit

**[5] ◀ CITED** Elite and Sub-elite Athletes and Pregnancy: Training, Performance, Health and Psychological Aspects Across the Pre-, Peri-, and Postnatal Stages: A Scoping Review.
_2026 · Journal Article, Review · Sports medicine - open_
DOI: `10.1186/s40798-026-01000-5`
> Of the 5236 records examined, 101 studies met the inclusion criteria and 46 original research articles underwent detailed data extraction. Elite and sub-elite athletes often plan their pregnancies very carefully. The available evidence does not clearly demonstrate negative effects of high training loads on pregnancy outcomes. However, the limited, often outdated, and predominantly endurance-focused data do not allow

**[6] ◀ CITED** Elite Female Distance Runners and Advice During Pregnancy: Sources, Content, and Trust
_2016 · Women in Sport and Physical Activity Journal_
DOI: `10.1123/wspaj.2015-0040`
> More elite female distance runners are opting to have children during their athletic careers. Despite this, there is a dearth of information regarding pregnancy and physical activity for elite level athletes. Further, current pregnancy physical activity guidelines are not relevant for this population`s needs. Two research questions frame this study: are elite female distance runners’ pregnancy informational needs bei

**[7] ◀ CITED** Pregnancy, Parenthood, and Elite Athletics: “There’s a Lot of Work Still Yet To Be Done”
_2024 · Sociology of Sport Journal_
DOI: `10.1123/ssj.2022-0162`
> Several female athletes have recently challenged the long-standing assumption that pregnancy/parenthood (particularly motherhood) and participation in elite-level sport are mutually exclusive. These women’s actions have elicited change across the elite athletics industry and have sparked a need for further research to understand how elite athlete-parents perceive these shifts. We used feminist poststructuralist theor

**[8]** Do elite athletes experience low back, pelvic girdle and pelvic floor complaints during and after pregnancy?
_2007 · Scandinavian journal of medicine &amp; science in sports_
DOI: `10.1111/j.1600-0838.2006.00599.x`
> The aim of the present investigation was to study prevalence of low back pain, pelvic girdle pain (PGP) and pelvic floor disorders during pregnancy and after childbirth in elite athletes. A postal questionnaire was sent to all elite athletes who had given birth registered with The Norwegian Olympic Committee and Confederation of Sports (n=40). Eighty age-matched women served as the control group. The response rates w

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 20. [mode_1_misattribution] Qualitative studies report that mothering athletes can face the challenge of balancing eli…

**Grading id:** `g20`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** What challenges do professional athletes face after having children?

**Claim under audit:**

> Qualitative studies report that mothering athletes can face the challenge of balancing elite training with newborn care and family responsibilities.

**Cited source ids:** 4, 6

**Retrieved sources:**

**[1]** We're not Superhuman, We're Human: A Qualitative Description of Elite Athletes' Experiences of Return to Sport After Childbirth.
_2023 · Sports medicine (Auckland, N.Z.)_
DOI: `10.1007/s40279-022-01730-y`
> A growing number of athletes return to elite sport following childbirth. Yet, they face significant barriers to do so safely and successfully. The experiences of elite athletes returning to sport following delivery are necessary to support evidence-informed policy. The purpose of this qualitative description was to describe the experiences of elite athletes as they returned to sport following childbirth, and to ident

**[2]** Exploring pregnancy and postpartum experiences among geographically diverse elite athletes: A qualitative study.
_2025 · Journal of science and medicine in sport_
DOI: `10.1016/j.jsams.2024.10.001`
> Female athletes who experience childbirth during their athletic careers can expect to return to elite sports postpartum and perform at a comparable or improved level. However, mothering athletes often encounter significant barriers when re-entering elite sports. The aim of this study was to explore the experiences of a geographically diverse group of mothering athletes who returned to elite sports after childbirth. Q

**[3]** Returning to sport after pregnancy: A qualitative study of elite female athletes in the UK.
_2025 · Journal of science and medicine in sport_
DOI: `10.1016/j.jsams.2025.11.009`
> Elite athletes are more commonly returning to sport after pregnancy. Whilst research and policies to support athletes after pregnancy are increasing, understanding the lived experiences of United Kingdom (UK) elite athletes as they return to sport remains limited. This study aimed to examine the experiences and perspectives of UK elite athletes from a range of sports on the postpartum period and the return to sport.

**[4] ◀ CITED** Experiences and perspectives on pregnancy and motherhood in elite athletes - a qualitative study.
_2025 · Sexual and reproductive health matters_
DOI: `10.1080/26410397.2025.2501832`
> Elite athletes routinely undertake strenuous training routines, which often involve high-intensity sessions. However, there are knowledge gaps in how they experience training during pregnancy and subsequent return to sport. Combined with inadequate financial and contractual safety, female athletes may jeopardise their careers when starting families. This study aimed to describe female athletes' experiences and perspe

**[5]** Recommendations for postpartum athletes returning to sport: the past, present, and future.
_2024 · The Physician and sportsmedicine_
DOI: `10.1080/00913847.2024.2385886`
> There is a growing percentage of elite female athletes who choose to start a family during their athletic careers. Current guidelines to manage postpartum elite athletes returning to sport are weakly rooted in athlete-centered evidence and/or are restricted by small sample sizes. The purpose of this review was to collect and compare existing protocols and guidelines for elite athletes returning to sport following chi

**[6] ◀ CITED** Exploring the postpartum return to sport and performance in Canadian elite athletes
_2025 · Frontiers in Sports and Active Living_
DOI: `10.3389/fspor.2025.1665212`
> BackgroundAthlete-mothers in elite sport were viewed as anomalies until very recently. Perhaps as a consequence of limited research, support and resources available for pregnant and postpartum athletes may be inadequate.ObjectiveTo explore the experiences of athletes returning to sport and performance postpartum.MethodsTen elite Canadian athletes who became pregnant during their sporting career and attempted to retur

**[7]** Returning to sport after pregnancy: A qualitative study of elite female athletes in the UK
_2024 · Journal of Science and Medicine in Sport_
DOI: `10.21203/rs.3.rs-4318196/v1`
> Abstract Background: Returning to sport postpartum is becoming increasingly common for elite athletes. While policies to support women during this period are emerging, this remains an area of limited research. To date the lived postpartum experience of UK elite athletes as they returned to sport has not been explored. Methods: This qualitative study collated the experiences of 11 women via online interviews. Data was

**[8]** Return to Running for Postpartum Elite and Subelite Athletes.
_2025 · Journal Article, Review · Sports health_
DOI: `10.1177/19417381241256973`
> There is little evidence to guide elite athletes who desire returning to competition after giving birth to a child. Ultimately, this can result in decreased performance and increased risk of injury. This paper addresses aspects that must be considered when building and monitoring a return to running program for a postpartum elite or subelite athlete, including pelvic floor and core stability, progressive reloading of

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 21. [mode_1_misattribution] Designing PE content that is more inclusive and autonomy-supportive is a lever for increas…

**Grading id:** `g21`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** student-centered physical education engagement

**Claim under audit:**

> Designing PE content that is more inclusive and autonomy-supportive is a lever for increasing participation, autonomy, and motivation.

**Cited source ids:** 1, 2, 3, 5, 6

**Retrieved sources:**

**[1] ◀ CITED** Improving university students’ engagement in physical education through differentiated instruction and motivational strategies
_2025 · Journal Article · International Journal of Innovative Research and Scientific Studies_
DOI: `10.53894/ijirss.v8i3.7543`
> This study aims to enhance university students’ engagement in physical education (PE) by applying a set of differentiated instructional strategies and motivational interventions. Declining levels of student participation in PE present a significant challenge in higher education institutions, necessitating pedagogically sound solutions. A quasi-experimental study was conducted at M.Kh. Dulaty Taraz University with 473

**[2] ◀ CITED** Student Voice: Student Choice and Participation in Physical Education
_2014 · Journal Article · Strategies_
DOI: `10.1080/08924562.2014.938875`
> Secondary students frequently disengage from participating in physical education and physical activity. The Centers for Disease Control and Prevention (CDC) recommends 60 minutes of vigorous aerobic activity per day, as well as muscle and bone strengthening activities on three or more days a week for children (CDC, n.d.). Physical education may be the only opportunity for school-age children to participate in physica

**[3] ◀ CITED** Developing Physical Literacy and Self-Efficacy: Supporting Student Autonomy in High School Physical Education Through Assessment
_2024 · Journal Article · VIUSpace (Vancouver Island University Library)_
DOI: `10.25316/ir-19259`
> This study addresses concerns surrounding the decline in engagement in optional physical education programs. To enhance student engagement, the study aimed to align physical education courses with principles of self-determination theory, focusing on the role of competence in supporting autonomy. The intervention involved the assessment of competence through various fitness tests. Particular instruments, such as the V

**[4]** PHYSICAL EDUCATION AND PERSONALIZED LEARNING IN LINE WITH EUROPEAN UNION AND NATIONAL STANDARDS
_2025 · Journal Article · Education and new developments_
DOI: `10.36315/2025v1end120`
> Physical education represents a central discipline for promoting the psychophysical well-being of adolescents, in a context characterized by a growing incidence of sedentary lifestyles.This trend, associated with a reduction in regular physical activity, has negative effects on the physical, emotional, and social development of students, making targeted educational intervention urgent (Shao T. & Zhou X., 2023).Howeve

**[5] ◀ CITED** Active Exploration in Physical Education: Strategies for Including Marginalized Students
_2023 · Journal Article · Journal of Physical Education Recreation & Dance_
DOI: `10.1080/07303084.2022.2156942`
> Physical educators face many daily challenges in their work. Delivering culturally responsive programming that speaks to all students regardless of race, religion, nationality, gender, and motor abilities (Kozub & Hodge, 2014) is one of these challenges. Teachers who build a meaningful physical educational environment with skilled activities can create a motivating and valuable experience for marginalized students re

**[6] ◀ CITED** Enhancing Student Engagement and Learning Outcomes in Higher Education Physical Education: The Role of Student-Centered Approach
_2024 · Journal Article · Journal of medicine and physical education._
DOI: `10.62517/jmpe.202418209`
> Student participation and learning outcomes in higher education physical education teaching are important concerns in education reform and development. The purpose of this study is to explore the role of student-centered approach in enhancing student participation and learning outcomes in higher education physical education. Through literature review and reference analysis, it is found that student-centered method ca

**[7]** The Effects of Choice on Autonomous Motivation, Perceived Autonomy Support, and Physical Activity Levels in High School Physical Education
_2013 · Journal Article · Journal of Teaching in Physical Education_
DOI: `10.1123/jtpe.32.2.131`
> This study examined whether the provision of choice in physical education (PE) enhanced students’ autonomous motivation, perceived autonomy support, and physical activity (PA) levels, relative to a “regular PE” control group. Students from eight intact high school PE classes ( N = 257, M age = 12.91) were randomly assigned to control (i.e., four classes) and intervention (i.e., four classes) conditions. Students in t

**[8]** Physical Education Lesson Content and Teacher Style and Elementary Students’ Motivation and Physical Activity Levels
_2013 · Journal Article · Journal of Teaching in Physical Education_
DOI: `10.1123/jtpe.32.3.321`
> Obesity levels among American children are increasing at an alarming rate, due in part to a lack of regular physical activity (PA). Physical education (PE) is one way to facilitate student PA. The overarching PA goal for physical educators is 50% PA for students. Self-determination theory suggests that PA levels in PE and a variety of other contexts depend upon individuals’ motivation levels. The purpose of this stud

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 22. [mode_1_misattribution] Strike pattern can shift calf-related loading.

**Grading id:** `g22`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** how does running form differ in female runners with calf pain?

**Claim under audit:**

> Strike pattern can shift calf-related loading.

**Cited source ids:** 6, 7

**Retrieved sources:**

**[1]** Gender differences in multi-segment foot kinematics and plantar fascia strain during running
_Foot and Ankle Journal Online_
> This study aimed to determine whether there are gender differences in multi-segment foot kinematics and plantar fascia strain during running. Fifteen male and fifteen female participants ran at 4.0- m.s-1. Multi-segment foot kinematics and plantar fascia strain were quantified using a motion capture system and compared between genders using independent samples t-tests. The results showed that plantar fascia strain wa

**[2]** The effect of foot strike pattern on achilles tendon load during running.
_2013 · Journal Article · Annals of biomedical engineering_
DOI: `10.1007/s10439-013-0819-1`
> In this study we compared Achilles tendon loading parameters during barefoot running among females with different foot strike patterns using open-source computer muscle modeling software to provide dynamic simulations of running. Muscle forces of the gastrocnemius and soleus were estimated from experimental data collected in a motion capture laboratory during barefoot running for 11 runners utilizing a rearfoot strik

**[3]** Conversion to a rearfoot strike pattern during running for prevention of recurrent calf strains: A case report.
_2020 · Physical therapy in sport : official journal of the Association of Chartered Physiotherapists in Sports Medicine_
DOI: `10.1016/j.ptsp.2019.11.004`
> Running-related injuries are prevalent musculoskeletal complaints in the United States military. Although, run retraining is an extensively researched method for reducing pain and improving function in runners, its clinical utility remains low. The patient had a seven-year history of recurrent right calf strains. Prior conventional physical therapy failed to resolve symptoms. A biomechanical running analysis revealed

**[4]** Selected Measures of Angular Displacement, Strength, and Flexibility in Subjects With and Without Shin Splints
_1980 · Journal Article · Research Quarterly for Exercise and Sport_
DOI: `10.1080/02701367.1980.10608070`
> Abstract The purpose of this study was to determine if angular displacement between the calcaneus and the midline of the lower leg while running is related to shin splints. A secondary purpose was to compare the strength and flexibility of ankle-joint plantar flexion, dorsal flexion, inversion, and eversion of shin-splint-injured and non-shin-splint-injured subjects. Two groups of conditioned female athletes were ran

**[5]** Biomechanics and EMG Activity During Painful Running in Runners with Achilles Tendinopathy
_2008 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/01.mss.0000321563.27049.14`
> It is commonly accepted that runners with Achilles tendinopathy develop progressive pain during running which may affect lower limb biomechanics and muscle activity. This however has not been systematically studied. PURPOSE: The aim of this study was to investigate whether the development of pain during running is associated with changes in lower limb biomechanics and muscle activity in runners with Achilles tendinop

**[6] ◀ CITED** Influence of running speed, inclination, and fatigue on calcaneus angle in female runners.
_2025 · Journal Article · Frontiers in physiology_
DOI: `10.3389/fphys.2025.1505263`
> Running is a popular form of physical activity with significant health benefits, but improper technique can lead to running-related injuries. This study investigates the influence of running speed, incline, and fatigue on calcaneus eversion/inversion angle at heel strike, maximum eversion angle, and range of motion, factors associated with lower limb injuries. Fifteen injury-free female runners participated in this s

**[7] ◀ CITED** The effect of selective muscle fatigue on sagittal lower limb kinematics and muscle activity during level running.
_2009 · The Journal of orthopaedic and sports physical therapy_
DOI: `10.2519/jospt.2009.2859`
> Controlled laboratory study. To compare the changes in lower limb sagittal kinematics in running after a knee fatigue protocol with those observed after an ankle fatigue protocol. Impaired force-generating ability of specific muscles may affect running mechanics, with negative implications for injury occurrence and performance. Identifying the strategies used to compensate for fatigue of selected muscles may assist i

**[8]** Simulation of Lower Limb Muscle Activation Using Running Shoes with Different Heel-to-Toe Drops Using Opensim.
_2023 · Journal Article · Healthcare (Basel, Switzerland)_
DOI: `10.3390/healthcare11091243`
> Runners may shift to a midfoot strike pattern when wearing negative running shoes. High muscle forces in the gastrocnemius lateral, Achilleas tendon, and flexor hallucis longus muscles may also indicate an increased risk of Achilleas tendonitis and ankle flexor injuries.

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 23. [mode_1_misattribution] Hypertensive disorders of pregnancy are the most common medical disorder encountered durin…

**Grading id:** `g23`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** What are common cardiovascular diseases during pregnancy?

**Claim under audit:**

> Hypertensive disorders of pregnancy are the most common medical disorder encountered during pregnancy.

**Cited source ids:** 6, 7

**Retrieved sources:**

**[1]** Gestational hypertension, preeclampsia, and peripartum cardiomyopathy : a clinical review
_2019 · Ovid Technologies (Wolters Kluwer Health)_
DOI: `10.1097/01.naj.0000605352.84144.a2`
> Gestational hypertension, preeclampsia, and peripartum cardiomyopathy are among the most common and often severe pregnancy-specific cardiovascular diseases (CVDs) and causes of complications in pregnancy. This clinical review provides nurses with an overview of pregnancy-specific CVDs, outlines their pathophysiology, and discusses risk factors and assessment. It describes management interventions according to timing:

**[2]** Cardiovascular Disease in Pregnancy: When Two Hearts Beat as One.
_2025 · Diagnostics (Basel, Switzerland)_
DOI: `10.3390/diagnostics15222921`
> Background: Cardiovascular disease (CVD) in pregnancy is a major cause of maternal morbidity and mortality, accounting for nearly one-third of pregnancy-related deaths worldwide. Physiological adaptations-expanded plasma volume, increased cardiac output, and a prothrombotic state-represent a natural cardiovascular stress test that may precipitate decompensation or unmask subclinical disease. Aim: This review critical

**[3]** Pregnancy Related Heart Diseases: A Review
_2021 · Journal of Pharmaceutical Research International_
DOI: `10.9734/jpri/2021/v33i64a35296`
> To summarise the literature regarding susceptibility of pregnant women to heart disease, we have conducted a review using a PubMed search and other strategies during the month of february 2021. Studies were included if they reported information on heart disease in pregnant women pregnant existing conditions which can predispose the pregnant woman to cardiovascular disease included hypertension, diabetes mellitus and

**[4]** Exercise Intervention to Mitigate the Cardiovascular Sequence of Pregnancy Complications.
_2024 · Journal Article, Review · Cureus_
DOI: `10.7759/cureus.75703`
> Pregnancy issues such as gestational hypertension, preeclampsia, and gestational diabetes mellitus (GDM) are significant contributors to long-term cardiovascular diseases (CVDs) in women. Recent research has proved the impact of exercise on improving cardiovascular outcomes, particularly in women with pregnancy-related disorders. This review explores the outcomes of various exercise interventions on cardiovascular he

**[5]** Hypertensive Disorders of Pregnancy and Future Cardiovascular Health
_2020 · Frontiers in Cardiovascular Medicine_
DOI: `10.3389/fcvm.2020.00059`
> Hypertensive disorders of pregnancy (HDP) occur in almost 10% of gestations. These women are known to have higher cardiovascular morbidity and mortality later in life in comparison with parous controls who had normotensive pregnancies. Several studies have demonstrated that women with preeclampsia present in a state of segmental impaired myocardial function, biventricular chamber dysfunction, adverse biventricular re

**[6] ◀ CITED** Hypertension in Pregnancy: Diagnosis, Blood Pressure Goals, and Pharmacotherapy: A Scientific Statement From the American Heart Association
_2021 · Hypertension_
DOI: `10.1161/hyp.0000000000000208`
> Hypertensive disorders of pregnancy (HDP) remain one of the major causes of pregnancy-related maternal and fetal morbidity and mortality worldwide. Affected women are also at increased risk for cardiovascular disease later in life, independently of traditional cardiovascular disease risks. Despite the immediate and long-term cardiovascular disease risks, recommendations for diagnosis and treatment of HDP in the Unite

**[7] ◀ CITED** Preeclampsia: Risk Factors, Diagnosis, Management, and the Cardiovascular Impact on the Offspring
_2019 · Journal of Clinical Medicine_
DOI: `10.3390/jcm8101625`
> Hypertensive disorders of pregnancy affect up to 10% of pregnancies worldwide, which includes the 3%-5% of all pregnancies complicated by preeclampsia. Preeclampsia is defined as new onset hypertension after 20 weeks' gestation with evidence of maternal organ or uteroplacental dysfunction or proteinuria. Despite its prevalence, the risk factors that have been identified lack accuracy in predicting its onset and preve

**[8]** A Comprehensive Review of Hypertension in Pregnancy
_2012 · Journal of Pregnancy_
DOI: `10.1155/2012/105918`
> Hypertension is the most common medical disorder encountered during pregnancy. Hypertensive disorders are one of the major causes of pregnancy-related maternal deaths in the United States. We will present a comprehensive update of the literature pertinent to hypertension in pregnancy. The paper begins by defining and classifying hypertensive disorders in pregnancy. The normal vascular and renal physiological changes

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 24. [mode_1_misattribution] Intense training plus inadequate energy availability can suppress ovarian function.

**Grading id:** `g24`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** How can changes in training intensity and menstrual status affect bone health and stress fracture risk?

**Claim under audit:**

> Intense training plus inadequate energy availability can suppress ovarian function.

**Cited source ids:** 2, 4, 5, 6

**Retrieved sources:**

**[1]** Bone density and cyclic ovarian function in trained runners and active controls
_1996 · Medicine & Science in Sports & Exercise_
DOI: `10.1097/00005768-199607000-00002`
> This study was conducted to determine whether rigorous exercise training adversely affects ovarian hormone levels and bone health in cyclically menstruating trained runners. Ovarian hormones, bone mineral density (BMD), body composition, 3-d diet records, 3-d estimated energy expenditure, and menstrual histories were evaluated in 10 trained collegiate runners and 10 moderately active controls. The trained runners had

**[2] ◀ CITED** Optimising Bone Health in Female Athletes: A Narrative Review
_2024 · Review · Sports Science & Health Advances_
DOI: `10.60081/ssha.2.2.2024.316-321`
> Bone health is crucial for female athletes to optimize performance, prevent injuries, and ensure long-term well-being. Factors like hormonal changes, nutritional deficiencies, and overtraining can compromise skeletal integrity, increasing risks of stress fractures, osteoporosis, and Relative Energy Deficiency in Sport (RED-S). This review highlights strategies to maintain bone health, focusing on adolescence and earl

**[3]** [Physical exercise and the skeleton].
_1995 · Archives of physiology and biochemistry_
DOI: `10.3109/13813459508998138`
> The skeleton provides more than only a framework for the body. Bone is a calcified conjunctive tissue sensitive to various mechanical stimuli, mainly to those resulting from gravity and muscular contractions. Numerous animal and human studies demonstrate the importance of weight-bearing physical activity as well as mechanical loading for maintaining skeletal integrity. Lack of weight-bearing activity is dangerous for

**[4] ◀ CITED** Exercise training, menstrual irregularities and bone development in children and adolescents.
_2003 · Journal of pediatric and adolescent gynecology_
DOI: `10.1016/s1083-3188(03)00122-0`
> Weight bearing physical activity plays an important role in bone development. This is particularly important in children and adolescents since bone mineral density reaches about 90% of its peak by the end of the second decade, and because about one quarter of adult bone is accumulated during the two years surrounding the peak bone growth velocity. Recent studies suggested that the exercise-induced increase in bone mi

**[5] ◀ CITED** Osteoporosis in Female Athletes
_2013 · International Journal of Clinical Therapeutics and Diagnosis_
DOI: `10.19070/2332-2926-130002`
> Osteoporosis afflicts millions of women worldwide, but is especially prevalent among female athletes. The stress of intense workouts places these female athletes at a greater risk than the general female population. Absence or suppression of menstruation in female athletes leads to a low peak bone mass and subsequently to the weakening of their bones. This domino effect, coupled with their participation in physical a

**[6] ◀ CITED** Metabolic Bone Disease in Athletes.
_2026 · Journal Article, Review · Seminars in musculoskeletal radiology_
DOI: `10.1055/a-2754-0153`
> Metabolic bone disease is characterized by impaired bone strength, density, or mineralization, increasingly observed in athletes due to complex nutritional, hormonal, and mechanical factors. The underlying pathophysiology includes dysregulated bone turnover driven by hormonal imbalances, inflammatory cytokines, and microdamage accumulation.Although weight-bearing activity generally promotes bone health, excessive tra

**[7]** Exercise, amenorrhoea and the skeleton
_1992 · Review · British Medical Bulletin_
DOI: `10.1093/oxfordjournals.bmb.a072562`
> One of the accepted benefits of regular exercise is the development of increased bone mineral density (BMD) and hence a skeleton more capable of withstanding the rigours of physical activity throughout life. However an apparent paradox is seen in the observed decrease in lumbar BMD in female athletes who experience menstrual disturbance and athletic amenorrhoea (AA). Despite high levels of activity these athletes suf

**[8]** Is the Pill the Answer for Patients with the Female Athlete Triad?
_2012 · Current Sports Medicine Reports_
DOI: `10.1249/jsr.0b013e3182499e86`
> As a family and sports physician, I care for many young women affected by the female athlete triad. Typically, they present with low body mass index (BMI), oligomenorrhea or amenorrhea, and, oftentimes, low bone mineral density or stress fractures. Sometimes, the low BMI stems from intentional restriction of dietary intake; other times, it is a consequence of an unintentional mismatch of caloric intake relative to hi

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 25. [mode_1_misattribution] Multiple exercise tests show peak blood lactate often occurs around 3–5 minutes after a ha…

**Grading id:** `g25`
**LLM judge verdict:** `mode_1_misattribution`

**Original chat question:** best timing to test lactate after hard run

**Claim under audit:**

> Multiple exercise tests show peak blood lactate often occurs around 3–5 minutes after a hard run rather than immediately at exercise cessation.

**Cited source ids:** 1, 4, 5

**Retrieved sources:**

**[1] ◀ CITED** Does Time Of Measurement Effect Peak Blood Lactate Following Maximal Exercise?
_2007 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/01.mss.0000273963.08596.de`
> A review of the literature reveals that measurements of peak or maximal blood lactate [PL] following maximal exercise [ME] to range from immediately following exercise to the third min of recovery. PURPOSE: To determine if PL is affected when measurements are made immediately following ME or from the third to fourth min of recovery in competitive distance runners. METHODS: Twenty-one junior elite female distance runn

**[2]** Arterialized and venous blood lactate concentration difference during different exercise intensities.
_2017 · Journal Article · Journal of exercise science and fitness_
DOI: `10.1016/j.jesf.2017.05.001`
> These results suggest a delayed lactate appearance in the venous blood, which is accentuated at higher exercise intensities. The lactate measured in arterialized and venous blood is interchangeable only when blood samples are collected at least 10 minutes after the exercise starts.

**[3]** Peak Blood Lactate Concentration and Its Arrival Time Following Different Track Running Events in Under-20 Male Track Athletes.
_2021 · International journal of sports physiology and performance_
DOI: `10.1123/ijspp.2020-0685`
> To determine (1) the time of arrival of peak blood lactate concentration ([BLa]peak) followed by various track events and (2) significant correlation, if any, between average velocity and [BLa]peak in these events. In 58 under-20 male track athletes, heart rate was recorded continuously and blood lactate concentration was determined at various intervals following 100-m (n = 9), 200-m (n = 8), 400-m (flat) (n = 9), 40

**[4] ◀ CITED** Peak blood lactate after short periods of maximal treadmill running
_1982 · Journal Article · European Journal of Applied Physiology_
DOI: `10.1007/bf00430218`
> Blood lactate was determined in 19 untrained subjects after maximal treadmill exercise lasting for about 1 min. It was found that blood lactate increases after exercise, reaching a maximum level 6-9 min after the cessation of exercise, and the average time for the appearance of the peak blood lactate concentration was 7.65 min. Peak blood lactate concentration at 7.65 min (CLA7.65), which was calculated by substituti

**[5] ◀ CITED** Blood Lactate Kinetics Following Maximal Short-term Sprints In Children
_2005 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/00005768-200505001-00123`
> Following the cessation of short-term maximal exercise blood lactate levels continue to rise as lactate invades the blood from the muscle before being eliminated. In children, peak blood lactate concentration (BLC) is said to occur 2–3 minutes post-supramaximal exercise. A 4-parameter model allows for the more accurate determination of the peak BLC (BLCpeak) post-exercise and the time taken to achieve that peak (TBLC

**[6]** Blood lactate clearance during active recovery after an intense running bout depends on the intensity of the active recovery
_2010 · Taylor and Francis_
DOI: `10.1080/02640414.2010.481721`
> High-intensity exercise training contributes to the production and accumulation of blood lactate, which is cleared by active recovery. However, there is no commonly agreed intensity or mode for clearing accumulated blood lactate. We studied clearance of accumulated blood lactate during recovery at various exercise intensities at or below the lactate threshold after high-intensity interval runs that prompted lactate a

**[7]** Blood lactate concentrations following maximal incremental test in male runners with different ages
_2018 · Journal Article · Revista Brasileira de Educação Física e Esporte_
DOI: `10.11606/1807-5509201800010005`
> The aim of this study was to investigate the effect of age on peak blood lactate concentration following a maximal incremental treadmill test in male recreational runners. Seventy runners from four age groups, ≤25 years; 26-35 years; 36-45 years; &gt;45 years, performed an incremental treadmill test starting at 8 km·h-1, and increasing by 1 km·h-1 every three minutes until volitional exhaustion. Blood samples were co

**[8]** Blood lactates after prolonged severe exercise
_1963 · Journal Article · Journal of Applied Physiology_
DOI: `10.1152/jappl.1963.18.3.619`
> Blood was drawn from cross-country skiers at 1–3 min after the finish in competitions on distances from 10 to 85 km and the blood lactate determined. Despite a maximal effort of the skiers, accentuated at the end of the race, there was a successive decrease in the blood lactate concentration with work time. After a 10-km race, work time 35–36 min, the average was 139 mg/100 ml of blood (12.5 mEq/liter); after a 30-km

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

# mode_2 control (LLM-flagged over-generalized)

## 26. [mode_2_overgen] Some polyphenol-based products are plausible weight-loss supplement options.

**Grading id:** `g26`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["review of phytochemicals/natural health products","mechanistic and potential framing rather than definitive clinical efficacy","examples limited to specific compounds such as citrus flavonoids, green tea EGCG, resveratrol, capsaicin, and curcumin"]

**Original chat question:** natural supplements weight loss

**Claim under audit:**

> Some polyphenol-based products are plausible weight-loss supplement options.

**Cited source ids:** 5, 6, 4

**Retrieved sources:**

**[1]** Dietary Supplements for Improving Body Composition and Reducing Body Weight: Where Is the Evidence?
_Human Kinetics, Inc._
> Weight-loss supplements typically fall into 1 of 4 categories depending on their hypothesized mechanism of action: products that block the absorption of fat or carbohydrate, stimulants that increase thermogenesis, products that change metabolism and improve body composition, and products that suppress appetite or give a sense of fullness. Each category is reviewed, and an overview of the current science related to th

**[2]** Obesity, Herbal Supplements, and Weight Loss: A Narrative Review of Efficacy and Safety
_2026 · Sustainable Welfare_
DOI: `10.64086/suswel.2025.29`
> Obesity and its associated comorbidities have become a major global public health concern, imposing a substantial burden on healthcare systems and socioeconomic structures. Although lifestyle modifications, including healthy dietary patterns, regular physical activity, and behavioral approaches, constitute the cornerstone of weight management, poor long-term adherence often leads individuals to seek alternative strat

**[3]** Dietary supplements for obesity
_2022 · Department of Health Science - University of Genoa_
DOI: `10.15167/2421-4248/jpmh2022.63.2s3.2757`
> Obesity and associated complications including diabetes, cardiometabolic dysfunction, disability, malignancy and premature mortality are considered epidemic. Research on obesity is therefore of worldwide importance. The development of obesity is a multifactorial phenomenon with contributions from biological, behavioral, genetic and environmental factors. Obesity and its associated issues require various lifestyle mod

**[4] ◀ CITED** Eight weeks of supplementation with a multi-ingredient weight loss product enhances body composition, reduces hip and waist girth, and increases energy levels in overweight men and women
_2012 · Journal of the International Society of Sports Nutrition_
DOI: `10.1186/1550-2783-10-22`
> BackgroundNumerous natural products are marketed and sold claiming to decrease body weight and fat, but few undergo finished product-specific research demonstrating their safety and efficacy.ObjectiveTo determine the safety and efficacy of a multi-ingredient supplement containing primarily raspberry ketone, caffeine, capsaicin, garlic, ginger and Citrus aurantium (Prograde Metabolism™ [METABO]) as an adjunct to an ei

**[5] ◀ CITED** Phytochemicals in regulating fatty acid β-oxidation: Potential underlying mechanisms and their involvement in obesity and weight loss.
_2016 · Journal Article, Review, Research Support, Non-U.S. Gov't · Pharmacology & therapeutics_
DOI: `10.1016/j.pharmthera.2016.06.005`
> Alternatively, dietary phytochemicals and natural health products offer great potential as an efficient weight loss strategy by modulating lipid metabolism and/or increasing BMR and thermogenesis. Specifically, polyphenols such as citrus flavonoids, green tea epigallocatechin gallate, resveratrol, capsaicin and curcumin, have been reported to increase lipolysis and induce fatty acid β-oxidation through modulation of

**[6] ◀ CITED** Phytochemicals in Obesity Management: Mechanisms and Clinical Perspectives.
_2025 · Journal Article, Review · Current nutrition reports_
DOI: `10.1007/s13668-025-00611-w`
> Phytochemicals demonstrate significant potential in obesity control through various molecular mechanisms. These include the modulation of adipogenesis, regulation of lipid metabolism, enhancement of energy expenditure, and suppression of appetite. Recent studies have provided compelling clinical evidence supporting the use of specific phytochemicals in obesity treatment. Notable among these are green tea extract, ric

**[7]** A Review of Natural Stimulant and Non‐stimulant Thermogenic Agents
_2016 · Review · Phytotherapy Research_
DOI: `10.1002/ptr.5583`
> Obesity and overweight are major health issues. Exercise and calorie intake control are recognized as the primary mechanisms for addressing excess body weight. Naturally occurring thermogenic plant constituents offer adjunct means for assisting in weight management. The controlling mechanisms for thermogenesis offer many intervention points. Thermogenic agents can act through stimulation of the central nervous system

**[8]** Dietary fat intake, supplements, and weight loss.
_2000 · Journal Article, Research Support, Non-U.S. Gov't, Research Support, U.S. Gov't, Non-P.H.S., Review · Canadian journal of applied physiology = Revue canadienne de physiologie appliquee_
DOI: `10.1139/h00-033`
> All of these compounds are currently marketed in supplemental form to increase weight loss, but few have actually been shown to be effective in scientific studies. To date, there is little or no evidence supporting that carnitine or hydroxycitrate supplementation are of any value for weight loss in humans. Supplements such as pyruvate have been shown to be effective at high dosages, but there is little mechanistic in

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 27. [mode_2_overgen] Exercise can reduce inflammatory burden and improve gut barrier-related markers.

**Grading id:** `g27`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["moderate exercise","average athletes"]

**Original chat question:** How does regular physical activity influence the diversity of gut bacteria and inflammation markers?

**Claim under audit:**

> Exercise can reduce inflammatory burden and improve gut barrier-related markers.

**Cited source ids:** 2, 4

**Retrieved sources:**

**[1]** Diet, Physical Exercise, and Gut Microbiota Modulation in Metabolic Syndrome: A Narrative Review.
_2026 · Journal Article, Review · Life (Basel, Switzerland)_
DOI: `10.3390/life16010098`
> Across human interventional studies, moderate-intensity physical exercise was most consistently associated with increased gut microbial diversity and enrichment of short-chain fatty acid (SCFA)-producing taxa, contributing to improved insulin sensitivity and reduced inflammation. MedDiet and DASH were generally linked to favorable microbiota profiles, including increased abundance of Faecalibacterium prausnitzii, Akk

**[2] ◀ CITED** Exercise-Induced Modulation of the Gut Microbiota: Mechanisms, Evidence, and Implications for Athlete Health
_2025 · Journal Article · Gastrointestinal Disorders_
DOI: `10.3390/gidisord8010001`
> The gut microbiota plays a fundamental role in human physiology by influencing metabolism, immunity, and neuroendocrine communication. Growing evidence suggests that physical exercise modulates gut microbial composition; however, study findings remain inconsistent due to variations in design, training type, and population characteristics. This review summarizes current research on how different forms, intensities, an

**[3]** The Impact of Physical Exercise on Gut Microbiota: A Literature Review Study
_2025 · Altius: Jurnal Ilmu Olahraga dan Kesehatan_
DOI: `10.36706/altius.v14i2.195`
> Background: Emerging evidence highlights the bidirectional interaction between physical activity and the gut microbiota, which plays a critical role in host metabolism, immune modulation, and intestinal barrier integrity. Understanding how different forms of exercise influence gut microbiota is essential for optimizing health strategies based on lifestyle interventions. Methods: A systematic literature review was con

**[4] ◀ CITED** Interplay Between Exercise and Gut Microbiome in the Context of Human Health and Performance.
_2021 · Journal Article, Review · Frontiers in nutrition_
DOI: `10.3389/fnut.2021.637010`
> Gut microbiota and exercise have recently been shown to be interconnected. Both moderate and intense exercise are typically part of the training regimen of endurance athletes, but they exert different effects on health. Moderate exercise has positive effects on the health of average athletes, such as a reduction in inflammation and intestinal permeability and an improvement in body composition. It also induces positi

**[5]** Implications of the Gut Microbiome in Sports
_2022 · Current Research · Sports Health_
DOI: `10.1177/19417381211060006`
> Diet and exercise play very important roles in the composition of the gut microbiota in the athletic and nonathletic individual. Ingestion of carbohydrates during and after exercise seems to have an anti-inflammatory effect postexercise. Supplementation with probiotic seems to aid in recovery after exercise, too, especially restoring the "normal" gut microbiota. Physically active individuals of all levels have more a

**[6]** Physical Exercise and the Gut Microbiome: A Bidirectional Relationship Influencing Health and Performance.
_2024 · Journal Article, Review · Nutrients_
DOI: `10.3390/nu16213663`
> Furthermore, exercise enhances gut microbiome diversity, increases SCFA production, improves nutrient utilization, and modulates neural and hormonal pathways, improving gut barrier integrity. Our findings also showed probiotic supplementation is associated with decreased inflammation, enhanced sports performance, and fewer gastrointestinal disturbances, suggesting that the relationship between the gut microbiome and

**[7]** Physical activity induced alterations of gut microbiota in humans: a systematic review
_2022 · BMC Sports Science, Medicine and Rehabilitation_
DOI: `10.1186/s13102-022-00513-2`
> Abstract Background Gut microbiota is considered to have a great impact on human health and disease. While it is widely recognized that the gut microbiota of healthy individuals differs from those with obesity, inflammatory bowel disease, metabolic syndrome, and other chronic diseases, the alterations of gut microbiota with physical activity are not fully understood. Accordingly, we performed this systematic review t

**[8]** Can physical exercise modify intestinal integrity and gut microbiota composition? A systematic review of in vivo studies
_2025 · Biology of Sport_
DOI: `10.5114/biolsport.2025.148545`
> There is little evidence about how physical exercise affects the gut microbiota since studies in the field are relatively recent. Thus, we aimed to systematically review the main effects of regular physical exercise on the intestinal integrity and microbiota composition in animal models, discuss the mechanisms involved, and indicate future directions. Searches for original articles were performed in PubMed/MEDLINE, S

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 28. [mode_2_overgen] Yoga-specific postpartum evidence is mostly about combination programs or related pregnanc…

**Grading id:** `g28`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["combination program of postpartum yoga plus pelvic floor training","focuses on quality-of-life outcome"]

**Original chat question:** does postpartum yoga really help pelvic recovery women

**Claim under audit:**

> Yoga-specific postpartum evidence is mostly about combination programs or related pregnancy/pelvic-floor outcomes.

**Cited source ids:** 1, 7, 5

**Retrieved sources:**

**[1] ◀ CITED** What are the benefits of pelvic floor exercises postnatally?
DOI: `10.5281/zenodo.19065229`
> Pelvic floor exercises postnatally benefit women by improving urinary incontinence, muscle function, and well-being, although variations in study protocols highlight a need for tailored approaches.

**[2]** Pelvic floor muscle training for urinary incontinence postpartum.
_British journal of nursing (Mark Allen Publishing)_
DOI: `10.12968/bjon.2015.24.11.576`
> The offering of pelvic floor muscle exercises to all women during their first pregnancy is recommended by National Institute for Health and Care Excellence (NICE) guidelines. Pelvic floor muscles suffer significant trauma throughout pregnancy and childbirth, which may sometimes lead to urinary incontinence postpartum. However, it is uncertain how effective pelvic floor muscle exercises are in treating this incontinen

**[3]** Yoga Exercises Have an Effect on Accelerating the Recovery of Diastasis Recti Abdominis Muscles in Postpartum Women
_2026 · Women Midwives and Midwifery_
DOI: `10.36749/wmm.6.1.19-27.2026`
> Background: diastasis Recti Abdominis Muscle (DRAM), a condition characterized by the separation of the rectus abdominis muscles along the linea alba, commonly occurs postpartum and may impair quality of life. Yoga has been proposed as a non-invasive intervention to address this issue through core muscle engagement and tissue remodeling. Purpose: this study aims to determine the effectiveness of yoga in accelerating

**[4]** Effect of Yoga in Pregnancy on Maternal Pelvic Floor Distress Symptoms-A Randomised Control Study.
_2024 · International urogynecology journal_
DOI: `10.1007/s00192-024-05856-7`
> Pregnancy is associated with an increase in pelvic floor dysfunction. Yoga, an ancient Indian practice involving asanas (physical postures), pranayam (breathing patterns) and meditation, can help women to control their pelvic floor muscles. However, the literature to support yoga as a remedy for pelvic floor dysfunction is lacking. We hypothesized that yoga could be an important method in improving pelvic floor dysfu

**[5] ◀ CITED** The effect of combining post-partum yoga and pelvic floor training on life quality of post-partum mothers
_2024 · Jurnal Ners dan Kebidanan Indonesia_
DOI: `10.21927/jnki.2024.12(2).190-202`
> Background: Data from the World Health Organization (WHO) indicate that the postpartum phase has the highest rates of maternal death and morbidity. In the first year following childbirth, almost 50% of women experience mental health issues and declining life quality scores on the physical-emotional dimension significantly. Objectives: This study aims to determine the effect of the combination of postpartum yoga and p

**[6]** Effects of Pilates-Based Exercise on Diastasis Recti Abdominis, Pelvic Floor Function, and Musculoskeletal Pain Across the Perinatal Period: A Narrative Review
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.51.68441`
> Pregnancy and childbirth induce physiological changes affecting posture, abdominal wall integrity, and pelvic floor function. Diastasis recti abdominis affects up to 60% of women during pregnancy, pelvic floor dysfunction occurs in approximately 40% postpartum, and lumbopelvic pain persists in about 25% of women beyond early recovery. Pilates-based exercise offers an integrated approach combining breathing control, c

**[7] ◀ CITED** Impact of postpartum exercise on pelvic floor disorders and diastasis recti abdominis: a systematic review and meta-analysis
_2024 · British Journal of Sports Medicine_
DOI: `10.1136/bjsports-2024-108619`
> Objective To examine the effect of exercise during the first year postpartum on pelvic floor disorders and diastasis recti abdominis. Design Systematic review with random effects meta-analysis. Data sources: MEDLINE, EMBASE, CINAHL, SPORTDiscuss, Evidence-Based Medicine Reviews (Ovid), Scopus, Web of Science and ClinicalTrials.gov were searched until 12 January 2024. Eligibility criteria for selecting studies Studies

**[8]** The effect of post-natal exercises to strengthen the pelvic floor muscles.
_1996 · Acta obstetricia et gynecologica Scandinavica_
DOI: `10.3109/00016349609033336`
> The purpose of the present study was to evaluate the effect of post-natal pelvic floor muscle exercise. A prospective comparison design comprising 66 matched pairs (n=132) of mothers, divided into a training group (TG) and a control group (CG) was used. The TG attended an eight week special pelvic floor muscle exercise course, training in groups led by a physiotherapist 45 minutes once per week. In addition they exer

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 29. [mode_2_overgen] A 2025 randomized trial in 68 older adults used 12 weeks of resistance training to test ca…

**Grading id:** `g29`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["training frequency: three times per week","study groups: control group and training group"]

**Original chat question:** is strength training safe for older adults' heart health

**Claim under audit:**

> A 2025 randomized trial in 68 older adults used 12 weeks of resistance training to test cardiovascular, autonomic, and immune responses.

**Cited source ids:** 2, 3, 4

**Retrieved sources:**

**[1]** Growing stronger: strength training for older adults
_John Hancock Center for Physical Activity and Nutrition, Friedman School of Nutrition Science and Policy, Tufts University_
> An Exercise program for you -- 1. The Power of strength training -- 2. Making change -- 3. Getting motivated -- 4. Starting your journey: 6 simple steps -- 5. Getting stronger: a 3-part program -- 6. The courage to progress -- 7. Staying on track: your 12-week workbook -- APPENDIX: Resources for staying strongRebecca A. Sequin, Jacqueline N. Epping, David Buchner, Rina Bloch, Miriam E. Nelson."This material is based

**[2] ◀ CITED** Resistance Training Improves Hemodynamics Involving Autonomic and Immune Responses.
_2025 · Clinical Trial, Journal Article · International journal of sports medicine_
DOI: `10.1055/a-2716-9475`
> Aging impairs cardiovascular, autonomic and immune responses. Whether the resistance training influences such responses is unknown. We tested the hypothesis that resistance training could attenuate such impairments in older adults. Sixty-eight older adults were randomized into a control group ( n =38) and a training group ( n =31). Resistance training sessions were conducted three times per week, 12-week period, at a

**[3] ◀ CITED** Efeitos hemodinâmicos e vasculares do treinamento resistido: implicações na doença cardiovascular
_2007 · Review · Arquivos Brasileiros de Cardiologia_
DOI: `10.1590/s0066-782x2007001600008`
> Resistance training has been proposed as a possible strategy for cardiovascular prevention and rehabilitation, and in this context, this review describes the cardiovascular effects mediated by this type of intervention. Increments in both muscular strength and capacity to perform daily tasks are well-characterized benefits of this type of training. More recently, studies using hemodynamic evaluation have shown cardio

**[4] ◀ CITED** Effect of exercise on blood pressure in older persons: a randomized controlled trial.
_2005 · Archives of Internal Medicine_
DOI: `10.1001/ARCHINTE.165.7.756`
> <h4>Background</h4>Because of age-related differences in the cause of hypertension, it is uncertain whether current exercise guidelines for reducing blood pressure (BP) are applicable to older persons. Few exercise studies in older persons have evaluated BP changes in relation to changes in body composition or fitness.<h4>Methods</h4>This was a 6-month randomized controlled trial of combined aerobic and resistance tr

**[5]** AGING & MUSCULAR FUNCTION: A SELECTED REVIEW OF LITERATURE WITH EMPHASIS ON CARDIORESPIRATORY ENDURANCE AND FUNCTIONAL PERFORMANCE RESPONSE TO RESISTANCE EXERCISE
_2021 · European Journal of Fitness, Nutrition and Sport Medicine Studies_
DOI: `10.46827/ejfnsm.v2i1.101`
> This narrative review evaluates strength or resistance training on cardiorespiratory endurance, blood pressure, contractile function, contractile protein synthesis rate, bone turnover, gait and balance, and neuromuscular adaptations in elderly populations. Seventy-eight studies spanning from 1999 through 2020 were reviewed. Database sources including PubMed, Science Direct, Web of Knowledge and Google Scholar were se

**[6]** Cardiac Work Remains High after Strength Exercise in Elderly
_2012 · International Journal of Sports Medicine_
DOI: `10.1055/s-0032-1323779`
> Moderate- to high-intensity strength training is recommended for healthy adults. In young subjects, a single session of strength training decreases blood pressure, while heart rate and cardiac work remain elevated afterwards. However, these effects have not been clearly demonstrated in elderly subjects. To investigate this issue, 16 elderly subjects each underwent a Control and an Exercise (3 sets, 8 RM, 9 exercises)

**[7]** High eccentric strength training reduces heart rate variability in healthy older men
_2007 · British Journal of Sports Medicine_
DOI: `10.1136/bjsm.2007.035246`
> Background: Evaluation of non-pharmacological therapies that improve autonomic control of the heart rate in older subjects has a clinical significance, because reduced heart rate variability (HRV) can be associated with higher cardiovascular morbidity and mortality rates. Objective: To investigate if strength training improves cardiac autonomic control in healthy older men. Methods: The HRV of nine older healthy men

**[8]** Comparison of once-weekly and twice-weekly strength training in older adults.
_2007 · Comparative Study, Journal Article, Randomized Controlled Trial · British journal of sports medicine_
DOI: `10.1136/bjsm.2006.029330`
> Strength training has been shown to benefit the health and function of older adults.

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 30. [mode_2_overgen] A multicenter retrospective cohort in singleton pregnancies with cerclage studied whether …

**Grading id:** `g30`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["multicenter international retrospective cohort","699 singleton pregnancies with cerclage","comparison was progestogen plus cerclage vs cerclage alone","study outcome specifically preterm birth reduction"]

**Original chat question:** Does progesterone help prevent pregnancy complications?

**Claim under audit:**

> A multicenter retrospective cohort in singleton pregnancies with cerclage studied whether adding progestogen reduces preterm birth.

**Cited source ids:** 2

**Retrieved sources:**

**[1]** The effects of progesterone supplementation in pregnancies assessed by doppler ultrasound: a systematic review of maternal and perinatal outcomes.
_2025 · European journal of medical research_
DOI: `10.1186/s40001-025-03382-w`
> Progesterone is essential for pregnancy maintenance, but its effects on complications like intrauterine growth restriction (IUGR), preeclampsia, prelabor rupture of membranes (PROM), preterm birth, and placental abruption are still debated. This review investigates the effects of progesterone supplementation on Doppler ultrasound indices and pregnancy outcomes. To assess the efficacy of progesterone supplements in re

**[2] ◀ CITED** Concurrent progestogen and cerclage to reduce preterm birth: a multicenter international retrospective cohort.
_2024 · Journal Article, Multicenter Study · American journal of obstetrics & gynecology MFM_
DOI: `10.1016/j.ajogmf.2024.101351`
> During the study period, a total of 699 singletons met the inclusion criteria: 561 in the progestogen with cerclage group and 138 with cerclage alone. Baseline characteristics were similar, except the higher likelihood of previous spontaneous preterm birth in the progestogen group (61% vs 41%; P<.001). Within the progestogen group, 52% were on 17-hydroxyprogesterone caproate weekly, 44% on vaginal progesterone daily,

**[3]** Luteal support: progestogens for pregnancy protection.
_2009 · Maturitas_
DOI: `10.1016/j.maturitas.2009.09.012`
> Following ovulation, the granulosa cells undergo luteinization and form part of the corpus luteum; this then secretes progesterone that causes secretory transformation of the endometrium so that implantation can occur. The ideal time for implantation is 6-10 days after the luteinizing hormone (LH) surge; implantation occurring outside this optimal window is associated with a higher likelihood of miscarriage. Before t

**[4]** Cyclic AMP and progesterone receptor cross-talk in human endometrium: a decidualizing affair
_2003 · Journal of Endocrinology_
DOI: `10.1677/joe.0.1780357`
> During the menstrual cycle, the ovarian hormones oestradiol and progesterone control the ordered growth and differentiation of uterine cells. This remodelling process is critical for implantation of the developing embryo, the formation of the placenta, and maintenance of pregnancy. Failure of uterine tIssues to respond appropriately to ovarian hormone signalling results in defective placentation, associated with a sp

**[5]** Role of Human Chorionic Gonadotrophin Compared to 17-Alpha-Hydroxyprogesterone in the Management of Threatened Abortion: Experience in a Military Hospital in Dhaka, Bangladesh
_2019 · BIRDEM Medical Journal_
DOI: `10.3329/birdem.v9i1.39717`
> Background: Threatened abortion is the most common complication in the first half of gestation. Spontaneous abortion occurs in less than 30% of the women who experience threatened abortion. In order to prevent pregnancy loss several supportive therapies including hormonal therapy like human chorionic gonadotropin (hCG) or 17-alpha-hydroxyprogesterone (progesterone) have been advocated. The exogenous administration of

**[6]** Seasonal heat stress: Clinical implications and hormone treatments for the fertility of dairy cows.
_2015 · Journal Article, Review · Theriogenology_
DOI: `10.1016/j.theriogenology.2015.04.021`
> Progesterone supplementation during the late embryonic and/or early fetal period would be useful in curtailing pregnancy losses, mainly in single pregnancies, whereas a more positive effect of treatment with GnRH than progesterone has been found in twin pregnancies. Melatonin therapy is emerging as a promising strategy to improve the natural reproductive performance of cows suffering conditions of heat stress.

**[7]** Partial Progesterone Deprivation Affects the Expression of Apoptosis-Specific Genes and Proteins in a Zone-Specific Manner in Rat Placenta.
_2025 · Journal Article · Cureus_
DOI: `10.7759/cureus.95988`
> Background Progesterone maintains the well-being of both the placenta and the fetus. Low maternal progesterone levels are strongly correlated with smaller placentas and fetal growth restriction. Aim To investigate the possible effects of reduced progesterone levels-induced placental zone-specific apoptosis mechanisms, which may contribute to intrauterine growth retardation (IUGR). Methods Sprague-Dawley rats were div

**[8]** Serum Progesterone Profile Across the Mid and Late Luteal Phase in Artificial Cycles Is Associated With Pregnancy Outcome.
_2021 · Clinical Trial, Journal Article, Research Support, Non-U.S. Gov't · Frontiers in endocrinology_
DOI: `10.3389/fendo.2021.665717`
> In hormonal replacement therapy cycles, serum progesterone levels across luteal phase days are associated with pregnancy outcome. Ongoing pregnancies were associated with a higher exposure to progesterone in comparison with pregnancy losses or negative β-hCG. Therefore, serum progesterone might be playing an important role not only during implantation, but also in pregnancy maintenance. It remains unknown if the vari

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 31. [mode_2_overgen] Interval training drives skeletal-muscle adaptations such as improved capillary and mitoch…

**Grading id:** `g31`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["low-volume HIIT","18 sessions over 6 weeks","cycling intervals at ~90% HRmax with 60-sec recovery","healthy but sedentary overweight women","fiber-type-specific markers of capillary and mitochondrial content"]

**Original chat question:** can college women boost heart and muscle health with short intense workouts?

**Claim under audit:**

> Interval training drives skeletal-muscle adaptations such as improved capillary and mitochondrial markers and improved fat oxidation over 2–6 weeks.

**Cited source ids:** 3, 2, 1

**Retrieved sources:**

**[1] ◀ CITED** HIGH INTENSITY INTERVAL TRAINING (HIIT) AS A MULTIDIMENSIONAL PERFORMANCE ENHANCER IN FITNESS
_2025 · Journal Article · University Arena._
DOI: `10.62229/uaviii_5_25-14`
> Background. High-Intensity Interval Training (HIIT) is an efficient exercise modality involving alternating short bouts of intense activity with recovery periods. It is increasingly popular among recreationally active individuals due to its time efficiency and broad health benefits. Literature supports its efficacy in enhancing cardiovascular capacity, promoting fat oxidation, and improving anaerobic performance. Giv

**[2] ◀ CITED** Skeletal muscle fiber-type-specific changes in markers of capillary and mitochondrial content after low-volume interval training in overweight women
_2018 · Journal Article · Physiological Reports_
DOI: `10.14814/phy2.13597`
> High-intensity interval training (HIIT) enhances skeletal muscle oxygen delivery and utilization but data are limited regarding fiber-specific adaptations in humans. We examined the effect of 18 sessions of HIIT (10 × 60-sec cycling intervals at ~90% HR<sub>max</sub> , interspersed by 60-sec of recovery) over 6 weeks on markers of microvascular density and oxidative capacity in type I and II fibers in healthy but sed

**[3] ◀ CITED** Two weeks of high-intensity aerobic interval training increases the capacity for fat oxidation during exercise in women.
_2007 · Journal of applied physiology_
DOI: `10.1152/JAPPLPHYSIOL.01098.2006`
> Our aim was to examine the effects of seven high-intensity aerobic interval training (HIIT) sessions over 2 wk on skeletal muscle fuel content, mitochondrial enzyme activities, fatty acid transport proteins, peak O(2) consumption (Vo(2 peak)), and whole body metabolic, hormonal, and cardiovascular responses to exercise. Eight women (22.1 +/- 0.2 yr old, 65.0 +/- 2.2 kg body wt, 2.36 +/- 0.24 l/min Vo(2 peak)) perform

**[4]** Sports Science Approach to High-Intensity Interval Training (HIIT): Cardio metabolic Health Benefits in University Students
_2025 · Journal Article · Review Journal of Social Psychology & Social Works_
DOI: `10.71145/rjsp.v3i3.318`
> High-Intensity Interval Training (HIIT) is a recent and effective training method which has caused great interest among exercise scientists for its capability of promoting remarkable cardiometabolic responses in reduced times. This training regimen, characterized by multiple short near maximal intervals interspersed with brief recovery periods of low work intensity, is particularly powerful when applied to university

**[5]** Effect Of Heavy Resistance Training On Low- And High-intensity Upper Body Work Capacity In College Women
_2011 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/01.mss.0000402333.96006.cb`
> Heavy-resistance training programs may not improve high-intensity work capacity while significantly improving low-intensity work capacity in average college men. This phenomenon has not been documented in young women. PURPOSE: To assess the effect of heavy-resistance training on low-and high-intensity upper-body work capacity in college women. METHODS: Untrained women (n = 59, mean ± SD: age = 19.1 ± 1.1 y, height =

**[6]** Effect of High Intensity Interval Training (HIIT) on Substrate Utilization
_2010 · Journal Article · The FASEB Journal_
DOI: `10.1096/fasebj.24.1_supplement.618.10`
> High‐intensity interval training (HIIT) provides a powerful stimulus that elicits similar physiological changes, such as increased VO 2 max and fat utilization, as traditional endurance training. However, the majority of studies employing this training regimen have used sedentary subjects, so it is unknown if it is still effective in active individuals. PURPOSE The primary aim of the study was to examine the effect o

**[7]** Physiological and performance adaptations to high-intensity interval training.
_2013 · Journal Article, Review · Nestle Nutrition Institute workshop series_
DOI: `10.1159/000350256`
> High-intensity interval training (HIIT) refers to exercise that is characterized by relatively short bursts of vigorous activity, interspersed by periods of rest or low-intensity exercise for recovery. In untrained and recreationally active individuals, short-term HIIT is a potent stimulus to induce physiological remodeling similar to traditional endurance training despite a markedly lower total exercise volume and t

**[8]** Six weeks of high-intensity interval training enhances contractile activity induced vascular reactivity and skeletal muscle perfusion in older adults.
_2021 · Journal Article, Randomized Controlled Trial, Research Support, Non-U.S. Gov't · GeroScience_
DOI: `10.1007/s11357-021-00463-6`
> 15.3 ± 3.8 ml/kg/min, P < 0.001), dynamic exercise capacity (145 ± 60 vs. 159 ± 59 W, P < 0.001) and resting (systolic) blood pressure (142 ± 15 vs. 133 ± 11 mmHg, P < 0.01). Notably, HIIT elicited significant increases in microvascular blood flow responses to acute contractile activity (1.8 ± 0.63 vs. 2.3 ± 0.8 (arbitrary contrast units (AU), P < 0.01)), with no change in any of these parameters observed in the cont

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 32. [mode_2_overgen] The strongest directly relevant evidence is for pelvic floor muscle training postpartum.

**Grading id:** `g32`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["exercise during the first year postpartum","pelvic floor disorders and diastasis recti outcomes","systematic review and meta-analysis"]

**Original chat question:** does postpartum yoga really help pelvic recovery women

**Claim under audit:**

> The strongest directly relevant evidence is for pelvic floor muscle training postpartum.

**Cited source ids:** 1, 7, 5

**Retrieved sources:**

**[1] ◀ CITED** What are the benefits of pelvic floor exercises postnatally?
DOI: `10.5281/zenodo.19065229`
> Pelvic floor exercises postnatally benefit women by improving urinary incontinence, muscle function, and well-being, although variations in study protocols highlight a need for tailored approaches.

**[2]** Pelvic floor muscle training for urinary incontinence postpartum.
_British journal of nursing (Mark Allen Publishing)_
DOI: `10.12968/bjon.2015.24.11.576`
> The offering of pelvic floor muscle exercises to all women during their first pregnancy is recommended by National Institute for Health and Care Excellence (NICE) guidelines. Pelvic floor muscles suffer significant trauma throughout pregnancy and childbirth, which may sometimes lead to urinary incontinence postpartum. However, it is uncertain how effective pelvic floor muscle exercises are in treating this incontinen

**[3]** Yoga Exercises Have an Effect on Accelerating the Recovery of Diastasis Recti Abdominis Muscles in Postpartum Women
_2026 · Women Midwives and Midwifery_
DOI: `10.36749/wmm.6.1.19-27.2026`
> Background: diastasis Recti Abdominis Muscle (DRAM), a condition characterized by the separation of the rectus abdominis muscles along the linea alba, commonly occurs postpartum and may impair quality of life. Yoga has been proposed as a non-invasive intervention to address this issue through core muscle engagement and tissue remodeling. Purpose: this study aims to determine the effectiveness of yoga in accelerating

**[4]** Effect of Yoga in Pregnancy on Maternal Pelvic Floor Distress Symptoms-A Randomised Control Study.
_2024 · International urogynecology journal_
DOI: `10.1007/s00192-024-05856-7`
> Pregnancy is associated with an increase in pelvic floor dysfunction. Yoga, an ancient Indian practice involving asanas (physical postures), pranayam (breathing patterns) and meditation, can help women to control their pelvic floor muscles. However, the literature to support yoga as a remedy for pelvic floor dysfunction is lacking. We hypothesized that yoga could be an important method in improving pelvic floor dysfu

**[5] ◀ CITED** The effect of combining post-partum yoga and pelvic floor training on life quality of post-partum mothers
_2024 · Jurnal Ners dan Kebidanan Indonesia_
DOI: `10.21927/jnki.2024.12(2).190-202`
> Background: Data from the World Health Organization (WHO) indicate that the postpartum phase has the highest rates of maternal death and morbidity. In the first year following childbirth, almost 50% of women experience mental health issues and declining life quality scores on the physical-emotional dimension significantly. Objectives: This study aims to determine the effect of the combination of postpartum yoga and p

**[6]** Effects of Pilates-Based Exercise on Diastasis Recti Abdominis, Pelvic Floor Function, and Musculoskeletal Pain Across the Perinatal Period: A Narrative Review
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.51.68441`
> Pregnancy and childbirth induce physiological changes affecting posture, abdominal wall integrity, and pelvic floor function. Diastasis recti abdominis affects up to 60% of women during pregnancy, pelvic floor dysfunction occurs in approximately 40% postpartum, and lumbopelvic pain persists in about 25% of women beyond early recovery. Pilates-based exercise offers an integrated approach combining breathing control, c

**[7] ◀ CITED** Impact of postpartum exercise on pelvic floor disorders and diastasis recti abdominis: a systematic review and meta-analysis
_2024 · British Journal of Sports Medicine_
DOI: `10.1136/bjsports-2024-108619`
> Objective To examine the effect of exercise during the first year postpartum on pelvic floor disorders and diastasis recti abdominis. Design Systematic review with random effects meta-analysis. Data sources: MEDLINE, EMBASE, CINAHL, SPORTDiscuss, Evidence-Based Medicine Reviews (Ovid), Scopus, Web of Science and ClinicalTrials.gov were searched until 12 January 2024. Eligibility criteria for selecting studies Studies

**[8]** The effect of post-natal exercises to strengthen the pelvic floor muscles.
_1996 · Acta obstetricia et gynecologica Scandinavica_
DOI: `10.3109/00016349609033336`
> The purpose of the present study was to evaluate the effect of post-natal pelvic floor muscle exercise. A prospective comparison design comprising 66 matched pairs (n=132) of mothers, divided into a training group (TG) and a control group (CG) was used. The TG attended an eight week special pelvic floor muscle exercise course, training in groups led by a physiotherapist 45 minutes once per week. In addition they exer

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 33. [mode_2_overgen] Foam rolling can help preserve performance after damaging exercise.

**Grading id:** `g33`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["after an intense exercise protocol designed to induce DOMS","recovery of dynamic performance measures","specific study population and protocol"]

**Original chat question:** How often should marathon runners use foam rollers?

**Claim under audit:**

> Foam rolling can help preserve performance after damaging exercise.

**Cited source ids:** 3, 6, 7

**Retrieved sources:**

**[1]** SHAREABLE RESOURCE
_2019 · Journal Article · ACSMʼs Health & Fitness Journal_
DOI: `10.1249/fit.0000000000000496`
> During this process, it is normal to feel some pain and sensitivity when foam rolling, but ideally the pain should be a 7 or 8 out of 10 in discomfort. Over time, the pain sensitivity will diminish if you practice consistently. HOW OFTEN? Foam rolling can be performed several times per week as needed or even several times per day once you develop the tissue tolerance. Regardless of which technique you use, focus on r

**[2]** THE IMPACT OF FOAM ROLLING ON MUSCLE RECOVERY AND PAIN RELIEF – A REVIEW ARTICLE
_2025 · Review · International Journal of Innovative Technologies in Social Science_
DOI: `10.31435/ijitss.2(46).2025.3323`
> The present review evaluates the impact of foam rolling on muscle recovery, with a particular focus on muscle strength, lactate clearance, range of motion, and delayed onset muscle soreness (DOMS). The analysis synthesizes findings from multiple studies, indicating that foam rolling may preserve muscle strength, reduce lactate accumulation, and alleviate DOMS following intense physical exertion. Evidence from various

**[3] ◀ CITED** A Meta-Analysis of the Effects of Foam Rolling on Performance and Recovery.
_2019 · Frontiers in physiology_
DOI: `10.3389/fphys.2019.00376`
> Foam rolling is thought to improve muscular performance and flexibility as well as to alleviate muscle fatigue and soreness. For this reason, foam rolling has become a popular intervention in all kinds of sport settings used to increase the efficiency of training or competition preparation as well as to speed post-exercise recovery. The objective of this meta-analysis was to compare the effects of foam rolling applie

**[4]** Latest Clinical Research Published by ACSM
_2014 · Journal Article · Current Sports Medicine Reports_
DOI: `10.1249/jsr.0000000000000030`
> Foam Rolling as a Recovery Tool following an Intense Bout of Physical Activity Despite foam rolling being a well-accepted modality that is used in exercise recovery, only three peer-reviewed research articles on the topic have been published to date. The purpose of this research article in the January 2014 edition of Medicine & Science in Sports & Exercise® was to substantiate if foam rolling was an effective tool th

**[5]** Effects of Acute Foam Rolling on Quadriceps Performance and Short-term Recovery from Fatigue
_2017 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/01.mss.0000519938.36424.1a`
> Foam rolling is a common technique among fitness professionals and athletes. However, the effect of this technique on performance and short-term recovery remains unclear. PURPOSE: To examine the effects of acute foam rolling on quadriceps performance and short-term recovery from exercise-induced fatigue. METHODS: 10 recreationally active, right leg dominant, male university students (height: 173 ± 0.70cm, mass: 70.81

**[6] ◀ CITED** Foam Rolling for Delayed-Onset Muscle Soreness and Recovery of Dynamic Performance Measures
_2015 · Journal of Athletic Training_
DOI: `10.4085/1062-6050-50.1.01`
> Context: After an intense bout of exercise, foam rolling is thought to alleviate muscle fatigue and soreness (ie, delayed-onset muscle soreness [DOMS]) and improve muscular performance. Potentially, foam rolling may be an effective therapeutic modality to reduce DOMS while enhancing the recovery of muscular performance. Objective: To examine the effects of foam rolling as a recovery tool after an intense exercise pro

**[7] ◀ CITED** Foam rolling is an effective recovery tool in trained distance runners
_2020 · Article · Sport sciences for health_
DOI: `10.1007/s11332-019-00580-y`
> Foam rolling (FR) is a recovery technique that may be effective in mitigating DOMS while also attenuating decreases in performance. In a recent study, strength-trained men completed either a FR sequence or no recovery after a damaging eccentric squat protocol [ ]. The participants in the FR group had less soreness and had preserved range of motion, dynamic movement, and muscle activation relative to the control group

**[8]** The Impact of Foam Rolling on Recovery and Performance Components (ROM, Strength, Jump, Agility): A Systematic Review
_2025 · Review · Pamukkale Journal of Sport Sciences_
DOI: `10.54141/psbd.1595606`
> Foam rolling has emerged as one of the most popular recovery methods in recent years. This study aims to evaluate the effects of foam rolling on the recovery process and various performance parameters in athletes and healthy active individuals. This research is a systematic review that analyzes randomized controlled trials published in English between January 2014 and March 2024, accessed through electronic databases

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 34. [mode_2_overgen] Intense training and low energy availability are linked to menstrual irregularities.

**Grading id:** `g34`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["female athletes","intense exercise","female athlete triad/eating disorders context"]

**Original chat question:** hormone changes female athletes

**Claim under audit:**

> Intense training and low energy availability are linked to menstrual irregularities.

**Cited source ids:** 2, 4, 5, 6

**Retrieved sources:**

**[1]** Sex hormones and injury in female athletes
_2025 · International Journal of Bone Fragility_
DOI: `10.57582/ijbf.250503.100`
> Background: Sex hormones regulate musculoskeletal tissue properties, influencing bone and muscle health, and injury risk and recovery in female athletes. Hormonal fluctuations during the menstrual cycle, pregnancy, and menopause affect tissue homeostasis and injury susceptibility. Purpose: This narrative review synthesizes current evidence on the effects of oestrogens, androgens and progestogens on musculoskeletal he

**[2] ◀ CITED** The effects of intense exercise on the female reproductive system
_2001 · Journal of Endocrinology_
DOI: `10.1677/joe.0.1700003`
> Women have become increasingly physically active in recent decades. While exercise provides substantial health benefits, intensive exercise is also associated with a unique set of risks for the female athlete. Hypothalamic dysfunction associated with strenuous exercise, and the resulting disturbance of GnRH pulsatility, can result in delayed menarche and disruption of menstrual cyclicity. Specific mechanisms triggeri

**[3]** Reproductive hormones and menstrual changes with exercise in female athletes.
_1995 · Sports medicine (Auckland, N.Z.)_
DOI: `10.2165/00007256-199519040-00005`
> The endocrine equilibrium which regulates reproductive function in women can be affected by physical and psychological factors. Blood levels of hormones depend on a balance between production, metabolism and clearance rates. Intensive physical exercise may affect this balance via different mechanisms, such as stress associated with competition, dieting, reduction of body fat and body weight, production of heat or hyp

**[4] ◀ CITED** Exercise-induced endocrine pathologies
_2003 · Journal of Endocrinological Investigation_
DOI: `10.1007/bf03345238`
> There has been a substantial increase in women practicing sports over the past 30 yr. While exercise provides many health benefits, there appears to be a unique set of risks associated with intense exercise for the female athlete. The female athlete triad encompasses these risks, including amenorrhea, osteoporosis and eating disorders. The incidence of menstrual irregularities including primary and secondary amenorrh

**[5] ◀ CITED** Endocrine Disorders in Adolescent and Young Female Athletes: Impact on Growth, Menstrual Cycles, and Bone Mass Acquisition
_2014 · The Journal of Clinical Endocrinology &amp; Metabolism_
DOI: `10.1210/jc.2013-3030`
> Context: Puberty is a crucial period of dramatic hormonal changes, accelerated growth, attainment of reproductive capacity, and acquisition of peak bone mass. Participation in recreational physical activity is widely acknowledged to provide significant health benefits in this period. Conversely, intense training imposes several constraints, such as training stress and maintenance of very low body fat to maximize perf

**[6] ◀ CITED** Effects of exercise training on the menstrual cycle
_1990 · Medicine &amp; Science in Sports &amp; Exercise_
DOI: `10.1249/00005768-199006000-00001`
> This review evaluates the status of the evidence that exercise training affects the menstrual cycle beginning with evidence for the existence of delayed menarche, amenorrhea, and luteal suppression in athletes. A later age of menarche and a higher prevalence of amenorrhea and luteal suppression have been observed in athletes, but there is no experimental evidence that athletic training delays menarche, and alternativ

**[7]** The Impact of Intensive Physical Training on the Functioning of the Hypothalamic–Pituitary–Ovarian Axis in Female Athletes
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.54.70754`
> Background Intensive physical training plays a crucial role in improving physical fitness and athletic performance; however, in female athletes it may also disrupt hormonal balance, particularly within the hypothalamic–pituitary–ovarian (HPO) axis. These disturbances are often associated with low energy availability and may lead to significant reproductive and systemic health consequences. Aim The aim of this review

**[8]** [Intensive training and menstrual disorders in young female: Impact on bone mass].
_2016 · Gynecologie, obstetrique &amp; fertilite_
DOI: `10.1016/j.gyobfe.2016.09.001`
> Participation in recreational physical activity is widely acknowledged to provide significant health benefits. Conversely, intense training imposes several constraints, such as intermittent or chronic metabolic and psychogenic training stressors and maintenance of very low body fat to maximize performance. Adolescent and adult athletic women are therefore at risk of overtraining and/or poor dietary intake, which may

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 35. [mode_2_overgen] Another trial in women with levator ani avulsion tested postpartum muscle training with im…

**Grading id:** `g35`
**LLM judge verdict:** `mode_2_overgen`
**Qualifier diff:** ["population: postpartum patients with avulsion of the puborectal portion of the levator ani muscle","study design: parallel randomized controlled trial","intervention: physiotherapy with postpartum muscle training","imaging outcomes: 3/4D transperineal ultrasound pelvic floor morphology"]

**Original chat question:** optimal timing and duration for postpartum pelvic floor muscle training to improve levator ani muscle recovery

**Claim under audit:**

> Another trial in women with levator ani avulsion tested postpartum muscle training with imaging outcomes.

**Cited source ids:** 1, 4, 5, 6, 7

**Retrieved sources:**

**[1] ◀ CITED** The Effects of Pelvic Floor Muscle Training Applied via Telerehabilitation During the Postpartum Period: A Randomized Controlled Study
_2025 · Telemedicine and e-Health_
DOI: `10.1089/tmj.2024.0540`
> Purpose: To examine the short- and medium-term effects of pelvic floor muscle training (PFMT) applied via telerehabilitation (TR) on pelvic floor muscle function, pelvic floor symptoms, and quality of life. Methods: Fifty-eight women between the ages of 18 and 35 who were between 6 and 8 weeks postpartum were included. The participants were randomized into the PFMT applied via TR (TR-PFMT) group or the supervised PFM

**[2]** How important is the timing and duration of pelvic floor muscle training for preventing postpartum urinary incontinence? a meta-analysis.
_2026 · International urology and nephrology_
DOI: `10.1007/s11255-025-04640-w`
> Postpartum urinary incontinence (PUI) is a common condition that significantly impairs the quality of life for women who have given birth. This meta-analysis aimed to systematically evaluate how the timing and duration of pelvic floor muscle training (PFMT) influence the prevention of PUI. To identify relevant studies examining the role of PFMT in preventing PUI, a thorough literature search was conducted across mult

**[3]** Restoration of bladder neck activity and levator hiatus dimensions in Asian primipara: a prospective study.
_2023 · Journal of obstetrics and gynaecology : the journal of the Institute of Obstetrics and Gynaecology_
DOI: `10.1080/01443615.2023.2173564`
> Pelvic floor muscle training (PFMT) reduces the symptoms in women with pelvic floor dysfunction (PFD); however, the optimal initial timing for secondary prevention of PFD by PFMT is not clear. To identify the optimal timing in Asian primiparas with vaginal delivery, bladder neck descent (BND), levator hiatus areas, and levator hiatus distensibility and contractility were assessed in 26 nulliparous women at 36 weeks o

**[4] ◀ CITED** Quantification of 3/4D ultrasound pelvic floor changes induced by postpartum muscle training in patients with levator ani muscle avulsion: a parallel randomized controlled trial.
_2022 · Quantitative imaging in medicine and surgery_
DOI: `10.21037/qims-21-877`
> We believe that physiotherapy with muscle training (MT) of the postpartum pelvic floor may lead to a change in the clinical management of patients with avulsion of the puborectal portion of the levator ani muscle (LAM). Our objective is to assess whether physiotherapy with MT of the postpartum pelvic floor in patients with LAM avulsion produces changes in pelvic floor morphology evaluated by 3/4D transperineal ultras

**[5] ◀ CITED** Enhancement of Levator Ani Muscle Strength in Postpartum Women: The Impact of Pelvic Floor Muscle Training.
_2024 · Medical science monitor : international medical journal of experimental and clinical research_
DOI: `10.12659/MSM.942758`
> BACKGROUND Levator ani muscle injuries during vaginal childbirth can lead to pelvic organ prolapse (POP). Pelvic floor muscle training (PFMT) is an effective conservative approach to alleviate these symptoms. This study aimed to compare outcomes with and without 3 months of PFMT in 34 women with levator ani muscle injury following vaginal delivery. MATERIAL AND METHODS In a quasi-experimental study, 34 postpartum wom

**[6] ◀ CITED** [Postpartum pelvic floor muscle training and abdominal rehabilitation: Guidelines].
_2015 · Journal de gynecologie, obstetrique et biologie de la reproduction_
DOI: `10.1016/j.jgyn.2015.09.023`
> Provide guidelines for clinical practice concerning postpartum rehabilitation. Systematically review of the literature concerning postpartum pelvic floor muscle training and abdominal rehabilitation. Pelvic-floor rehabilitation using pelvic floor muscle contraction exercises is recommended to treat persistent urinary incontinence at 3 months postpartum (grade A), regardless of the type of incontinence. At least 3 gui

**[7] ◀ CITED** The effect of postpartum pelvic floor muscle exercise in the prevention and treatment of urinary incontinence
_1997 · International Urogynecology Journal_
DOI: `10.1007/bf02765817`
> The aim of this study was to evaluate the effect of postpartum pelvic floor muscle exercise in the prevention and treatment of urinary incontinence. A prospective comparison design of 99 matched pairs (n= 198) of mothers, a training group and a control group, was used. Eight weeks postpartum the training group attended an 8-week intensive pelvic floor muscle exercise course, training in groups led by a physical thera

**[8]** Device-assisted pelvic floor muscle postpartum exercise programme for the management of pelvic floor dysfunction after delivery
_2020 · The Journal of Maternal-Fetal &amp; Neonatal Medicine_
DOI: `10.1080/14767058.2020.1723541`
> Pelvic floor dysfunction (PFD) is a multifactorial condition that clinically manifests as the pelvic prolapse, urinary and/or rectal incontinence, and sexual dysfunction.We aimed to evaluate the efficacy of two pelvic floor trainers for the prevention of PFD in women during the postpartum period.This was a prospective, randomized, open-label study in 70 women in the postpartum period. Participants were randomized to

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

# correct control (LLM-flagged well-grounded)

## 36. [correct] Other trials started around 6–8 weeks postpartum or later.

**Grading id:** `g36`
**LLM judge verdict:** `correct`

**Original chat question:** optimal duration and timing of pelvic floor muscle training postpartum for improving muscle function

**Claim under audit:**

> Other trials started around 6–8 weeks postpartum or later.

**Cited source ids:** 3, 2, 6

**Retrieved sources:**

**[1]** How important is the timing and duration of pelvic floor muscle training for preventing postpartum urinary incontinence? a meta-analysis.
_2026 · International urology and nephrology_
DOI: `10.1007/s11255-025-04640-w`
> Postpartum urinary incontinence (PUI) is a common condition that significantly impairs the quality of life for women who have given birth. This meta-analysis aimed to systematically evaluate how the timing and duration of pelvic floor muscle training (PFMT) influence the prevention of PUI. To identify relevant studies examining the role of PFMT in preventing PUI, a thorough literature search was conducted across mult

**[2] ◀ CITED** The Effects of Pelvic Floor Muscle Training Applied via Telerehabilitation During the Postpartum Period: A Randomized Controlled Study
_2025 · Telemedicine and e-Health_
DOI: `10.1089/tmj.2024.0540`
> Purpose: To examine the short- and medium-term effects of pelvic floor muscle training (PFMT) applied via telerehabilitation (TR) on pelvic floor muscle function, pelvic floor symptoms, and quality of life. Methods: Fifty-eight women between the ages of 18 and 35 who were between 6 and 8 weeks postpartum were included. The participants were randomized into the PFMT applied via TR (TR-PFMT) group or the supervised PFM

**[3] ◀ CITED** [Postpartum pelvic floor muscle training and abdominal rehabilitation: Guidelines].
_2015 · Journal de gynecologie, obstetrique et biologie de la reproduction_
DOI: `10.1016/j.jgyn.2015.09.023`
> Provide guidelines for clinical practice concerning postpartum rehabilitation. Systematically review of the literature concerning postpartum pelvic floor muscle training and abdominal rehabilitation. Pelvic-floor rehabilitation using pelvic floor muscle contraction exercises is recommended to treat persistent urinary incontinence at 3 months postpartum (grade A), regardless of the type of incontinence. At least 3 gui

**[4]** Restoration of bladder neck activity and levator hiatus dimensions in Asian primipara: a prospective study.
_2023 · Journal of obstetrics and gynaecology : the journal of the Institute of Obstetrics and Gynaecology_
DOI: `10.1080/01443615.2023.2173564`
> Pelvic floor muscle training (PFMT) reduces the symptoms in women with pelvic floor dysfunction (PFD); however, the optimal initial timing for secondary prevention of PFD by PFMT is not clear. To identify the optimal timing in Asian primiparas with vaginal delivery, bladder neck descent (BND), levator hiatus areas, and levator hiatus distensibility and contractility were assessed in 26 nulliparous women at 36 weeks o

**[5]** The effect of postpartum pelvic floor muscle exercise in the prevention and treatment of urinary incontinence.
_1997 · International urogynecology journal and pelvic floor dysfunction_
DOI: `10.1007/BF02765817`
> The aim of this study was to evaluate the effect of postpartum pelvic floor muscle exercise in the prevention and treatment of urinary incontinence. A prospective comparison design of 99 matched pairs (n= 198) of mothers, a training group and a control group, was used. Eight weeks postpartum the training group attended an 8-week intensive pelvic floor muscle exercise course, training in groups led by a physical thera

**[6] ◀ CITED** Is home-based pelvic floor muscle training effective in treatment of urinary incontinence after birth in primiparous women? A randomized controlled trial.
_2013 · Acta obstetricia et gynecologica Scandinavica_
DOI: `10.1111/aogs.12173`
> To assess the effect of pelvic floor muscle training (PFMT) on pelvic floor muscle strength and urinary incontinence (UI) in primiparous women who underwent a home training program between three and 9 months after delivery. Randomized controlled trial. One hundred primiparous women were consecutively recruited from four different antenatal clinics in the urban area of Stockholm, Sweden. Women with UI who had undergon

**[7]** Postpartum sexual function of women and the effects of early pelvic floor muscle exercises
_2010 · Acta Obstetricia et Gynecologica Scandinavica_
DOI: `10.3109/00016341003801623`
> Abstract Objective. To evaluate the effects of early pelvic floor muscle training after vaginal delivery on sexual function. Design . Prospective randomized study. Settings . Urogynecology clinic of a tertiary medical center in Istanbul, Turkey. Population . Total of 75 primiparous women. Methods. Pelvic floor‐muscle strength was assessed during rest and straining in primiparous women in their 4th postpartum month, a

**[8]** A randomized controlled trial of pelvic floor muscle exercises to treat postnatal urinary incontinence
_1998 · International Urogynecology Journal and Pelvic Floor Dysfunction_
DOI: `10.1007/bf01901501`
> A randomized controlled trial was carried out to evaluate the extent to which a program of reinforced pelvic floor muscle exercises (PFME) reduces urinary incontinence 1 year after delivery. Two hundred and thirty women who were incontinent 3 months postpartum were randomized to either a control group doing standard postnatal pelvic floor muscle exercises (n = 117) or to an intervention group (n = 113) who saw a phys

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 37. [correct] In a 6-week trial in healthy young men and women, krill oil increased immune markers after…

**Grading id:** `g37`
**LLM judge verdict:** `correct`

**Original chat question:** how much krill oil is effective for power training

**Claim under audit:**

> In a 6-week trial in healthy young men and women, krill oil increased immune markers after exercise, but did not modify exercise performance.

**Cited source ids:** 5

**Retrieved sources:**

**[1]** The Effects of Krill Oil on mTOR Signaling and Resistance Exercise: A Pilot Study
_2018 · Journal of Nutrition and Metabolism_
DOI: `10.1155/2018/7625981`
> Introduction Krill oil supplementation has been shown to improve postexercise immune function; however, its effect on muscle hypertrophy is currently unknown. Therefore, the aim of present study was to investigate the ability of krill oil to stimulate mTOR signaling and its ability to augment resistance training-induced changes in body composition and performance. Methods C2C12 myoblasts cells were stimulated with kr

**[2]** Impact of Antarctic krill oil supplementation on skeletal muscle injury recovery after resistance exercise
_2022 · European Journal of Nutrition_
DOI: `10.1007/s00394-022-03077-6`
> <h4>Background</h4>Antarctic krill oil (KO) is a natural source of n-3 polyunsaturated fatty acids (n-3 PUFAs), and is rich in phospholipids, Eicosapentaenoic acid (EPA), Docosahexaenoic acid (DHA), astaxanthin, flavonoids, vitamins, trace elements, and other bioactive substances. KO has been confirmed to have anti-inflammatory and immunomodulatory effects. n-3 PUFAs also have been purported to improve the recovery o

**[3]** The effect of krill oil supplementation on skeletal muscle function and size in older adults: A randomised controlled trial.
_2022 · Journal Article, Randomized Controlled Trial, Research Support, Non-U.S. Gov't · Clinical nutrition (Edinburgh, Scotland)_
DOI: `10.1016/j.clnu.2022.04.007`
> A total of 102 men and women were enrolled in the study. Ninety-four participants (krill group (26 women and 23 men) and placebo group (27 women and 18 men)) completed the study (mean (SD): age 71.2 (5.1) years and weight 71.8 (12.3) kg). Six months supplementation with krill oil resulted in, an increase in knee extensor maximal torque, grip strength and vastus lateralis muscle thickness, relative to control (p<0.05)

**[4]** Effects of Krill Oil and Race Distance on Serum Choline and Choline Metabolites in Triathletes: A Field Study.
_2020 · Journal Article · Frontiers in nutrition_
DOI: `10.3389/fnut.2020.00133`
> Choline is an essential nutrient that has been implicated in athletic performance due to its role in maintaining normal muscle function. The concentration of free choline in serum may decrease during long-distance high-intensity exercise, yet few nutritional strategies to counteract this potentially performance-depleting loss in choline have been investigated outside the laboratory. This exploratory field study was p

**[5] ◀ CITED** The Effect of Krill Oil Supplementation on Exercise Performance and Markers of Immune Function
_2015 · Journal Article · PLoS ONE_
DOI: `10.1371/journal.pone.0139174`
> Six weeks of krill oil supplementation can increase PBMC IL-2 production and NK cell cytotoxic activity 3h post-exercise in both healthy young males and females. Krill oil does not modify exercise performance.

**[6]** Long Term Outcomes in Patients with the Coronary Slow Flow Phenomenon
_2013 · Heart, Lung and Circulation_
DOI: `10.1016/j.hlc.2013.05.522`
> submission to the US Food and Drug Administration for GRAS registration was also assessed. A survey of krill and fish oil prices at a pharmacy chain was conducted on 01/02/2013. Results: The active components of krill and fish oil are the omega-3 fatty acids eicosapentaenoic acid (EPA) and docosahexaenoic acid (DHA) which are derived from algae. Fish oil is almost entirely composed of EPA-DHA from triglycerides, wher

**[7]** Similar eicosapentaenoic acid and docosahexaenoic acid plasma levels achieved with fish oil or krill oil in a randomized double-blind four-week bioavailability study
_2015 · Lipids in Health and Disease_
DOI: `10.1186/s12944-015-0109-z`
> Long-chain n-3 polyunsaturated fatty acids (LC n-3-PUFA), docosahexaenoic acid (DHA) and eicosapentaenoic acid (EPA) provide multiple health benefits for heart, brain and eyes. However, consumption of fatty fish, the main source of LC n-3-PUFAs is low in Western countries. Intakes of LC n-3-PUFA can be increased by taking dietary supplements, such as fish oil, algal oil, or krill oil. Recently, conflicting informatio

**[8]** Bioavailability of fatty acids from krill oil, krill meal and fish oil in healthy subjects–a randomized, single-dose, cross-over trial
_2015 · Lipids in Health and Disease_
DOI: `10.1186/s12944-015-0015-4`
> Krill contains two marine omega-3 polyunsaturated fatty acids, eicosapentaenoic acid (EPA) and docosahexaenoic acid (DHA), mainly bound in phospholipids. Typical products from krill are krill oil and krill meal. Fish oils contain EPA and DHA predominantly bound in triglycerides. The difference in the chemical binding of EPA and DHA has been suggested to affect their bioavailability, but little is known on bioavailabi

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 38. [correct] Study-protocol variation points toward a need for tailored approaches.

**Grading id:** `g38`
**LLM judge verdict:** `correct`

**Original chat question:** does tailored postpartum care improve pelvic muscle recovery?

**Claim under audit:**

> Study-protocol variation points toward a need for tailored approaches.

**Cited source ids:** 1

**Retrieved sources:**

**[1] ◀ CITED** What are the benefits of pelvic floor exercises postnatally?
DOI: `10.5281/zenodo.19065229`
> Pelvic floor exercises postnatally benefit women by improving urinary incontinence, muscle function, and well-being, although variations in study protocols highlight a need for tailored approaches.

**[2]** Pelvic floor muscle training for urinary incontinence postpartum.
_British journal of nursing (Mark Allen Publishing)_
DOI: `10.12968/bjon.2015.24.11.576`
> The offering of pelvic floor muscle exercises to all women during their first pregnancy is recommended by National Institute for Health and Care Excellence (NICE) guidelines. Pelvic floor muscles suffer significant trauma throughout pregnancy and childbirth, which may sometimes lead to urinary incontinence postpartum. However, it is uncertain how effective pelvic floor muscle exercises are in treating this incontinen

**[3]** Effectiveness of Exercise-based Interventions on Pelvic Floor Function in Postpartum Women: A Literature Review
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.50.67975`
> Background. Pregnancy and childbirth are major risk factors for postpartum pelvic floor dysfunction, including urinary and anal incontinence and pelvic organ prolapse. Although pelvic floor muscle training (PFMT) is widely recommended as first-line management, its benefits appear predominantly short-term and functional. Aim. To synthesize evidence on the effectiveness and limitations of exercise-based interventions,

**[4]** Pelvic floor muscle training after childbirth: A systematic review
_2025 · AG Editor (Argentina)_
DOI: `10.56294/saludcyt20251234`
> Introduction: the training of pelvic floor muscles is a recommended strategy to improve the quality of life in postpartum women, addressing common issues such as urinary incontinence and pelvic organ prolapse. This systematic review evaluated the effectiveness of various interventions, including supervised programs, biofeedback, electrical stimulation, and core stabilization exercises.Methods: thirteen studies were i

**[5]** Effectiveness of telehealth pelvic-abdominal mechanics training rehabilitation program for pelvic floor rehabilitation in puerperal women: a randomized controlled study
_2025 · European Journal of Physical and Rehabilitation Medicine_
DOI: `10.23736/s1973-9087.25.08971-3`
> There are still numerous barriers to the implementation of pelvic floor muscle training (PFMT), though it has been the first-line treatment for pelvic floor dysfunction (PFD) in puerperal women. The construction of telehealth pelvic floor rehabilitation program that is both fun and accessible is necessary.To assess the efficacy of telehealth pelvic-abdominal mechanics rehabilitation training program for pelvic floor

**[6]** Impact of pelvic floor muscle training in the postpartum period.
_2016 · International urogynecology journal_
DOI: `10.1007/s00192-015-2822-6`
> Our study piloted a novel, two-tiered approach to delivering pelvic floor muscle training (PFMT) to postpartum women involving a standardized group workshop followed by the opportunity to self-select for individual PFMT sessions. The aim of the study was to evaluate the outcomes in women who self-selected for individual PFMT using validated quality of life (QoL) questionnaires, the Pelvic Floor Distress Inventory-20

**[7]** The effect of a comprehensive care and rehabilitation program on enhancing pelvic floor muscle functions and preventing postpartum stress urinary incontinence.
_2019 · Medicine_
DOI: `10.1097/MD.0000000000016907`
> This study was to investigate the incidence and the risk factors of postpartum stress urinary incontinence (SUI), and the effect of comprehensive care and rehabilitation program (CCRP) on preventing postpartum SUI.In stage I, 479 puerperae were recruited within 1 week postpartum, then the postpartum SUI incidence at 8th week and its risk factors were investigated. In stage II, 240 vaginal delivery puerperae were enro

**[8]** The Effects of Pelvic Floor Muscle Training Applied via Telerehabilitation During the Postpartum Period: A Randomized Controlled Study
_2025 · Telemedicine and e-Health_
DOI: `10.1089/tmj.2024.0540`
> Purpose: To examine the short- and medium-term effects of pelvic floor muscle training (PFMT) applied via telerehabilitation (TR) on pelvic floor muscle function, pelvic floor symptoms, and quality of life. Methods: Fifty-eight women between the ages of 18 and 35 who were between 6 and 8 weeks postpartum were included. The participants were randomized into the PFMT applied via TR (TR-PFMT) group or the supervised PFM

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 39. [correct] The repeated bout effect can persist for at least 6 months in most criterion measures.

**Grading id:** `g39`
**LLM judge verdict:** `correct`

**Original chat question:** repeated bout effect removal

**Claim under audit:**

> The repeated bout effect can persist for at least 6 months in most criterion measures.

**Cited source ids:** 7, 1, 3

**Retrieved sources:**

**[1] ◀ CITED** The effect of velocity of contraction on the repeated bout effect
_University of Saskatchewan Library_
> The 'repeated bout effect'(RBE) is an adaptation whereby a single eccentric (ECC) exercise session protects against muscle damage during subsequent ECC exercise bouts and is characterized by faster strength recovery and a reduction in soreness and inflammation. The purpose was to determine if the protective capacity of the RBE is greater when both bouts of ECC exercise are performed at the same compared to a differen

**[2]** Muscle damage and inflammation after eccentric exercise: Can the repeated bout effect be removed?
_2015 · Physiological Reports_
DOI: `10.14814/phy2.12648.`
> The current consensus in exercise physiology is that the repeated bout effect always appears after few eccentric exercise sessions. This is the first attempt to challenge this tenet, by exploiting specificity in muscle plasticity. More specifically, we examined whether the opposing adaptations in muscle induced after concentric and eccentric exercise can attenuate and/or remove the repeated bout effect. Seventeen you

**[3] ◀ CITED** Repeated Bout Effect in Muscle-Specific Exercise Variations
_2015 · The Journal of Strength and Conditioning Research_
DOI: `10.1519/jsc.0000000000000856`
> A single bout of unaccustomed exercise confers protective effect against muscle damage from a subsequent bout of similar activity, that is, repeated bout effect (RBE). It remains unknown whether varying muscle-specific exercise between sessions alters the magnitude of the RBE. This study examined the effects of muscle-specific exercise variation between consecutive sessions on the RBE. Twenty untrained males (21 ± 2

**[4]** Efficacy of Prior Eccentric Exercise in Attenuating Impaired Exercise Performance After Muscle Injury in Resistance Trained Men
_2007 · Journal Article · The Journal of Strength and Conditioning Research_
DOI: `10.1519/r-21406.1`
> Previous research has demonstrated that prior exercise may reduce the magnitude of muscle soreness and impaired function (i.e., repeated bout effect [RBE]) observed during subsequent eccentric exercise. Previous investigations have predominantly used research designs that include single-joint exercise performed by untrained individuals. It is unknown how resistance trained individuals respond to novel multi-joint ecc

**[5]** Effect of Arm Eccentric Exercise on Muscle Damage of the Knee Flexors After High-Intensity Eccentric Exercise.
_2021 · Journal Article · Frontiers in physiology_
DOI: `10.3389/fphys.2021.661618`
> Repeated bout effect (RBE) describes a phenomenon that an initial unaccustomed eccentric exercise (ECC) bout can confer a protective effect against muscle damage from the subsequent same exercise. This protection has been observed in the same muscle, as well as the contralateral homologous (CL-RBE) muscle. But it is unknown whether the RBE is evident for non-local unrelated heterogonous muscles. The purpose of this s

**[6]** Adaptation to Damaging Dance and Repeated-Sprint Activity in Women
_2016 · Journal of Strength and Conditioning Research_
DOI: `10.1519/JSC.0000000000001346`
> Exercise-induced muscle damage (EIMD) is associated with many sport and exercise activities. This manifests as muscle soreness, inflammation, and detriments in muscle functionality which can reduce subsequent performance potential . Attenuating the symptoms and/or enhancing recovery from EIMD are therefore highly desirable in physically active populations. Despite these potential issues, skeletal muscle has the abili

**[7] ◀ CITED** How long does the protective effect on eccentric exercise-induced muscle damage last?
_2001 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1097/00005768-200109000-00011`
> These results show that the repeated bout effect for most of the criterion measures lasts at least 6 months but is lost between 9 and 12 months.

**[8]** The Repeated Bout Effect In Ipsilateral And Contralateral Limbs After Single Bouts Of Lengthening Contractions
_2005 · Journal Article · Medicine & Science in Sports & Exercise_
DOI: `10.1249/00005768-200505001-01635`
> A single bout of lengthening contractions can result in profound adaptations known as the repeated bout effect (RBE), which has been shown to protect skeletal muscle from subsequent insults of lengthening contractions. Chronic eccentric training has been shown to produce neuromuscular adaptations in the untrained homologous muscle, making the expectation tenable that acute bouts of eccentric contractions would evoke

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 40. [correct] Vaginal cones have been studied for postpartum pelvic-floor conditioning.

**Grading id:** `g40`
**LLM judge verdict:** `correct`

**Original chat question:** Is vaginal vibration cone therapy effective for postpartum dyspareunia in women?

**Claim under audit:**

> Vaginal cones have been studied for postpartum pelvic-floor conditioning.

**Cited source ids:** 2, 7

**Retrieved sources:**

**[1]** Postpartum dyspareunia: clinical evaluation, causes, and treatment outcomes.
_2023 · The journal of sexual medicine_
DOI: `10.1093/jsxmed/qdac040`
> Dyspareunia affects approximately half of postpartum women and is attributed to multiple factors. Despite its high prevalence and resultant negative effects, data are lacking regarding the causes and different pain components, the usefulness of recommended treatments, and the prognosis. To evaluate causes of postpartum dyspareunia, targeted treatment modalities, and their effectiveness. A retrospective observational

**[2] ◀ CITED** Postpartum pelvic floor conditioning using vaginal cones: not only for prophylaxis against urinary incontinence and descensus.
_1996 · International urogynecology journal and pelvic floor dysfunction_
DOI: `10.1007/BF01907074`
> Seventy-one women were examined 6-8 weeks after spontaneous delivery by pelvic floor (PF) palpation, inspection, manometry and gravimetry. Re-examination was performed in the same way after 4-6 weeks of daily cone training. Control groups included 20 women prior to and after conventional puerperal exercises, and 8 nulliparae prior to and after the same cone training, using a five-cone set. The number of puerperae not

**[3]** Effect of transcutaneous electrical nerve stimulation on the postpartum dyspareunia treatment.
_2011 · The journal of obstetrics and gynaecology research_
DOI: `10.1111/j.1447-0756.2010.01425.x`
> This article will evaluate the safety and efficacy of intravaginal transcutaneous electrical nerve stimulation (TENS) for the treatment of vulvar pain and dyspareunia during the postpartum period related to perineal trauma caused by episiotomy. From January 2007 to January 2009, 45 women presenting with postpartum dyspareunia related to perineal trauma after a vaginal delivery were educated on the importance of the p

**[4]** Effect of intravaginal vibratory versus electric stimulation on the pelvic floor muscles: A randomized clinical trial
_2019 · European Journal of Obstetrics &amp; Gynecology and Reproductive Biology: X_
DOI: `10.1016/j.eurox.2019.100022`
> According to the International Urogynecological Association and International Continence Society people with normal pelvic floor muscle function should have the ability to voluntarily and involuntarily contract and relax these muscles. However, many women are unaware of their pelvic floor, and it is estimated that about 30-50% do not know how to actively contract these muscles. Within this context, therapeutic strate

**[5]** Testing And Training Of The Pelvic Floor Muscles After Childbirth
_1989 · Acta Obstetricia et Gynecologica Scandinavica_
DOI: `10.3109/00016348909028662`
> In a prospective study of 83 women, two different physiotherapy methods for strengthening the pelvic floor muscles after childbirth were evaluated. The training program was carried out by the patients at home for 12 weeks, starting 8 weeks after spontaneous uneventful delivery. Forty‐two women did pelvic floor exercises in accordance with the method presented by Kegel (1). Forty‐one women used standard vaginal cones

**[6]** Evaluating the Effectiveness of Radiofrequency in Multimodal Physiotherapy for Postpartum Pelvic Pain: The RASDOP Protocol-A Mixed-Methods Study.
_2025 · Journal Article · Journal of clinical medicine_
DOI: `10.3390/jcm14051489`
> Background/Objectives : Approximately 30% of women experience pelvic pain one year after vaginal delivery, and this increases to 50% during vaginal intercourse. Multimodal physiotherapy is the first-line treatment for myofascial pain of the pelvic floor muscles (PFM), often incorporating emerging technologies like radiofrequency, despite limited evidence supporting its use. The RASDOP study aims to (i) evaluate the e

**[7] ◀ CITED** A randomized prospective study comparing new vaginal cone and FES-Biofeedback.
_2004 · Clinical Trial, Comparative Study, Journal Article, Multicenter Study, Randomized Controlled Trial · Yonsei medical journal_
DOI: `10.3349/ymj.2004.45.5.879`
> In conclusion, no significant differences in the therapeutic effects were observed between the FES- Biofeedback and the new vaginal cone groups. Considering improvements in the quality of life and objective symptoms, the therapeutic effects of the two techniques showed no significant differences. The new vaginal cone is relatively easy to use at home and aids in pelvic floor muscle exercises. Consequently, the new va

**[8]** Role of Radiofrequency (Votiva, InMode) in Pelvic Floor Restoration
_2019 · Plastic and Reconstructive Surgery - Global Open_
DOI: `10.1097/gox.0000000000002203`
> Background: Postpartum pelvic floor disorders are estimated to impact 24% of women in the United States. This study describes the use of a radiofrequency device (Votiva, InMode) for postpartum pelvic floor restoration using an electrostimulator to objectively measure treatment effect. Methods: A retrospective evaluation was conducted between April 2017 and May 2018 of consecutive patients undergoing vaginal radiofreq

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 41. [correct] A 2024 systematic review/meta-analysis examined exercise in the first postpartum year for …

**Grading id:** `g41`
**LLM judge verdict:** `correct`

**Original chat question:** postpartum exercise effects on pelvic floor disorders and diastasis recti abdominis in women

**Claim under audit:**

> A 2024 systematic review/meta-analysis examined exercise in the first postpartum year for pelvic floor disorders and diastasis recti abdominis.

**Cited source ids:** 2

**Retrieved sources:**

**[1]** A Supervised Pelvic Floor Training Program Has Minimal Effect on the Prevalence of Postpartum Diastasis Recti Abdominis: A Critically Appraised Paper
_Human Kinetics_
DOI: `10.1123/ijatt.2019-0112`
> Focused Clinical Question: For postpartum primiparous women, will a 16-week, supervised, targeted pelvic floor muscle training program result in a reduced prevalence of diastasis recti abdominis versus education only at discharge? Clinical Bottom Line: We can neither recommend nor caution against a targeted pelvic floor muscle training program to reduce the prevalence of postpartum diastasis recti abdominis.

**[2] ◀ CITED** Impact of postpartum exercise on pelvic floor disorders and diastasis recti abdominis: a systematic review and meta-analysis
_2024 · British Journal of Sports Medicine_
DOI: `10.1136/bjsports-2024-108619`
> Objective To examine the effect of exercise during the first year postpartum on pelvic floor disorders and diastasis recti abdominis. Design Systematic review with random effects meta-analysis. Data sources: MEDLINE, EMBASE, CINAHL, SPORTDiscuss, Evidence-Based Medicine Reviews (Ovid), Scopus, Web of Science and ClinicalTrials.gov were searched until 12 January 2024. Eligibility criteria for selecting studies Studies

**[3]** The Impact of Exercising on Pelvic Symptom Severity, Pelvic Floor Muscle Strength, and Diastasis Recti Abdominis After Pregnancy: A Longitudinal Prospective Cohort Study.
_2024 · Physical therapy_
DOI: `10.1093/ptj/pzad171`
> The objective of this study was to evaluate whether early postpartum exercise is associated with changes in pelvic symptom severity, pelvic floor muscle strength, and diastasis recti abdominis (DRA) from 3 to 12 months postpartum. In this prospective cohort study, 504 participants with and without pelvic symptoms (pelvic girdle pain, stress urinary incontinence, vaginal heaviness) were followed. At 3, 6, 9, and 12 mo

**[4]** Online vs. Supervised Training in Relieving Urinary Incontinence and Diastasis Recti Abdominis in Early Postpartum.
_2024 · Journal of clinical medicine_
DOI: `10.3390/jcm13247730`
> Background/Objectives: The postpartum period is marked by numerous physical changes, often leading to pelvic floor disorders (PFD) such as urinary incontinence (UI) and diastasis recti abdominis (DRA). This study aimed to assess the occurrence of UI and DRA in postpartum women and evaluate the effectiveness of physiotherapy in managing UI and DRA. Methods: A total of 396 women, between the 3rd and 5th postpartum day,

**[5]** Effects of Pilates-Based Exercise on Diastasis Recti Abdominis, Pelvic Floor Function, and Musculoskeletal Pain Across the Perinatal Period: A Narrative Review
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.51.68441`
> Pregnancy and childbirth induce physiological changes affecting posture, abdominal wall integrity, and pelvic floor function. Diastasis recti abdominis affects up to 60% of women during pregnancy, pelvic floor dysfunction occurs in approximately 40% postpartum, and lumbopelvic pain persists in about 25% of women beyond early recovery. Pilates-based exercise offers an integrated approach combining breathing control, c

**[6]** Effectiveness of Exercise-based Interventions on Pelvic Floor Function in Postpartum Women: A Literature Review
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.50.67975`
> Background. Pregnancy and childbirth are major risk factors for postpartum pelvic floor dysfunction, including urinary and anal incontinence and pelvic organ prolapse. Although pelvic floor muscle training (PFMT) is widely recommended as first-line management, its benefits appear predominantly short-term and functional. Aim. To synthesize evidence on the effectiveness and limitations of exercise-based interventions,

**[7]** Hypopressive exercises for diastasis recti and pelvic floor symptoms in postpartum women: A randomized trial.
_2026 · Brazilian journal of physical therapy_
DOI: `10.1016/j.bjpt.2026.101584`
> Diastasis recti abdominis (DRA) is a common postpartum condition that can persist for months, impair abdominal function, and negatively affect quality of life. Despite its prevalence, there is no gold standard treatment. Hypopressive exercises have been proposed as a therapeutic option, but evidence from randomized controlled trials is limited. To evaluate the effects of a 12-week hypopressive training program on int

**[8]** Effect of a Postpartum Training Program on the Prevalence of Diastasis Recti Abdominis in Postpartum Primiparous Women: A Randomized Controlled Trial.
_2018 · Physical therapy_
DOI: `10.1093/ptj/pzy008`
> Diastasis recti abdominis affects a significant number of women during the prenatal and postnatal period. The objective was to evaluate the effect of a postpartum training program on the prevalence of diastasis recti abdominis. The design was a secondary analysis of an assessor-masked randomized controlled trial. One hundred seventy-five primiparous women (mean age = 29.8 ± 4.1 years) were randomized to an exercise o

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 42. [correct] Exercise is a core non-pharmacological therapy for PCOS.

**Grading id:** `g42`
**LLM judge verdict:** `correct`

**Original chat question:** What are effective strategies to encourage regular exercise in women diagnosed with polycystic ovary syndrome?

**Claim under audit:**

> Exercise is a core non-pharmacological therapy for PCOS.

**Cited source ids:** 1, 4, 6

**Retrieved sources:**

**[1] ◀ CITED** The effectiveness of exercise in the treatment of polycystic ovary syndrome
DOI: `10.48780/publications.aston.ac.uk.00042574`
> Polycystic ovary syndrome (PCOS) is the most common endocrinopathy in reproductive-aged women. The clinical and biochemical characteristics of PCOS typically include cystic ovaries, ovulatory dysfunction, and hyperandrogenaemia. PCOS is also associated with metabolic and psychological morbidity. Typically, management of PCOS focusses upon weight loss through positive lifestyle changes, namely caloric restriction and

**[2]** Lifestyle Medicine in PCOS: A Narrative Review of the Synergistic Effects of Physical Activity and Nutritional Interventions on Metabolic Health and Quality of Life
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.52.69394`
> Background. Polycystic Ovary Syndrome (PCOS) is a common endocrine disorder characterized by hyperandrogenism, ovulatory dysfunction, and insulin resistance. International guidelines recommend lifestyle modification as first-line therapy, yet the optimal intensity of exercise and specific dietary protocols remain debated. Aim. This review evaluates the synergistic effects of various exercise modalities and nutritiona

**[3]** Self-determined strategies for physical activity motivation among women with polycystic ovary syndrome
_2025 · Women's Health_
DOI: `10.1177/17455057251357061`
> Background: According to clinical practice guidelines for polycystic ovary syndrome, first-line treatment includes performing 150 min of moderate-to-vigorous physical activity on most days of the week plus at least 2 days of resistance training. However, &lt;40% of women with polycystic ovary syndrome engage in regular physical activity, and about 60% are sedentary. Research evidence supports theory-informed physical

**[4] ◀ CITED** The Impact of Physical Activity on Metabolic, Hormonal, and Psychological Profiles in Women with Polycystic Ovary Syndrome (PCOS): A Review of Current Evidence.
_2026 · Journal of Education, Health and Sport_
DOI: `10.12775/jehs.2026.89.69791`
> Background. Polycystic Ovary Syndrome (PCOS) is a complex endocrine disorder significantly impacting metabolic and psychological well-being. Physical activity is a cornerstone of non-pharmacological therapy, improving insulin sensitivity, lipid profiles, and body composition. Aim. This review aims to synthesize current evidence regarding the role of physical activity in PCOS management, focusing on cardiometabolic pa

**[5]** Improving health outcomes through a strength training and yoga program for young women with PCOS: A quality improvement project
_2024 · International Journal of Science and Research Archive_
DOI: `10.30574/ijsra.2024.13.2.2025`
> Background: Polycystic Ovary Syndrome (PCOS) is a common endocrine disorder associated with physical, mental, and reproductive health challenges. Lifestyle interventions, including exercise and yoga, have shown promise in managing PCOS symptoms. This quality improvement project aimed to assess the impact of a combined strength training and yoga program on the health outcomes of young women with PCOS. Methods: The 13-

**[6] ◀ CITED** The Effects of Exercise Programs on Metabolic and Reproductive Health in Women with PCOS: A Decade in Review (2013–2023)
_2025 · Journal of Pharmaceutical Research and Innovation_
DOI: `10.36647/jpri/05.02.a004`
> Polycystic ovary syndrome (PCOS) is a common endocrine disorder affecting reproductive-aged women, characterized by metabolic dysfunction, hyperandrogenism, and ovulatory disturbances. Exercise has emerged as a key non-pharmacological strategy to manage both metabolic and reproductive complications of the syndrome. This review aims to synthesize evidence from the past decade (2014–2024) on the effects of structured e

**[7]** Exercise Prescription in Polycystic Ovary Syndrome
_2025 · Quality in Sport_
DOI: `10.12775/qs.2025.48.66980`
> Introduction: Polycystic ovary syndrome (PCOS) is a common endocrine and metabolic disorder affecting women. It is characterized by irregular menstrual cycles, hyperandrogenism and insulin resistance. PCOS is associated with increased cardiometabolic risk and psychological burden. Lifestyle modification, particularly exercise, is a cornerstone of non-pharmacological treatment. This review summarizes recent findings (

**[8]** Supportive relationships--psychological effects of group counselling in women with polycystic ovary syndrome (PCOS).
_2012 · Communication &amp; medicine_
DOI: `10.1558/cam.v9i2.125`
> The objective of the present study was to examine the psychological impact of a group-oriented approach to disease management and health behaviour in women with polycystic ovary syndrome (PCOS). Seventeen overweight PCOS women were randomised in a crossover design of eight weeks high-intensity aerobic exercise followed by eight weeks of group counselling (n=8) or vice versa (n=9). Interpersonal communication, emotion

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 43. [correct] A 2024 trial compared online vs supervised training for urinary incontinence and diastasis…

**Grading id:** `g43`
**LLM judge verdict:** `correct`

**Original chat question:** postpartum exercise effects on pelvic floor disorders and diastasis recti abdominis in women

**Claim under audit:**

> A 2024 trial compared online vs supervised training for urinary incontinence and diastasis recti abdominis in early postpartum.

**Cited source ids:** 4

**Retrieved sources:**

**[1]** A Supervised Pelvic Floor Training Program Has Minimal Effect on the Prevalence of Postpartum Diastasis Recti Abdominis: A Critically Appraised Paper
_Human Kinetics_
DOI: `10.1123/ijatt.2019-0112`
> Focused Clinical Question: For postpartum primiparous women, will a 16-week, supervised, targeted pelvic floor muscle training program result in a reduced prevalence of diastasis recti abdominis versus education only at discharge? Clinical Bottom Line: We can neither recommend nor caution against a targeted pelvic floor muscle training program to reduce the prevalence of postpartum diastasis recti abdominis.

**[2]** Impact of postpartum exercise on pelvic floor disorders and diastasis recti abdominis: a systematic review and meta-analysis
_2024 · British Journal of Sports Medicine_
DOI: `10.1136/bjsports-2024-108619`
> Objective To examine the effect of exercise during the first year postpartum on pelvic floor disorders and diastasis recti abdominis. Design Systematic review with random effects meta-analysis. Data sources: MEDLINE, EMBASE, CINAHL, SPORTDiscuss, Evidence-Based Medicine Reviews (Ovid), Scopus, Web of Science and ClinicalTrials.gov were searched until 12 January 2024. Eligibility criteria for selecting studies Studies

**[3]** The Impact of Exercising on Pelvic Symptom Severity, Pelvic Floor Muscle Strength, and Diastasis Recti Abdominis After Pregnancy: A Longitudinal Prospective Cohort Study.
_2024 · Physical therapy_
DOI: `10.1093/ptj/pzad171`
> The objective of this study was to evaluate whether early postpartum exercise is associated with changes in pelvic symptom severity, pelvic floor muscle strength, and diastasis recti abdominis (DRA) from 3 to 12 months postpartum. In this prospective cohort study, 504 participants with and without pelvic symptoms (pelvic girdle pain, stress urinary incontinence, vaginal heaviness) were followed. At 3, 6, 9, and 12 mo

**[4] ◀ CITED** Online vs. Supervised Training in Relieving Urinary Incontinence and Diastasis Recti Abdominis in Early Postpartum.
_2024 · Journal of clinical medicine_
DOI: `10.3390/jcm13247730`
> Background/Objectives: The postpartum period is marked by numerous physical changes, often leading to pelvic floor disorders (PFD) such as urinary incontinence (UI) and diastasis recti abdominis (DRA). This study aimed to assess the occurrence of UI and DRA in postpartum women and evaluate the effectiveness of physiotherapy in managing UI and DRA. Methods: A total of 396 women, between the 3rd and 5th postpartum day,

**[5]** Effects of Pilates-Based Exercise on Diastasis Recti Abdominis, Pelvic Floor Function, and Musculoskeletal Pain Across the Perinatal Period: A Narrative Review
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.51.68441`
> Pregnancy and childbirth induce physiological changes affecting posture, abdominal wall integrity, and pelvic floor function. Diastasis recti abdominis affects up to 60% of women during pregnancy, pelvic floor dysfunction occurs in approximately 40% postpartum, and lumbopelvic pain persists in about 25% of women beyond early recovery. Pilates-based exercise offers an integrated approach combining breathing control, c

**[6]** Effectiveness of Exercise-based Interventions on Pelvic Floor Function in Postpartum Women: A Literature Review
_2026 · Quality in Sport_
DOI: `10.12775/qs.2026.50.67975`
> Background. Pregnancy and childbirth are major risk factors for postpartum pelvic floor dysfunction, including urinary and anal incontinence and pelvic organ prolapse. Although pelvic floor muscle training (PFMT) is widely recommended as first-line management, its benefits appear predominantly short-term and functional. Aim. To synthesize evidence on the effectiveness and limitations of exercise-based interventions,

**[7]** Hypopressive exercises for diastasis recti and pelvic floor symptoms in postpartum women: A randomized trial.
_2026 · Brazilian journal of physical therapy_
DOI: `10.1016/j.bjpt.2026.101584`
> Diastasis recti abdominis (DRA) is a common postpartum condition that can persist for months, impair abdominal function, and negatively affect quality of life. Despite its prevalence, there is no gold standard treatment. Hypopressive exercises have been proposed as a therapeutic option, but evidence from randomized controlled trials is limited. To evaluate the effects of a 12-week hypopressive training program on int

**[8]** Effect of a Postpartum Training Program on the Prevalence of Diastasis Recti Abdominis in Postpartum Primiparous Women: A Randomized Controlled Trial.
_2018 · Physical therapy_
DOI: `10.1093/ptj/pzy008`
> Diastasis recti abdominis affects a significant number of women during the prenatal and postnatal period. The objective was to evaluate the effect of a postpartum training program on the prevalence of diastasis recti abdominis. The design was a secondary analysis of an assessor-masked randomized controlled trial. One hundred seventy-five primiparous women (mean age = 29.8 ± 4.1 years) were randomized to an exercise o

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 44. [correct] CCL2/CCR2 is associated with exercise-induced muscle damage markers or responses.

**Grading id:** `g44`
**LLM judge verdict:** `correct`

**Original chat question:** muscle damage genetics women

**Claim under audit:**

> CCL2/CCR2 is associated with exercise-induced muscle damage markers or responses.

**Cited source ids:** 1, 2, 4, 6

**Retrieved sources:**

**[1] ◀ CITED** <i>CCL2</i> and <i>CCR2</i> polymorphisms are associated with markers of exercise-induced skeletal muscle damage
_2010 · Journal Article · Journal of Applied Physiology_
DOI: `10.1152/japplphysiol.00361.2009`
> Novel eccentric (lengthening contraction) exercise typically results in muscle damage, which manifests as prolonged muscle dysfunction, delayed onset muscle soreness, and leakage of muscle proteins into circulation. There is a large degree of variability in the damage response of individuals to eccentric exercise, with higher responders at risk for potentially fatal rhabdomyolysis. We hypothesized that single nucleot

**[2] ◀ CITED** Protective role of α-actinin-3 in the response to an acute eccentric exercise bout
_2010 · Journal Article · Journal of Applied Physiology_
DOI: `10.1152/japplphysiol.01007.2009`
> The ACTN3 gene encodes for the alpha-actinin-3 protein, which has an important structural function in the Z line of the sarcomere in fast muscle fibers. A premature stop codon (R577X) polymorphism in the ACTN3 gene causes a complete loss of the protein in XX homozygotes. This study investigates a possible role for the alpha-actinin-3 protein in protecting the fast fiber from eccentric damage and studies repair mechan

**[3]** The ACTN3 R577X Nonsense Allele Is Underrepresented in Professional Volleyball Players and Associated with an Increased Risk of Muscle Injury in Female Players.
_2025 · Journal Article · Genes_
DOI: `10.3390/genes16091076`
> Muscle injuries pose a significant challenge in sports, leading to decreased performance and shortened career longevity. Individuals homozygous for the nonsense X allele of the ACTN3 rs1815739 (R577X) polymorphism, characterized by a complete absence of α-actinin-3, have been associated with reduced power performance and may have an increased injury risk. This study aimed to investigate the association between the AC

**[4] ◀ CITED** <i>SOD2</i>gene polymorphism and muscle damage markers in elite athletes
_2014 · Free Radical Research_
DOI: `10.3109/10715762.2014.928410`
> Exercise-induced oxidative stress is a state that primarily occurs in athletes involved in high-intensity sports when pro-oxidants overwhelm the antioxidant defense system to oxidize proteins, lipids, and nucleic acids. During exercise, oxidative stress is linked to muscle metabolism and muscle damage, because exercise increases free radical production. The T allele of the Ala16Val (rs4880 C/T) polymorphism in the mi

**[5]** ACTN3 genotype is associated with increases in muscle strength in response to resistance training in women
_2005 · Journal Article · Journal of Applied Physiology_
DOI: `10.1152/japplphysiol.01139.2004`
> The alpha-actinin 3 (ACTN3) gene encodes a protein of the Z disk of myofibers, and a polymorphism of ACTN3 results in complete loss of the protein. The ACTN3 genotype (R577X) has been found to be associated with performance in Australian elite athletes (Yang N, MacArthur DG, Gulbin JP, Hahn AG, Beggs AH, Easteal S, and North K. Am J Hum Genet 73: 627-631, 2003). We studied associations between ACTN3 genotype and musc

**[6] ◀ CITED** ACTN3 and MLCK genotype associations with exertional muscle damage.
_2005 · Clinical Trial, Journal Article, Research Support, U.S. Gov't, Non-P.H.S. · Journal of applied physiology (Bethesda, Md. : 1985)_
DOI: `10.1152/japplphysiol.00130.2005`
> Strenuous exercise results in damage to skeletal muscle that is manifested in delayed muscle pain, prolonged strength loss, and increases in muscle proteins in the blood, especially creatine kinase (CK) and myoglobin (Mb). Some individuals experience profound changes in these variables in response to standard laboratory exercise or recreational activities. We proposed that variations in genes coding for two myofibril

**[7]** The stiffness response of type IIa fibres after eccentric exercise‐induced muscle damage is dependent on <i>ACTN3</i> r577X polymorphism
_2018 · Journal Article · European Journal of Sport Science_
DOI: `10.1080/17461391.2018.1529200`
> The aim of the study was to determine the effect of α-actinin-3 (ACTN3) deficiency (XX) on muscle damage induced by an eccentric exercise bout. In this purpose, 4 RR and 4 XX individuals performed an intensive eccentric knee flexion exercise on an isokinetic dynamometer. Muscle biopsies, blood and pain scores were taken before and after the exercise to determine the extent of the exercise-induced damage and the effec

**[8]** ACE I/D and ACTN3 R/X polymorphisms as potential factors in modulating exercise-related phenotypes in older women in response to a muscle power training stimuli
_2012 · AGE_
DOI: `10.1007/s11357-012-9461-3`
> Genetic variation of the human ACE I/D and ACTN3 R577X polymorphisms subsequent to 12 weeks of high-speed power training on maximal strength (1RM) of the arm and leg muscles, muscle power performance (counter-movement jump), and functional capacity (sit-to-stand test) was examined in older Caucasian women [n = 139; mean age 65.5 (8.2) years; 67.0 (10.0) kg and 1.57 (0.06) m]. Chelex 100 was used for DNA extraction, a

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---

## 45. [correct] In college student-athletes, social media engagement was studied alongside depression, anx…

**Grading id:** `g45`
**LLM judge verdict:** `correct`

**Original chat question:** does social media stress female athletes?

**Claim under audit:**

> In college student-athletes, social media engagement was studied alongside depression, anxiety, sleep, loneliness, and self-esteem.

**Cited source ids:** 2, 3

**Retrieved sources:**

**[1]** Social Media and Body Image Dissatisfaction Among Teen Athletes: A Qualitative Study
_2025 · AI and Tech in Behavioral and Social Sciences_
DOI: `10.61838/kman.aitech.3.3.9`
> This qualitative study examines the relationship between social media use and body image dissatisfaction among adolescent athletes, focusing on how digital exposure influences self-perception and psychological well-being in sports contexts. In-depth semi-structured interviews were conducted with 45 competitive teen athletes (ages 14-18) representing aesthetic (e.g., gymnastics) and non-aesthetic (e.g., soccer) sports

**[2] ◀ CITED** Social media engagement, perceptions of social media costs and benefits, and well-being in college student-athletes.
_2024 · Journal of American college health : J of ACH_
DOI: `10.1080/07448481.2022.2142797`
> Objective: The present study investigated the association between social media engagement and factors related to well-being (e.g., depression, anxiety, sleep, loneliness, self-esteem). Participants: A sample of 1120 college student-athletes (338 males, 777 females, 5 identified as non-binary) from nine universities participated in this study. Method: Data were collected through self-report measures and screen shots o

**[3] ◀ CITED** Digital media and mental health in adolescent athletes.
_2023 · Psychology of sport and exercise_
DOI: `10.1016/j.psychsport.2023.102421`
> Although digital media are increasingly important for adolescent athletes, few studies explore their influence on mental health in this population. This study aimed to examine this relationship in 591 German adolescent athletes (aged 12-19 years) from 42 different sports. Longer daily social media usage was connected to increased negative affect and dysfunctional eating patterns. Similar results were found for cognit

**[4]** Who's Got Game?: Exposure to Sports and Entertainment Media and Social Physique Anxiety in Division I Female Athletes
_2006 · Journal of Sports Media_
DOI: `10.1353/jsm.0.0011`
> This study compared college female athletes' exposure to two types of media—sport and entertainment--and looked for possible associations with social physique anxiety an affective trait that could be present in women who have eating disorder tendencies. Our survey of Division I female athletes yielded very inconsistent patterns with regard to the type of media that is more likely to be related to higher levels of phy

**[5]** The psychology of the female athlete: how mental health and wellness mediate sports performance, injury and recovery
_2021 · Journal Article · Annals of Joint_
DOI: `10.21037/aoj-20-53`
> : The increase in athletic participation of girls and women over the last half-century has brought into focus the need to better understand the psychology of female athletes. This review explores various non-physical factors that contribute to athletic success, such as resilience, mindfulness and sleep. The role of anxiety and depression in sport-related injury is another key issue that those invested in an athlete's

**[6]** What’s the Best Exposure? Examining Media Representations of Female Athletes and the Impact on Collegiate Athletes’ Self-Objectification
_2015 · Communication &amp; Sport_
DOI: `10.1177/2167479515577080`
> Many studies offer clear evidence that exposure to glamorized and sexualized media images results in distorted body image perceptions in girls and young women. Researchers have examined the link between sports media exposure and the negative effect on body perceptions of young girls and women, though a gap exists in the examination of the relationship between media images and positive impact. Grounded in the theories

**[7]** The Impact of Social Media on Body Image Perception in Young People.
_2025 · Nutrients_
DOI: `10.3390/nu17091455`
> Social media can significantly impact body image perception among adolescents. This study examines how exposure to fitspiration content relates to body esteem, with a focus on gender differences and BMI. A cross-sectional online survey was conducted among 211 participants using validated instruments (Body Esteem Scale, A. Sobczak's silhouette scale). Data were analyzed using descriptive statistics and chi-square test

**[8]** STRESS, SOCIAL MEDIA USE, AND BODY IMAGE CONCERNS AMONG ADOLESCENT GIRLS
_2025 · Insights-Journal of Life and Social Sciences_
DOI: `10.71000/tjyd5225`
> Background: Adolescent girls are increasingly exposed to social media environments that promote idealized body standards, placing them at heightened risk for body dissatisfaction and psychological distress. Given the developmental vulnerability of this age group, the potential mental health consequences of such exposure warrant focused investigation. Objective: To examine the associations between social media usage p

**Your verdict:** [ ] LLM judge correct  [ ] LLM judge wrong  [ ] ambiguous
**Notes:**

---
