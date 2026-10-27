# Family Meal Planner

Millersville weeknight planner for an example household. Every meal is **EXAMPLE/SYNTHETIC**. This demo is **not KPD**: no kids' personal data, no school roster, and no way to text anyone.

The server listens on **127.0.0.1** only. Grocery ordering, checkout, invented meals, external sharing, and texting kids are gates. Each one answers **403**.

## Two-minute how-to

About two minutes, on this computer.

1. **Start (15 seconds).** From the repo root run `npm start`. Open [http://127.0.0.1:4309/](http://127.0.0.1:4309/). You should see the week grid and an EXAMPLE/SYNTHETIC banner.
2. **Practice switches (20 seconds).** On Tuesday, Wednesday, or Thursday, flip the Practice switch. Practice nights only keep fast meals. Turning a switch on swaps a slow dinner for a fast one.
3. **Swap a dinner (20 seconds).** Press **Swap** on a day to take the next eligible meal, or **Choose** to pick one. A slow meal stays blocked while that night is a practice night.
4. **Grocery aisle merge (20 seconds).** Open **Grocery**. Ingredients from the week are merged into one line per item and grouped by aisle. Matching quantities with the same unit are summed (garlic from two dinners becomes one produce line).
5. **Fridge print (15 seconds).** Open **Fridge** and press **Print**. You get one page for the fridge door. A note stays off that page until you apply it.
6. **Notes, Hold then Apply (30 seconds).** Open **Notes**, type a reminder, press **Hold**, then **Apply**. Hold stages the draft. Apply writes it through the local stub onto this computer only. Nothing is emailed, posted, or texted. Reload the page and the applied note is still there.

Stop the server with Ctrl+C.

## Checks

```bash
npm test
npm run smoke
```

Both should pass. `npm test` covers the planner and the HTTP gates. `npm run smoke` boots `src/server.js` and walks the same loopback path.

## What the server refuses

These routes always return 403. They do not place an order, invent a meal, share outside this machine, or text a child:

- `/api/auto_order`
- `/api/auto_checkout`
- `/api/fabricate_meal`
- `/api/share_external`
- `/api/auto_text_kids`

A request that names one of those gates on another route is refused the same way.

## Layout

- `src/server.js` — loopback server
- `src/planner.js` — week, practice swaps, aisle merge, hold/apply
- `public/` — week, grocery, fridge, notes
- `data/meals.json` — EXAMPLE/SYNTHETIC meal pack
- `test/` — `npm test` and `npm run smoke`
