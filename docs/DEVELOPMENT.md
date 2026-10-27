# Development guide

## Setup

```bash
npm install
npm run dev        # http://localhost:5173
```

Node 22+ is required.

## Commands

| command | what it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck + static build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | all tests, including exact legacy parity (~30 s) |
| `npm run test:parity` | also the slow statistical parity check (~3 min) |
| `npm run eval` | leaderboard on the test split → `results/leaderboard.{md,json}` |
| `npm run train` | CMA-ES on the heuristic → `results/champion.json` if it passes the gate |
| `npm run train:nn` | ES on the neural residual → `results/nn-champion.json` if it passes |

### `npm run eval -- …`
- `--policy naive|v0|champion|nn|all` (comma lists allowed)
- `--split test|validation`
- `--seeds N`
- `--champion path`, `--nn path`
- `--out dir`
- `--quiet`
- `--gate` — exit code 1 if the champion doesn't beat v0. Use it in CI to block regressions.

### `npm run train -- …`
- `--regime morning|evening|offpeak|all`
- `--gens N`, `--batch M`, `--pop P`
- `--seed S`
- `--check K` — gate every K generations
- `--minutes T` — time limit per regime
- `--threads N`

Used for the committed champion: `--regime all --gens 400 --batch 40 --minutes 4 --check 20 --seed 7`.

### `npm run train:nn -- …`
- `--gens N`, `--pop P`, `--batch M`, `--seed S`
- `--sigma`, `--lr`, `--wd`
- `--check K`, `--minutes T`, `--threads N`

Used for the committed NN: `--gens 1500 --pop 24 --batch 24 --seed 3 --check 50 --minutes 15`.

Training appends every run's curve to `results/training-log.json`.

## Tests

| file | covers |
|---|---|
| `test/engine.test.ts` | RNG, determinism, passenger conservation, capacity bounds, demand calibration, regimes, zoning, **liveness** (no frozen cars) |
| `test/parity.test.ts` | exact trace replay against `legacy/v0.html` in jsdom |
| `test/eval.test.ts` | eval determinism, v0 beats naive, bootstrap sanity |
| `test/learn.test.ts` | CMA-ES on sphere/Rosenbrock, ES, zero-init NN equals the heuristic, worker protocol |

## Extending

- **New benchmark building.** Add it to `scenarios/suite.json` under `buildings`. It's picked up by eval and validation automatically. Regenerate the leaderboard.
- **New traffic window.** Add it under `windows` with `day`, `start`, `minutes`, `regime` and an optional `rateScale`.
- **New dispatcher.** Implement the `Policy` interface (`src/sim/sim.ts`) in `src/policies/`, then register it in `src/eval/suite.ts` to get it on the leaderboard.
- **Changing the engine.** `npm test` must stay green, especially parity and liveness. Engine changes invalidate trained champions, so retrain (`npm run train && npm run train:nn`) and regenerate the leaderboard.

## CI and deployment

- **`.github/workflows/ci.yml`** runs on PRs and pushes to `main`: typecheck, tests, and a reduced eval (8 seeds) whose leaderboard is posted in the job summary.
- **`.github/workflows/deploy.yml`** runs on pushes to `main`: builds and deploys `dist/` to GitHub Pages. This needs **Settings → Pages → Source: GitHub Actions**. The old "deploy from branch" mode serves the unbuilt `index.html`, which won't run.
