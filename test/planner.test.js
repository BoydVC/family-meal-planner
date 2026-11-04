"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const planner = require("../src/planner");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "meals.json"), "utf8"));

function item(grocery, aisle, name) {
  const group = grocery.aisles.find((entry) => entry.aisle === aisle);
  assert.ok(group, `missing aisle ${aisle}`);
  const found = group.items.find((entry) => entry.item.toLowerCase() === name.toLowerCase());
  assert.ok(found, `missing ${name} in ${aisle}`);
  return found;
}

test("meal pack is EXAMPLE/SYNTHETIC and not KPD", () => {
  assert.equal(data.meta.kpd, false);
  assert.match(data.meta.source, /EXAMPLE/);
  assert.match(data.meta.source, /SYNTHETIC/);
  assert.match(data.meta.classification, /EXAMPLE\/SYNTHETIC/);
  const raw = JSON.stringify(data);
  assert.doesNotMatch(raw, /Char|Vic|St Mary|Hornets|Aspire/);
  assert.doesNotMatch(raw, /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/);
  for (const meal of data.meals) {
    assert.equal(meal.source, "EXAMPLE/SYNTHETIC");
    assert.equal(meal.classification, "EXAMPLE/SYNTHETIC");
  }
});

test("readme is a two-minute how-to", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.match(readme, /Two-minute how-to/);
  assert.match(readme, /npm test/);
  assert.match(readme, /npm run smoke/);
  assert.match(readme, /127\.0\.0\.1/);
  assert.match(readme, /Hold/);
  assert.match(readme, /Apply/);
  assert.match(readme, /not KPD/i);
  assert.match(readme, /America\/New_York/);
  assert.match(readme, /Leftover/);
  assert.match(readme, /Instacart/);
  assert.match(readme, /403/);
  assert.match(readme, /never reports an Instacart or auto-order success/);
  for (const gate of planner.GATES) assert.match(readme, new RegExp(gate));
});

test("example week merges shared ingredients into one aisle line", () => {
  const state = planner.freshState(data);
  const grocery = planner.mergeGrocery(data, state);
  assert.equal(grocery.merged, true);
  assert.equal(grocery.byAisle, true);
  const garlic = item(grocery, "Produce", "garlic");
  assert.equal(garlic.qty, "5 cloves");
  assert.equal(garlic.merged, true);
  assert.equal(garlic.count, 2);
  const oil = item(grocery, "Pantry", "olive oil");
  assert.equal(oil.qty, "5 tbsp");
  assert.equal(oil.merged, true);
});

test("matching units sum and mismatched units stay listed", () => {
  assert.equal(planner.mergeQtyList(["8 oz", "12 oz"]), "20 oz");
  assert.equal(planner.mergeQtyList(["1.5 lb", "2 lb"]), "3.5 lb");
  assert.equal(planner.mergeQtyList(["1/4 cup", "1/4 cup"]), "1/4 cup × 2");
  assert.equal(planner.mergeQtyList(["1 jar", "1 pkt"]), "1 jar + 1 pkt");
  assert.equal(planner.mergeQtyList(["1"]), "1");
});

test("practice-night swap stays on fast meals and skips slow dinners", () => {
  const state = planner.freshState(data);
  assert.equal(state.practice.Tue, true);
  assert.equal(state.meals.Tue, "quesadillas");
  const swapped = planner.swapDay(data, state, "Tue");
  assert.equal(swapped.to, "salmon-sheets");
  assert.equal(planner.isFast(planner.mealById(data, swapped.to)), true);

  const blocked = planner.assignMeal(data, state, "Tue", "lasagna");
  assert.equal(blocked.status, 409);
  assert.equal(state.meals.Tue, "quesadillas");

  const home = planner.setPractice(data, state, "Tue", false);
  const slow = planner.assignMeal(data, home.state, "Tue", "lasagna");
  assert.equal(slow.meal.id, "lasagna");
});

test("turning practice on swaps a slow meal for a fast one", () => {
  const state = planner.freshState(data);
  assert.equal(state.meals.Sun, "roast-chicken");
  assert.equal(planner.isFast(planner.mealById(data, "roast-chicken")), false);
  const turned = planner.setPractice(data, state, "Sun", true);
  assert.equal(turned.state.practice.Sun, true);
  assert.ok(turned.swapped);
  assert.equal(planner.isFast(planner.mealById(data, turned.state.meals.Sun)), true);
});

