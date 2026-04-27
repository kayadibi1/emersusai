# Anchor-Verifier Bench — z2-live-200

## Headline

| Metric | Value |
|---|---:|
| Total chats | 200 |
| Chats with verify error / skip | 9 |
| Total claims | 723 |
| Total anchors | 1783 |
| Anchors PASS (verbatim) | 1689 (94.7%) |
| Anchors PASS (judged) | 45 (2.5%) |
| Anchors FAIL | 49 (2.7%) |
| Pass rate (any) | 97.3% |
| Claims with ≥1 failed anchor | 40 (5.5%) |
| Claims with no anchors (synthesis-class) | 127 (17.6%) |

## Per-mode breakdown

| Existing mode | Claims | Anchors | Failed | Anchor-fail rate | Claims with ≥1 fail | Claim-fail rate |
|---|---:|---:|---:|---:|---:|---:|
| mode_2_overgen | 406 | 1160 | 32 | 2.8% | 29 | 7.1% |
| correct | 163 | 545 | 11 | 2.0% | 8 | 4.9% |
| no_marker | 121 | 0 | 0 | — | 0 | 0.0% |
| mode_1_misattribution | 18 | 45 | 6 | 13.3% | 3 | 16.7% |
| mode_4_contradicted | 13 | 28 | 0 | 0.0% | 0 | 0.0% |
| mode_3_fabrication | 2 | 5 | 0 | 0.0% | 0 | 0.0% |

## Scope distribution (passing anchors)

| Scope | Count | % of passing |
|---|---:|---:|
| chunk | 1196 | 69.0% |
| full_text | 7 | 0.4% |
| abstract | 531 | 30.6% |

## Per-kind anchor breakdown

| Kind | Total | Failed | Fail % |
|---|---:|---:|---:|
| other | 748 | 32 | 4.3% |
| population | 295 | 8 | 2.7% |
| intervention | 266 | 3 | 1.1% |
| outcome | 239 | 5 | 2.1% |
| duration | 109 | 0 | 0.0% |
| study_design | 70 | 1 | 1.4% |
| effect_size | 19 | 0 | 0.0% |
| comparator | 19 | 0 | 0.0% |
| dose | 11 | 0 | 0.0% |
| sample_size | 7 | 0 | 0.0% |

## Ship-decision rule (from spec §8)

Wire prod path (v2) iff all hold:

1. False-rejection rate ≤15% on Claude-judged audit subset (run separately on `*-audit.jsonl`)
2. Spearman ρ ≥ 0.4 between anchor-fail-rate and `chat_claim_modes.mode == mode_2_overgen` at claim level
3. Per-chat extractor cost ≤$0.002

Headline correlation hint (anchor-fail rate within mode_2_overgen vs. correct):
mode_2_overgen anchor-fail rate 2.8% vs correct 2.0% (lift +0.7pp). Positive lift means the verifier flags mode_2 claims more often, which is the desired behavior.
