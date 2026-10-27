## Dispatch leaderboard

test split · 600 scenarios (6 buildings × 5 windows × 20 seeds, seeds 1000–1019) · every policy runs the same scenarios (paired) · 2026-10-27

| # | policy | score ↓ | avg wait (s) | p95 wait (s) | waits > 60 s | avg trip (s) | energy | vs naive | vs v0 | beats v0 |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `nn` | **11.78** | 4.5 | 14.3 | 0.0% | 20.3 | 12.58 | -64.3% | -8.9% | ✅ |
| 2 | `champion` | **11.88** | 4.6 | 14.5 | 0.0% | 20.1 | 12.74 | -64.0% | -8.2% | ✅ |
| 3 | `v0` | **12.94** | 5.1 | 16.6 | 0.1% | 20.2 | 12.57 | -60.8% | — | — |
| 4 | `naive` | **33.01** | 13.7 | 57.8 | 5.6% | 21.1 | 11.66 | — | +155.1% | ❌ |

**Score by regime**

| policy | morning | evening | offpeak |
| :--- | ---: | ---: | ---: |
| `nn` | 14.52 | 11.02 | 9.43 |
| `champion` | 14.65 | 11.20 | 9.46 |
| `v0` | 16.75 | 11.52 | 9.84 |
| `naive` | 43.67 | 30.67 | 23.53 |

**Score by building**

| policy | default-block | walkup-6 | slim-12 | mixed-fleet-24 | busy-30 | tower-40 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `nn` | 10.67 | 4.92 | 13.14 | 12.53 | 14.91 | 14.52 |
| `champion` | 10.78 | 4.93 | 13.24 | 12.48 | 15.02 | 14.86 |
| `v0` | 11.43 | 4.91 | 13.52 | 15.12 | 16.25 | 16.42 |
| `naive` | 26.12 | 5.94 | 20.23 | 42.69 | 49.20 | 53.91 |

**Paired vs `v0`** (Δ = policy − v0, 95% bootstrap CI)

| policy | score | base | Δ score | 95% CI | Δ % | Δ p95 | sig. | gate |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| `naive` | 33.01 | 12.94 | ↑ +20.07 | [+18.24, +22.03] | +155.1% | +41.2 | worse | ❌ fail |
| `champion` | 11.88 | 12.94 | ↓ -1.06 | [-1.23, -0.89] | -8.2% | -2.1 | better | ✅ pass |
| `nn` | 11.78 | 12.94 | ↓ -1.16 | [-1.34, -0.99] | -8.9% | -2.3 | better | ✅ pass |

**Paired vs `naive`** (Δ = policy − naive, 95% bootstrap CI)

| policy | score | base | Δ score | 95% CI | Δ % | Δ p95 | sig. | gate |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- | :--- |
| `v0` | 12.94 | 33.01 | ↓ -20.07 | [-22.01, -18.24] | -60.8% | -41.2 | better | ✅ pass |
| `champion` | 11.88 | 33.01 | ↓ -21.13 | [-23.21, -19.21] | -64.0% | -43.3 | better | ✅ pass |
| `nn` | 11.78 | 33.01 | ↓ -21.23 | [-23.33, -19.31] | -64.3% | -43.5 | better | ✅ pass |

**Score** (lower is better): `avgWait + 0.25·p95Wait + 0.15·avgTrip + 20·(share of waits > 60 s) + 0.05·energy`

**Gate**: promote only if the paired 95% bootstrap CI of mean(score − baseline score) lies entirely below 0 and mean p95Wait is not worse.
