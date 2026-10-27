# Approaches: dispatching, traffic and learning

## 1. The problem

With one car there's nothing to decide. With several cars sharing many floors, every hall call is an assignment problem: *which car goes, and what does sending it cost everyone else?* Sending the nearest car looks obvious, but it ignores direction, the stops the car already promised, and how full it is. That's why the naive dispatcher performs badly (see [EVALUATION.md](EVALUATION.md)).

## 2. Dispatchers

### Naive
Always the nearest car by distance. It never reassigns and parks at the configured home floors. It's the baseline every other dispatcher has to beat.

### ETA v0: the original cost function
On each call, every car gets a cost, and the cheapest car wins:

```
cost = ETA(car → floor, in the caller's direction)
     + 0.7 · calls already assigned to the car
     + 0.3 · riders on board
     + 8   · fill²
```

The **ETA** simulates the car's LOOK route: it finishes the stops ahead in its current direction, reverses if needed, and is charged a dwell time for every intermediate stop. Around it:

- **Reassignment.** Every 0.8 s, any call can move to another car that is at least 2 s cheaper. The 2 s hysteresis stops calls flapping between cars.
- **Zone parking.** Idle cars return to configured home floors.

### Tuned heuristic: the same formula, learned constants
Every hand-picked number becomes a parameter. There's also one new term: people waiting at the car's other assigned stops. Zoning becomes a learned rule instead of fixed floors:

| parameter | meaning | v0 | morning | evening | off-peak |
|---|---|---|---|---|---|
| `wPending` | per call already assigned | 0.7 | 5.32 | 3.30 | 5.55 |
| `wPax` | per rider on board | 0.3 | 0 | 0.06 | 0 |
| `wFill` | × fill² | 8 | 10.5 | 8.1 | 3.7 |
| `stopCost` | × dwell per intermediate stop | 1 | 0.30 | 0.41 | 0.83 |
| `wWaiting` | per person waiting at its other stops ÷ capacity | 0 | 19.4 | 8.6 | 14.4 |
| `reassignGain` | hysteresis (s) | 2 | 5.2 | 2.7 | 7.7 |
| `reassignEvery` | seconds between passes | 0.8 | 0.83 | 1.47 | 2.15 |
| `lobbyShare` | share of idle cars parked at the lobby | config | **0.02** | **0.64** | 0.17 |
| `spread` | phase of the other homes across upper floors | config | 0.53 | 0.23 | 0.24 |

Training learned these values separately for each regime. Several are interpretable:

- **Zoning matches textbook practice.** In the morning almost no cars wait at the lobby, because residents leave from the upper floors. In the evening most do, because residents arrive at the lobby.
- **Spread the load.** Large `wPending` and `wWaiting` stop the dispatcher piling calls onto one car.
- **Reassign less, off-peak.** With little traffic, stability is worth more than marginal gains.

### Neural residual
A small MLP (18 → 32 → 16 → 1, tanh) scores each (car, call) pair. Its output is **added** to the tuned heuristic's cost:

```
cost = heuristic cost + 5 · MLP(features)
```

The 18 features are all normalised so the network works for any building:
- ETA and distance
- direction match, whether the car is idle, whether its doors are open
- stops before the call, fill, other assigned calls, people waiting at its other stops, people waiting at this call
- call age, committed stops, call floor and direction
- regime (one-hot), 1 / number of cars, whether the car already owns the call

The output layer starts at **zero**, so an untrained network makes exactly the heuristic's decisions. It can only change behaviour where training found an improvement.

## 3. Traffic model

Realistic and *randomised* demand is what makes learning meaningful.

- **Demand curve.** Arrivals follow a non-homogeneous Poisson process: an hourly profile for weekdays and weekends, as multiples of the building's **design peak**. That peak is about 1.2 % of residents per minute (5–7 % of residents in 5 minutes, the usual residential sizing figure).
- **Origin/destination mix shifting through the day.** Mornings flow down to the lobby and parking. Evenings flow up from them. Middays are mostly inter-floor. The current mix sets the **regime**: morning / evening / off-peak.
- **Per-floor populations.** Each scenario jitters the population of each residential floor (log-normal).
- **Groups.** 1–4 people travel together (mean 1.55), with the arrival rate rescaled so people per minute stays calibrated.
- **Surges.** Random 3–10 minute events: guests arriving at one floor, a party leaving one floor, delivery rounds.
- **Boarding time.** Door dwell grows with the number of people getting on and off.
- **Domain randomisation** for training: random buildings with 5–44 floors, 0–3 parking levels, 1–10 cars of mixed capacity, and varied speeds and door timings.

The live app also keeps the original **constant** model: a rate slider plus a mixed / morning / evening toggle.

## 4. Learning

### Stage 1: CMA-ES on the heuristic (offline)
[CMA-ES](https://en.wikipedia.org/wiki/CMA-ES) is a robust, gradient-free optimiser that adapts a full covariance matrix. It's well suited to 9 noisy, bounded parameters. Training runs separately for each regime:

- **Common random numbers.** All candidates in a generation run on the *same* batch of fresh training scenarios, so they're compared on equal terms.
- **Scale-free fitness.** Fitness is the mean of `log(score / v0 score)` per scenario, so a few saturated random buildings can't dominate.
- **Incumbent.** The distribution mean, which is more stable than the best single noisy sample.
- **Promotion only through the gate.** At intervals, the incumbent is checked on the **validation** split against both v0 and the current champion (see [EVALUATION.md](EVALUATION.md)). It's written to `results/champion.json` only if it passes.

Run: `npm run train -- --regime all --gens 400 --batch 40`. That takes about 7 minutes on 11 threads.

### Stage 2: evolution strategies on the neural residual (offline)
OpenAI-style ES trains the ~1.2k network weights with antithetic sampling, centred-rank fitness shaping and the Adam optimiser. It runs on domain-randomised scenarios across all regimes, on top of the tuned heuristic. Promotion uses the same gate against the heuristic champion. Run: `npm run train:nn`.

### Stage 3: live learning in the browser
The **Learning** card starts a Web Worker that runs CMA-ES on **your configured building** for the current time of day:

- Each generation is 8 scenarios of 20 minutes, with a population of 10, so it finishes well under a second.
- After each generation, the incumbent is scored on 24 fixed 30-minute scenarios of your building.
- Every 3 generations it's gated against the current champion. When it passes, the worker posts a new champion. The UI stores it and, in **Learned** mode, hot-swaps it into the running simulation.

### Why not deep RL (yet)
Policy-gradient RL (e.g. PPO) has a higher ceiling but is much harder to debug and explain, and needs far more samples. The staged approach gets a reliable, interpretable win first, and the zero-initialised residual gives a safe path to adding learned behaviour. Deep RL becomes worth it if the residual stage keeps finding real gains and then plateaus.
