# Evaluation

A dispatcher is only "better" if it wins on the benchmark: paired, on unseen seeds, with statistical confidence.

## The suite (`scenarios/suite.json`)

**6 buildings**

| id | floors | parking | residents | cars (capacity) |
|---|---|---|---|---|
| default-block | 17 | 1 | 460 | 4 (8, 12, 12, 8) — the real block the project started from |
| walkup-6 | 6 | 0 | 70 | 2 (6, 6) |
| slim-12 | 12 | 1 | 240 | 2 (8, 8) — under-provisioned |
| mixed-fleet-24 | 24 | 1 | 720 | 5 (6, 8, 12, 16, 21) |
| busy-30 | 30 | 3 | 1100 | 6 (12 each) |
| tower-40 | 40 | 2 | 1600 | 8 (13–16) |

**× 5 traffic windows:** weekday morning (07:15, 45 min), morning rush (07:30, 30 min, 1.7× demand), weekday evening (18:15), weekday midday (12:00) and weekend (11:00). All windows include groups, surges and per-floor jitter.

**× seeds, split three ways**

| split | seeds | used for |
|---|---|---|
| train | random, fresh every generation | optimisation only |
| validation | 2000–2009 | promotion decisions |
| test | 1000–1019 | the leaderboard only, never seen by training |

The full test split is 6 × 5 × 20 = **600 scenarios per dispatcher**. It runs in about 2 s per dispatcher.

## Metrics

| metric | meaning |
|---|---|
| avgWait | button press → boarding. People still waiting when the window closes count with their wait so far. |
| p95Wait, maxWait | tail waits |
| long% | share of waits over 60 s |
| avgTrip | time inside the car |
| journey | wait + trip |
| throughput | passengers delivered per minute |
| energy | (floors travelled + 2 × stops) per passenger served |
| unserved | still waiting at the end |

**Score** (lower is better), the one number training optimises and the leaderboard ranks by:

```
score = avgWait + 0.25·p95Wait + 0.15·avgTrip + 20·(share of waits > 60 s) + 0.05·energy
```

## Comparing dispatchers

- **Paired.** Every dispatcher runs the identical scenarios and seeds, and the comparison uses the per-scenario differences. This removes most of the noise from "which day was busier".
- **Bootstrap CI.** A 95 % confidence interval of the mean score difference, from 2,000 resamples.
- **Promotion gate.** A candidate replaces the champion only if the whole interval is below 0 *and* the mean p95 wait doesn't get worse.

## Results (test split)

| dispatcher | score | avg wait | p95 wait | Δ vs ETA v0 (95 % CI) |
|---|---|---|---|---|
| Naive | 33.01 | 13.7 s | 57.8 s | +155 % |
| ETA v0 | 12.94 | 5.1 s | 16.6 s | — |
| Tuned heuristic | 11.88 | 4.6 s | 14.5 s | **−8.2 %** (−9.5 … −6.9 %) |
| + neural residual | 11.78 | 4.5 s | 14.3 s | **−8.9 %** (−10.4 … −7.7 %) |

**By regime** (tuned vs v0):
- morning 16.75 → 14.65 (−12.5 %; p95 wait 22.9 → 18.9 s)
- evening 11.52 → 11.20 (−2.8 %)
- off-peak 9.84 → 9.46 (−3.9 %)

**By building:**
- the gains grow with size and fleet mix: mixed-fleet-24 −17 %, tower-40 −9.5 %, busy-30 −7.6 %, default-block −5.7 %
- walkup-6 is a tie, because there's little to optimise with 2 cars and 6 floors

**Neural residual vs tuned heuristic:** −0.10 score (95 % CI −0.16 … −0.04). That's statistically real but small (≈0.9 %), and it costs about 3× the compute per decision. The app's *Learned* mode therefore uses the tuned heuristic.

Full tables: [`results/leaderboard.md`](../results/leaderboard.md).

## Known limitations

- **Selection bias.** Training checks the same validation split repeatedly, which makes validation gains optimistic. Only the test numbers above are clean.
- **Simulator simplifications.** Constant car speed (no acceleration or jerk), no destination dispatch, no up-peak-specific features like sub-zoning or express cars, and no passengers who give up and take the stairs.
- **Score weights.** These are a design choice. Changing them changes what "better" means, so treat the score as a documented convention, not ground truth.
