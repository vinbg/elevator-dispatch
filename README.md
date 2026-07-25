# 🛗 Elevator Dispatch — 3D Simulation

Interactive 3D simulation of **elevator group control** for a residential building. The UI ships in **English (default) and Bulgarian** — toggle with the **EN / BG** switch in the top-right.

**[▶ Live demo](https://vinbg.github.io/elevator-dispatch/)**

*(Bulgarian below — [към българската версия](#-диспечер-на-асансьори--3d-симулация))*

## The building

- **230 apartments** · ≈**460 residents**
- **18 levels**: −1 underground parking + lobby (1) + floors 2–17
- **4 cars**: 2 small (8 people) + 2 large (12 people)
- **1.5 s** to travel between floors · ~3 s dwell with doors open

## The algorithm

A blend of the industry standards for group control:

1. **ETA dispatch (cost function)** — on every call the system computes, for each car, how many seconds it needs to arrive *in the right direction*: `distance × 1.5 s + ~3 s per intermediate stop + a penalty for occupancy/queue`. The "cheapest" car wins. That's why a car descending from the 17th floor **doesn't** stop at every floor — intermediate calls go to nearer/idle cars.
2. **LOOK** per car — keeps its direction while there are requests ahead; only picks up passengers travelling its way.
3. **Dynamic reassignment** with hysteresis (≥ 2 s) so it doesn't flap.
4. **Zone parking** — idle cars return to home floors (2× lobby, 9, 14).
5. **Capacity awareness** — a full car becomes "more expensive" and the system sends another.

The **Naive** toggle (always the nearest car, ignoring direction/queue) is there for comparison — you can watch the average wait get worse.

## What's in the simulation

- Drag to rotate, scroll to zoom
- Manual ▲/▼ calls on every floor
- Traffic profiles: mixed / morning / evening peak
- Passenger-rate slider, calibrated to the building's real scale
- Live log: who calls, which car is dispatched and why, wait, pickups/drop-offs
- Metrics: average/max wait, average trip, passengers served, throughput (p/min)
- **EN / BG language toggle** (English is the default)

## Tech

Single file, no dependencies — plain HTML/CSS/JS. The 3D is CSS 3D transforms (`preserve-3d`), no WebGL. Opens directly in a browser.

## Run locally

```bash
open index.html
```

---

# 🛗 Диспечер на асансьори — 3D симулация

Интерактивна 3D симулация на **групово управление на асансьори** (elevator group control) за жилищна сграда. Интерфейсът е на **английски (по подразбиране) и български** — сменя се с превключвателя **EN / BG** горе вдясно.

**[▶ Демо на живо](https://vinbg.github.io/elevator-dispatch/)**

## Сградата

- **230 апартамента** · ≈**460 живущи**
- **18 нива**: −1 подземен паркинг + партер (1) + етажи 2–17
- **4 кабини**: 2 малки (8 души) + 2 големи (12 души)
- **1.5 s** за минаване от етаж на етаж · ~3 s престой с отворени врати

## Алгоритъмът

Комбинация от индустриалните стандарти за групово управление:

1. **ETA dispatch (cost-function)** — при всяко повикване се смята за коя кабина ще отнеме най-малко секунди да стигне *в правилната посока*: `път × 1.5 s + ~3 s за всяко междинно спиране + добавка за заетост/опашка`. Печели най-„евтината". Затова кабина, слизаща от 17-и, **не** спира на всеки етаж — междинните сигнали отиват при по-близки/свободни кабини.
2. **LOOK** за всяка кабина — не сменя посока, докато има заявки напред; взима пътници само по посоката на движение.
3. **Динамично преразпределение** с хистерезис (≥ 2 s), за да не „трепти".
4. **Зоново паркиране** — свободните кабини се прибират на домашни етажи (2× партер, 9, 14).
5. **Отчитане на капацитета** — пълна кабина става „по-скъпа" и системата праща друга.

Превключвателят **Наивен** (винаги най-близката кабина, без посока/опашка) е за сравнение — вижда се как средното чакане се влошава.

## Какво има в симулацията

- Завъртане с влачене, мащаб със скрол
- Ръчни повиквания ▲/▼ за всеки етаж
- Профили на трафика: смесен / сутрешен / вечерен пик
- Регулатор на интензивността (пътници/мин), калибриран спрямо реалния мащаб
- Дневник на живо: кой вика, коя кабина е изпратена и защо, чакане, качвания/слизания
- Показатели: средно/макс. чакане, средно пътуване, обслужени пътници, пропускателна способност (п/мин)
- **Превключвател EN / BG** (английският е по подразбиране)

## Технологии

Един файл, без зависимости — чист HTML/CSS/JS. 3D-то е на CSS 3D transforms (`preserve-3d`), без WebGL. Отваря се директно в браузър.

## Локално стартиране

```bash
open index.html
```
