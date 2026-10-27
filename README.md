# Family Meal Planner

Millersville weeknight planner for an example household. Every meal is **EXAMPLE/SYNTHETIC**. This demo is **not KPD**: no kids' personal data, no school roster, and no way to text anyone.

The server listens on **127.0.0.1** only. Grocery ordering, checkout, invented meals, external sharing, and texting kids are gates. Each one answers **403**.

## Two-minute how-to

About two minutes, on this computer. Meals on the desk are **EXAMPLE/SYNTHETIC**. This demo is not Instacart and it is not a store account. Marking a slot Planned or Leftover does not place an order. **Apply** writes a local note and does not unlock ordering. The app never reports an Instacart or auto-order success. `/api/auto_order` stays **403**.

1. **Start (15 seconds).** From the repo root run `npm start`. Open [http://127.0.0.1:4309/](http://127.0.0.1:4309/). You should see the week desk, Monday through Sunday, and an EXAMPLE/SYNTHETIC banner.
2. **Week desk (25 seconds).** Dates follow **America/New_York**. Each slot is **Planned** (cook it, and it lands on the grocery list) or **Leftover** (already in the house, so that night stays off the grocery list). One tap switches the mark. Today is highlighted in Eastern Time. Nothing is ordered.
3. **Practice switches (15 seconds).** On Tuesday, Wednesday, or Thursday, flip the Practice switch. Practice nights only keep fast meals. Turning a switch on swaps a slow dinner for a fast one.
4. **Swap a dinner (15 seconds).** Press **Swap** on a day to take the next eligible meal, or **Choose** to pick one. A slow meal stays blocked while that night is a practice night.
5. **Grocery aisle merge (15 seconds).** Open **Grocery**. Ingredients from planned cooks are merged into one line per item and grouped by aisle. Leftover nights are omitted. Matching quantities with the same unit are summed (garlic from two planned dinners becomes one produce line).
6. **Fridge print (10 seconds).** Open **Fridge** and press **Print**. You get one page for the fridge door, with Planned or Leftover on each filled night. A note stays off that page until you apply it.
7. **Notes, Hold then Apply (20 seconds).** Open **Notes**, type a reminder, press **Hold**, then **Apply**. Hold stages the draft. Apply writes it through the local stub onto this computer only. Nothing is emailed, posted, texted, or ordered. Reload the page and the applied note is still there. Apply does not make `auto_order` succeed.

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
- `src/planner.js` — week desk, planned/leftover, practice swaps, aisle merge, hold/apply
- `public/` — week desk, grocery, fridge, notes
- `data/meals.json` — EXAMPLE/SYNTHETIC meal pack
- `test/` — `npm test` and `npm run smoke`
