#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const port = 20000 + Math.floor(Math.random() * 20000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fmp-smoke-"));
const store = path.join(dir, "state.json");
const GATES = [
  "auto_order",
  "auto_checkout",
  "fabricate_meal",
  "share_external",
  "auto_text_kids",
];

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(port),
    STORE_PATH: store,
    QUIET: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let logs = "";
child.stdout.on("data", (chunk) => {
  logs += chunk;
});
child.stderr.on("data", (chunk) => {
  logs += chunk;
});

function finish(code) {
  if (child.exitCode != null || child.signalCode) {
    process.exit(code);
    return;
  }
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    process.exit(code);
  }, 1000);
  child.once("exit", () => {
    clearTimeout(timer);
    process.exit(code);
  });
}

function fail(error) {
  console.error("SMOKE FAIL");
  console.error(error && error.stack ? error.stack : error);
  if (logs) console.error(logs);
  finish(1);
}

async function request(pathname, options) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { status: res.status, body };
}

function post(pathname, payload) {
  return request(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function waitHealth() {
  const deadline = Date.now() + 5000;
  let last = "";
  while (Date.now() < deadline) {
    if (child.exitCode != null) fail(`server exited early\n${logs}`);
    try {
      const res = await request("/api/health");
      if (res.status === 200) return res;
      last = JSON.stringify(res.body);
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  fail(`health timeout: ${last}\n${logs}`);
}

async function main() {
  const health = await waitHealth();
  assert.equal(health.body.ok, true);
  assert.equal(health.body.host, "127.0.0.1");
  assert.equal(health.body.kpd, false);
  assert.match(health.body.classification, /EXAMPLE/);
  assert.match(health.body.classification, /SYNTHETIC/);

  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.body, /EXAMPLE\/SYNTHETIC/);
  assert.match(page.body, /Not KPD/);
  assert.match(page.body, /Practice/);

  const meals = await request("/api/meals");
  assert.ok(meals.body.meals.length >= 8);
  for (const meal of meals.body.meals) {
    assert.equal(meal.source, "EXAMPLE/SYNTHETIC");
  }

  const swap = await post("/api/week/swap", { day: "Tue" });
  assert.equal(swap.status, 200);
  assert.equal(swap.body.meal.fast, true);

  const blocked = await post("/api/week/meal", { day: "Tue", mealId: "lasagna" });
  assert.equal(blocked.status, 409);

  const grocery = await request("/api/grocery");
  const produce = grocery.body.aisles.find((aisle) => aisle.aisle === "Produce");
  const garlic = produce.items.find((item) => item.item === "garlic");
  assert.equal(garlic.merged, true);
  assert.equal(garlic.qty, "5 cloves");

  const fridge = await request("/api/fridge");
  assert.equal(fridge.body.printable, true);
  assert.equal(fridge.body.days.length, 7);

  const early = await post("/api/notes/apply", { day: "Thu" });
  assert.equal(early.status, 409);
  const held = await post("/api/notes/hold", { day: "Thu", text: "Synthetic fridge note" });
  assert.equal(held.body.state, "held");
  assert.equal(held.body.external, false);
  const applied = await post("/api/notes/apply", { day: "Thu" });
  assert.equal(applied.body.state, "applied");
  assert.equal(applied.body.transport, "local-stub");
  assert.equal(applied.body.external, false);
  const notes = await request("/api/notes");
  assert.equal(notes.body.days.Thu.applied.text, "Synthetic fridge note");
  assert.equal(notes.body.external, false);

  const before = meals.body.meals.length;
  for (const gate of GATES) {
    const refused = await post(`/api/${gate}`, { phone: "555-0199", action: gate });
    assert.equal(refused.status, 403, gate);
    assert.equal(refused.body.gate, gate);
    assert.equal(JSON.stringify(refused.body).includes("555-0199"), false);
  }
  const after = await request("/api/meals");
  assert.equal(after.body.meals.length, before);

  console.log("smoke PASS");
  finish(0);
}

main().catch(fail);
