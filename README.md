# 🛗 Elevator Dispatch — a self-improving 3D simulation

Interactive 3D simulation of **elevator group control**, with a dispatcher that **learns** to do it better.

One elevator is easy. Four elevators sharing 18 floors is where it gets hard: every call is a decision. *Which car goes, and what does sending it cost everyone else?* This project simulates that, measures it honestly, and lets an optimiser improve the dispatch algorithm while you watch.

**[▶ Live demo](https://vinbg.github.io/elevator-dispatch/)** · UI in **English and Bulgarian**

## Features

- **Configure any building.** Set floors, underground parking, residents, number of cars with their capacities and home floors, travel and door timing, and boarding time per passenger.
- **Watch it in 3D.** Drag to rotate and scroll to zoom. Call cars from any floor, and follow a live log of every dispatch decision with real wait times.
- **Compare three dispatchers:**
  - `Naive` — always the nearest car.
  - `ETA v0` — the original hand-tuned cost function.
  - `Learned` — the trained dispatcher.
- **Learn live.** *Start learning* runs the same engine headless in a Web Worker, at about 1000× real time, on randomised traffic for **your** building. Whenever a candidate *provably* beats the current dispatcher, it hot-swaps into the running simulation.

## Results

Held-out test split: 6 buildings × 5 traffic windows × 20 seeds = 600 scenarios. Lower score is better.

| dispatcher | score | avg wait | p95 wait | vs ETA v0 |
|---|---|---|---|---|
| Naive | 33.01 | 13.7 s | 57.8 s | +155 % |
| ETA v0 (original) | 12.94 | 5.1 s | 16.6 s | — |
| **Learned** (tuned heuristic) | **11.88** | **4.6 s** | **14.5 s** | **−8.2 %** (95 % CI −9.5 … −6.9 %) |
| + neural residual | 11.78 | 4.5 s | 14.3 s | −8.9 % |

- **Morning traffic gains most:** −12.5 %, with p95 wait 22.9 → 18.9 s.
- **Bigger and mixed fleets gain more:** up to −17 %.
- **Training rediscovered textbook zoning.** In the morning almost no idle cars wait at the lobby (residents leave from upper floors). In the evening most do (residents arrive).

Details: [docs/EVALUATION.md](docs/EVALUATION.md) · full tables: [results/leaderboard.md](results/leaderboard.md)

## Stack

| | |
|---|---|
| Language | **TypeScript** everywhere: page, Web Worker and Node scripts share one engine |
| Build | **Vite** (static site on GitHub Pages) |
| Tests | **Vitest**, plus **jsdom** to run the original prototype for parity checks |
| 3D | **CSS 3D transforms**: no WebGL, no libraries |
| ML | **Plain TypeScript**: CMA-ES, evolution strategies, a small MLP. No TF.js, no Python. |
| Training | Node **worker_threads**, using all CPU cores |
| CI/CD | **GitHub Actions**: typecheck, tests, eval leaderboard on every PR; deploy on `main` |

No runtime dependencies. Why this stack: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Approach in one minute

1. **A headless, deterministic engine.** It uses a seeded RNG and a fixed 0.1 s step, so any run can be replayed exactly. A 45-minute simulation takes about 5 ms. It's verified passenger by passenger against the original single-file prototype.
2. **Realistic, randomised traffic.** Demand follows a 24-hour curve scaled to residents. The origin/destination mix shifts through the day, and there are groups, surges, per-floor populations and boarding time.
3. **The ETA cost function.** Send the car that reaches the caller fastest *in the right direction*, with penalties for load and queued work. LOOK routing per car, reassignment with hysteresis, and zone parking.
4. **Learning in stages:**
   - **CMA-ES** tunes the cost function's 9 parameters (including zoning), separately for morning, evening and off-peak traffic.
   - **Evolution strategies** then train a small neural network that adds a correction to that cost. It starts at zero, so it can only help.
   - In the browser, the same optimiser keeps fine-tuning for your building.
5. **Evals as the gate.** Training, validation and test seeds are kept separate. Comparisons are paired, and nothing is promoted unless it wins with 95 % bootstrap confidence without worsening p95 wait.

Details: [docs/APPROACHES.md](docs/APPROACHES.md)

## Quick start

```bash
npm install
npm run dev          # the app at http://localhost:5173
npm test             # engine, parity, eval and learning tests
npm run eval         # leaderboard on the test split
npm run train        # retrain the heuristic (CMA-ES)
npm run train:nn     # retrain the neural residual (ES)
```

More commands, flags and how to extend the project: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

## Documentation

- [Architecture & stack](docs/ARCHITECTURE.md) — engine design, module map, why TypeScript-only
- [Approaches](docs/APPROACHES.md) — dispatch algorithms, traffic model, learning methods, learned parameters
- [Evaluation](docs/EVALUATION.md) — benchmark suite, metrics, score, statistics, results, limitations
- [Development](docs/DEVELOPMENT.md) — commands, tests, extending, CI/deploy

> **About the original prototype.** `legacy/v0.html` is the first single-file version. Extracting the engine exposed a bug in it: a car could freeze at a floor, re-opening its doors forever. That happened when the call waiting there pointed the other way, or the car was full, and it hit about 26 % of benchmark runs. The new engine fixes it.

---

# 🛗 Диспечер на асансьори — самообучаваща се 3D симулация

Интерактивна 3D симулация на **групово управление на асансьори** и диспечер, който **се учи** да го прави по-добре.

Един асансьор е лесно. Четири асансьора за 18 етажа са трудната част: всяко повикване е решение. *Коя кабина да тръгне и какво струва това на всички останали?*

- **Всяка сграда.** Етажи, паркинг, живущи, брой, капацитет и домашен етаж на кабините, време за път и врати, време за качване.
- **3D и сравнение:**
  - `Наивен` — най-близката кабина.
  - `ETA v0` — оригиналната ръчно настроена функция.
  - `Научен` — обученият диспечер.
- **Учене на живо.** Web Worker пуска същия енджин около 1000 пъти по-бързо върху случаен трафик за *вашата* сграда и подменя диспечера, щом кандидат доказано е по-добър.
- **Резултат.** На 600 тестови сценария, невиждани при обучението, обученият диспечер е **с 8,2 % по-добър** от ETA v0. Сутрин е с 12,5 % по-добър.
- **Технологии.** TypeScript, Vite, Vitest. CMA-ES и еволюционни стратегии на чист TypeScript. Един и същ енджин в браузъра, в worker-а и в Node.

Подробности (на английски): [docs/](docs/)
