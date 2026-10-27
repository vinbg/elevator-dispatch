# 🛗 Elevator Dispatch — a self-improving 3D simulation

Interactive 3D simulation of **elevator group control** — and a dispatcher that **learns** to do it better.

One elevator is easy. Four elevators sharing 18 floors is where it gets hard: every call is a decision — *which car goes, and what does sending it cost everyone else?* This project simulates that, measures it honestly, and lets an optimiser improve the dispatch algorithm while you watch.

**[▶ Live demo](https://vinbg.github.io/elevator-dispatch/)** · UI in **English and Bulgarian** (EN / BG switch, top-right)

## What it does

- **Configure any building** — floors, underground parking, residents, car count/capacities/home floors, travel and door timing, boarding time per passenger.
- **Watch it run in 3D** — CSS 3D, no WebGL, drag to rotate, scroll to zoom, call cars from any floor, live log of every dispatch decision.
- **Compare dispatchers** — `Naive` (nearest car) · `ETA v0` (the original hand-tuned cost function) · `Learned` (trained parameters, optionally with a neural residual).
- **Learn live** — press *Start learning*: a Web Worker runs the same engine headless at thousands × real time on randomised traffic for *your* building, and hot-swaps the visible dispatcher whenever a candidate provably beats the current one.

## How it's built

```
src/sim/        headless deterministic engine — seeded RNG, fixed 0.1 s step, LOOK car controller, events, metrics
src/policies/   naive · eta (parametric cost function; V0 = original constants) · nn (MLP residual) · learned
src/traffic/    24-hour demand model, scenarios, domain randomisation
src/eval/       benchmark suite, paired statistics, leaderboard CLI
src/learn/      CMA-ES, evolution strategies, trainers, champion format
src/worker/     in-browser learning worker
src/ui/         the 3D app
scenarios/      suite.json — benchmark buildings, traffic windows, seed splits
results/        champion.json, nn-champion.json, leaderboard.md/json (committed)
legacy/v0.html  the original single-file prototype (kept as the parity baseline)
```

TypeScript end to end: the **same engine** runs in the page, in the learning worker and in Node for training and evals, so what you watch is exactly what was trained and measured.

### Traffic model

Arrivals are a non-homogeneous Poisson process following a **24-hour demand curve** (weekday and weekend), scaled to the building's *design peak* (≈1.2 % of residents per minute). The origin/destination mix shifts through the day — mornings flow down to the lobby and parking, evenings flow up, middays are inter-floor. On top of that: per-floor populations, **groups** (1–4 people travelling together), **random surges** (guests arriving, a party leaving, deliveries) and boarding time that grows with the number of people getting on and off.

### The dispatch algorithm

1. **ETA cost function** — on every call, each car's cost = seconds to reach the caller *in the right direction* (distance × s/floor + a dwell charge per intermediate stop) + penalties for queued calls, riders, how full it is and people waiting at its other stops. The cheapest car wins.
2. **LOOK per car** — keep direction while there are requests ahead; only pick up passengers travelling that way.
3. **Dynamic reassignment** with hysteresis, so calls move to a better car without flapping.
4. **Zone parking** — idle cars return to home floors.
5. **Capacity awareness** — a fuller car gets more expensive.

`ETA v0` uses the original hand-picked constants. Training turns every constant — plus the zoning and the reassignment threshold/interval — into a 9-dimensional parameter vector, learned **separately for morning, evening and off-peak** traffic. The neural stage adds a small MLP that scores each (car, call) pair from ~16 features and *adds a correction* to the tuned cost; it starts at zero, so it can only be adopted if it measurably helps.

### How "better" is decided

Every change has to win on the benchmark, not on a feeling.

- **Suite** — 6 buildings (from a 6-floor walk-up with 2 cars to a 40-floor tower with 8) × 5 traffic windows (weekday morning, morning rush, evening, midday, weekend) × seeds.
- **Separate seeds** for training (random), validation (selection and promotion) and test (the leaderboard only).
- **Score** (lower is better): `avgWait + 0.25·p95Wait + 0.15·avgTrip + 20·(share of waits > 60 s) + 0.05·energy`. People still waiting when the window closes count with their wait so far.
- **Paired comparisons** — candidates run on identical scenarios and seeds; a new champion is promoted only if the mean score difference is negative with **95 % bootstrap confidence** and mean p95 wait doesn't get worse.

See [`results/leaderboard.md`](results/leaderboard.md) for the full tables.

### Current results (held-out test split, 600 scenarios)

| dispatcher | score | avg wait | p95 wait | vs ETA v0 |
|---|---|---|---|---|
| Naive (nearest car) | 33.01 | 13.7 s | 57.8 s | +155 % worse |
| ETA v0 (original constants) | 12.94 | 5.1 s | 16.6 s | — |
| Tuned heuristic (CMA-ES, per regime) | 11.88 | 4.6 s | 14.5 s | **−8.2 %** (95 % CI −9.5 … −6.9 %) |
| + neural residual (ES) | 11.78 | 4.5 s | 14.3 s | **−8.9 %** |

The biggest gains are in morning traffic (tuned heuristic: p95 wait 22.9 → 18.9 s) and the larger buildings (tower-40: −9.5 % tuned, −11.6 % with the residual). The neural residual beats the tuned heuristic by only ~0.9 % (significant, but small), so the app's *Learned* mode uses the tuned heuristic: it's explainable, and it's cheap enough to keep fine-tuning in the browser.

> **Note on the original prototype.** Extracting the engine exposed a freeze in `legacy/v0.html`. If a car stopped at a floor whose waiting call pointed the other way, or the car was full, it re-opened its doors there forever. This hit about a quarter of benchmark runs. The engine fixes it. `legacyDoorFreeze: true` reproduces it, and is used only by the exact-replay parity test, which proves the port matches the original passenger by passenger.

## Commands

```bash
npm install
npm run dev          # the app at http://localhost:5173
npm test             # engine, traffic, eval, learning and legacy-parity tests
npm run eval         # leaderboard on the test split → results/leaderboard.{md,json}
npm run train        # CMA-ES on the heuristic, per regime → results/champion.json (if it passes the gate)
npm run train:nn     # evolution strategies on the NN residual → results/nn-champion.json (if it passes)
npm run build        # static build in dist/ (deployed to GitHub Pages by .github/workflows/deploy.yml)
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and a reduced eval on every PR, and posts the leaderboard in the job summary.

---

# 🛗 Диспечер на асансьори — самообучаваща се 3D симулация

Интерактивна 3D симулация на **групово управление на асансьори** — и диспечер, който **се учи** да го прави по-добре.

Един асансьор е лесно. Четири асансьора за 18 етажа са трудната част: всяко повикване е решение — *коя кабина да тръгне и какво струва това на всички останали?*

- **Конфигурирайте всяка сграда** — етажи, подземен паркинг, живущи, брой/капацитет/домашен етаж на кабините, време за път и врати, време за качване на пътник.
- **Гледайте в 3D** и сравнявайте: `Наивен` (най-близката кабина) · `ETA v0` (оригиналната ръчно настроена функция) · `Научен` (обучени параметри, по избор с невронна корекция).
- **Учене на живо** — *Започни обучение*: Web Worker пуска същия енджин без визуализация хиляди пъти по-бързо върху случаен трафик за *вашата* сграда и подменя диспечера, щом кандидат доказано е по-добър.
- **Честна оценка** — 6 сгради × 5 времеви прозореца × отделни seed-ове за обучение, валидация и тест; сдвоени сравнения с 95 % bootstrap доверителен интервал.

Технологии: TypeScript, Vite, Vitest. Един и същ енджин в браузъра, в worker-а и в Node.