test("shuffle keeps practice nights fast", () => {
  const state = planner.shuffleMeals(data, planner.freshState(data), () => 0);
  for (const day of ["Tue", "Wed", "Thu"]) {
    const meal = planner.mealById(data, state.meals[day]);
    assert.equal(planner.isFast(meal), true);
  }
});

test("notes hold then apply through the local stub", () => {
  const state = planner.freshState(data);
  const early = planner.applyNote(state, "Tue");
  assert.equal(early.status, 409);

  const held = planner.holdNote(state, "Tue", "  Pack the blue bottle  ");
  assert.equal(held.held.text, "Pack the blue bottle");
  assert.equal(held.state.applied.Tue, undefined);

  const applied = planner.applyNote(held.state, "Tue");
  assert.equal(applied.applied.text, "Pack the blue bottle");
  assert.equal(applied.applied.transport, "local-stub");
  assert.equal(applied.applied.external, false);
  assert.equal(applied.state.held.Tue, undefined);

  const again = planner.applyNote(applied.state, "Tue");
  assert.equal(again.status, 409);
  assert.equal(planner.holdNote(state, "Mon", "   ").status, 400);
});

test("week label uses an en dash and seven days", () => {
  const label = planner.weekLabel(new Date("2026-10-27T18:00:00Z"));
  assert.match(label, /–/);
  const week = planner.presentWeek(data, planner.freshState(data), "127.0.0.1");
  assert.equal(week.days.length, 7);
  assert.equal(week.kpd, false);
  assert.equal(week.host, "127.0.0.1");
  assert.equal(week.days.every((day) => !day.meal || day.meal.source === "EXAMPLE/SYNTHETIC"), true);
});

test("week desk dates follow America/New_York Monday through Sunday", () => {
  const tuesday = new Date("2026-10-27T18:00:00Z");
  const span = planner.weekSpan(tuesday);
  assert.equal(span.timezone, "America/New_York");
  assert.equal(span.label, "Oct 26 – Nov 1");
  assert.equal(span.today, "2026-10-27");
  assert.deepEqual(
    span.days.map((day) => day.day),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  );
  assert.equal(span.days[0].date, "2026-10-26");
  assert.equal(span.days[1].today, true);
  assert.equal(span.days[6].date, "2026-11-01");

  const stillSunday = planner.weekSpan(new Date("2026-10-26T03:30:00Z"));
  assert.equal(stillSunday.today, "2026-10-25");
  assert.equal(stillSunday.label, "Oct 19 – Oct 25");
  assert.equal(stillSunday.days[6].today, true);

  const week = planner.presentWeek(data, planner.freshState(data), "127.0.0.1", tuesday);
  assert.equal(week.timezone, "America/New_York");
  assert.equal(week.days[1].today, true);
  assert.equal(week.days.every((day) => day.slot === "planned"), true);
  assert.equal(week.counts.leftover, 0);
  assert.equal(week.counts.planned, 7);
});

test("leftover slots stay off the grocery list and do not order", () => {
  const state = planner.freshState(data);
  const marked = planner.setSlot(state, "Wed", "leftover");
  assert.equal(marked.slot, "leftover");
  assert.equal(marked.state.external, false);
  assert.equal(marked.state.slots.Wed, "leftover");
  assert.equal(marked.state.meals.Wed, "pasta-pesto");

  const grocery = planner.mergeGrocery(data, marked.state);
  const garlic = item(grocery, "Produce", "garlic");
  assert.equal(garlic.qty, "3 cloves");
  assert.equal(garlic.merged, false);
  assert.deepEqual(grocery.skippedLeftovers, ["Wed"]);

  const empty = planner.setSlot(planner.clearMeals(state), "Mon", "leftover");
  assert.equal(empty.status, 409);
  assert.equal(empty.error, "needs_meal");
  assert.equal(planner.setSlot(state, "Mon", "ordered").status, 400);

  const shuffled = planner.shuffleMeals(data, marked.state, () => 0);
  assert.equal(shuffled.slots.Wed, "planned");
  const cleared = planner.clearMeals(marked.state);
  assert.equal(cleared.slots.Wed, "planned");
  assert.equal(cleared.meals.Wed, null);
});
