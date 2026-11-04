"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { createServer, HOST } = require("../src/server");
const planner = require("../src/planner");

function shutdown(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fmp-"));
  const storePath = path.join(dir, "state.json");
  const server = createServer({ storePath });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const address = server.address();
  return {
    server,
    storePath,
    address: address.address,
    base: `http://127.0.0.1:${address.port}`,
  };
}

async function call(base, pathname, options = {}) {
  const res = await fetch(base + pathname, options);
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { status: res.status, body };
}

function post(base, pathname, payload) {
  return call(base, pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

test("server listens on 127.0.0.1 and reports a synthetic non-KPD planner", async (t) => {
  const ctx = await boot();
  t.after(() => shutdown(ctx.server));
  assert.equal(ctx.address, "127.0.0.1");
  const health = await call(ctx.base, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.host, "127.0.0.1");
  assert.equal(health.body.kpd, false);
  assert.equal(health.body.classification, "EXAMPLE/SYNTHETIC");
  assert.equal(health.body.localOnly, true);

  const meta = await call(ctx.base, "/api/meta");
  assert.deepEqual(meta.body.gates, [...planner.GATES]);
  assert.equal(meta.body.notes.apply, "local-stub");
  assert.equal(meta.body.notes.external, false);
  assert.equal(meta.body.kpd, false);
});

test("pages and meals stay EXAMPLE/SYNTHETIC", async (t) => {
  const ctx = await boot();
  t.after(() => shutdown(ctx.server));
  const page = await call(ctx.base, "/");
  assert.equal(page.status, 200);
  assert.match(page.body, /EXAMPLE\/SYNTHETIC/);
  assert.match(page.body, /Not KPD/);
  assert.match(page.body, /Practice/);
  assert.match(page.body, /127\.0\.0\.1/);
  assert.match(page.body, /America\/New_York/);
  assert.match(page.body, /Leftover/);
  const app = await call(ctx.base, "/app.js");
  assert.match(app.body, /role="switch"/);
  assert.match(app.body, /data-hold/);
  assert.match(app.body, /data-apply/);
  assert.match(app.body, /data-swap/);
  assert.match(app.body, /data-slot/);
  const meals = await call(ctx.base, "/api/meals");
  assert.equal(meals.body.meta.kpd, false);
  assert.ok(meals.body.meals.length > 0);
  for (const meal of meals.body.meals) {
    assert.equal(meal.source, "EXAMPLE/SYNTHETIC");
    assert.equal(meal.classification, "EXAMPLE/SYNTHETIC");
  }
  const raw = JSON.stringify(meals.body);
  assert.doesNotMatch(raw, /Char|Vic|St Mary|Hornets|Aspire/);
});

test("practice switches, swaps, aisle merge, and fridge print", async (t) => {
  const ctx = await boot();
  t.after(() => shutdown(ctx.server));

  const blocked = await post(ctx.base, "/api/week/meal", { day: "Tue", mealId: "lasagna" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "practice_requires_fast");

  const swap = await post(ctx.base, "/api/week/swap", { day: "Tuesday" });
  assert.equal(swap.status, 200);
  assert.equal(swap.body.to, "salmon-sheets");
  assert.equal(swap.body.meal.fast, true);
  assert.equal(swap.body.meal.source, "EXAMPLE/SYNTHETIC");

  const practice = await post(ctx.base, "/api/week/practice", { day: "Sun", on: true });
  assert.equal(practice.status, 200);
  assert.equal(practice.body.practice, true);
  const sunday = practice.body.week.days.find((day) => day.day === "Sun");
  assert.equal(sunday.meal.fast, true);

  await post(ctx.base, "/api/week/practice", { day: "Mon", on: false });
  await post(ctx.base, "/api/week/meal", { day: "Mon", mealId: "sheet-tacos" });
  await post(ctx.base, "/api/week/meal", { day: "Tue", mealId: "quesadillas" });
  const grocery = await call(ctx.base, "/api/grocery");
  assert.equal(grocery.body.merged, true);
  assert.equal(grocery.body.byAisle, true);
  const dairy = grocery.body.aisles.find((aisle) => aisle.aisle === "Dairy & Eggs");
  const cheese = dairy.items.find((item) => item.item === "shredded cheese");
  assert.equal(cheese.qty, "20 oz");
  assert.equal(cheese.merged, true);
  assert.equal(cheese.count, 2);

  const fridge = await call(ctx.base, "/api/fridge");
  assert.equal(fridge.body.printable, true);
  assert.equal(fridge.body.days.length, 7);
  assert.equal(fridge.body.kpd, false);
  assert.equal(fridge.body.classification, "EXAMPLE/SYNTHETIC");
  assert.equal(fridge.body.timezone, "America/New_York");
});

test("planned versus leftover is local and does not unlock auto_order", async (t) => {
  const ctx = await boot();
  t.after(() => shutdown(ctx.server));

  const week = await call(ctx.base, "/api/week");
  assert.equal(week.body.timezone, "America/New_York");
  assert.deepEqual(
    week.body.days.map((day) => day.day),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  );
  assert.equal(week.body.days.every((day) => day.slot === "planned"), true);

  const blocked = await post(ctx.base, "/api/week/slot", {
    day: "Mon",
    slot: "leftover",
    action: "auto_order",
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.gate, "auto_order");
  assert.equal(blocked.body.ok, false);

  const still = await call(ctx.base, "/api/week");
  assert.equal(still.body.days.find((day) => day.day === "Mon").slot, "planned");

  const empty = await post(ctx.base, "/api/week/clear");
  assert.equal(empty.status, 200);
  const needsMeal = await post(ctx.base, "/api/week/slot", { day: "Mon", slot: "leftover" });
  assert.equal(needsMeal.status, 409);

  await post(ctx.base, "/api/week/meal", { day: "Mon", mealId: "burger-bowls" });
  await post(ctx.base, "/api/week/meal", { day: "Wed", mealId: "pasta-pesto" });
  await post(ctx.base, "/api/week/meal", { day: "Thu", mealId: "stir-fry" });
  const marked = await post(ctx.base, "/api/week/slot", { day: "Wed", slot: "leftover" });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.slot, "leftover");
  assert.equal(marked.body.ordered, false);
  assert.equal(marked.body.external, false);
  assert.equal(marked.body.transport, "local-stub");
  const garlic = marked.body.grocery.aisles
    .find((aisle) => aisle.aisle === "Produce")
    .items.find((item) => item.item === "garlic");
  assert.equal(garlic.qty, "3 cloves");
  assert.deepEqual(marked.body.grocery.skippedLeftovers, ["Wed"]);

  const disk = JSON.parse(fs.readFileSync(ctx.storePath, "utf8"));
  assert.equal(disk.slots.Wed, "leftover");
  assert.equal(disk.external, false);

  const order = await post(ctx.base, "/api/auto_order", { day: "Wed", apply: true });
  assert.equal(order.status, 403);
  assert.equal(order.body.gate, "auto_order");
  assert.equal(order.body.ok, false);
  assert.equal(order.body.sent, undefined);
});

test("hold then apply is a local stub and survives a restart", async (t) => {
  const ctx = await boot();
  t.after(() => shutdown(ctx.server));
  const early = await post(ctx.base, "/api/notes/apply", { day: "Wed" });
  assert.equal(early.status, 409);

  const held = await post(ctx.base, "/api/notes/hold", {
    day: "Wed",
    text: "Leave the oven light on",
  });
  assert.equal(held.status, 200);
  assert.equal(held.body.state, "held");
  assert.equal(held.body.transport, "local-stub");
  assert.equal(held.body.external, false);
  assert.equal(held.body.applied, false);

  const applied = await post(ctx.base, "/api/notes/apply", { day: "Wed" });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.state, "applied");
  assert.equal(applied.body.transport, "local-stub");
  assert.equal(applied.body.external, false);
  assert.equal(applied.body.text, "Leave the oven light on");
  assert.equal(JSON.stringify(applied.body).includes("http"), false);

  const notes = await call(ctx.base, "/api/notes");
  assert.equal(notes.body.days.Wed.held, null);
  assert.equal(notes.body.days.Wed.applied.external, false);
  assert.equal(notes.body.transport, "local-stub");

  const fridge = await call(ctx.base, "/api/fridge");
  const wed = fridge.body.days.find((day) => day.day === "Wed");
  assert.equal(wed.note, "Leave the oven light on");

  const disk = JSON.parse(fs.readFileSync(ctx.storePath, "utf8"));
  assert.equal(disk.external, false);
  assert.equal(disk.transport, "local-stub");
  assert.equal(disk.applied.Wed.text, "Leave the oven light on");

  const again = createServer({ storePath: ctx.storePath });
  await new Promise((resolve) => again.listen(0, HOST, resolve));
  t.after(() => shutdown(again));
  const port = again.address().port;
  const restored = await call(`http://127.0.0.1:${port}`, "/api/notes");
  assert.equal(restored.body.days.Wed.applied.text, "Leave the oven light on");
  assert.equal(restored.body.days.Wed.applied.external, false);
});

test("ordering, checkout, fabrication, sharing, and texting kids are 403", async (t) => {
  const ctx = await boot();
  t.after(() => shutdown(ctx.server));
  const before = await call(ctx.base, "/api/meals");
  const secret = "555-0100";
  for (const gate of planner.GATES) {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const options = { method };
      if (method !== "GET") {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify({
          gate,
          action: gate,
          phone: secret,
          to: "kid",
          url: "https://example.invalid/share",
        });
      }
      const res = await call(ctx.base, `/api/${gate}`, options);
      assert.equal(res.status, 403, `${method} ${gate}`);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.gate, gate);
      assert.equal(res.body.kpd, false);
      assert.equal(JSON.stringify(res.body).includes(secret), false);
      assert.equal(res.body.url, undefined);
      assert.equal(res.body.sent, undefined);
    }
  }

  const sneaky = await post(ctx.base, "/api/notes/hold", {
    day: "Mon",
    text: "do not send",
    action: "auto_text_kids",
  });
  assert.equal(sneaky.status, 403);
  const notes = await call(ctx.base, "/api/notes");
  assert.equal(notes.body.days.Mon.held, null);

  const query = await call(ctx.base, "/api/meals?action=share_external");
  assert.equal(query.status, 403);
  assert.equal(query.body.gate, "share_external");

  const after = await call(ctx.base, "/api/meals");
  assert.equal(after.body.meals.length, before.body.meals.length);
});

test("server source binds loopback and does not open the gates", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/server.js"), "utf8");
  assert.match(src, /server\.listen\(PORT, HOST/);
  assert.equal(src.includes("0.0.0.0"), false);
  assert.equal(src.includes("twilio"), false);
  assert.equal(src.includes("smtp"), false);
  const client = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  for (const gate of planner.GATES) {
    assert.equal(client.includes(`fetch("/api/${gate}")`) || client.includes("data-probe"), true);
  }
});

test("refused connection is not published on another interface helper", () => {
  assert.equal(HOST, "127.0.0.1");
  const server = http.createServer((_req, res) => res.end("ok"));
  return new Promise((resolve, reject) => {
    server.listen(0, HOST, () => {
      const address = server.address();
      assert.equal(address.address, "127.0.0.1");
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });
});
