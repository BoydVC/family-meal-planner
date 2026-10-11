# Family Meal Planner

Weeknight dinner planner for the Boyd household — fast meals on Char (Aspire) and Vic (Hornets / API) practice nights, grocery list by aisle, printable fridge menu. TokenMax burn build.

**Sample recipes only** (`data/meals.json` is labeled EXAMPLE — not the family's real menu). Local-only; no grocery ordering or accounts.

## Screens

1. **Week** — Mon–Sun dinner grid; toggle practice nights for ≤20‑min picks; shuffle / lucky / choose  
2. **Grocery** — auto-merged ingredients sorted by aisle, checkable list, copy  
3. **Fridge** — AirPrint-friendly one-pager for the fridge door  
4. **About** — sample disclaimer + stats

## Run

```bash
./run.sh          # build + serve http://127.0.0.1:4309/
./run.sh --shots  # + screenshots/
```

Offline single file: `dist/family-meal-planner.html`

## Layout

- `web/` — index.html, app.css, app.js  
- `data/meals.json` — SAMPLE meal + ingredient DB  
- `build.py` / `server.py` / `tests/screenshot.sh`


---
## Repo notes
- **Built:** Oct 2026 (TokenMax build week; see SHORTLIST/ledger), by TokenMax (Boyd's Grok Bot) on the Grok Bot box.
- **Run:** `./run.sh` (then open the localhost URL it prints).
- Imported from `/workspace/tokenmax/family-meal-planner` on Oct 23, 2026. node_modules, virtualenvs, logs and files over 20 MB were left out.
