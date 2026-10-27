"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const planner = require("./planner");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4309);
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const MEALS_PATH = process.env.MEALS_PATH || path.join(ROOT, "data", "meals.json");
const STORE_PATH = process.env.STORE_PATH || path.join(ROOT, "data", ".local-state.json");

const STATIC = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

function loadData(file = MEALS_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadStore(data, file) {
  if (!file) return planner.freshState(data);
  try {
    if (fs.existsSync(file)) {
      return planner.sanitizeState(data, JSON.parse(fs.readFileSync(file, "utf8")));
    }
  } catch (_) {
    return planner.freshState(data);
  }
  return planner.freshState(data);
}

function persistStore(file, state) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    transport: "local-stub",
    external: false,
    kpd: false,
    practice: state.practice,
    meals: state.meals,
    held: state.held,
    applied: state.applied,
  };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, file);
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  const raw = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": raw.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  res.end(raw);
}

function sendText(res, status, body, type) {
  if (res.headersSent) return;
  const raw = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": raw.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Connection: "close",
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const ok = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 16 * 1024) {
        const err = new Error("too_large");
        err.status = 413;
        fail(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        ok({ json: {}, raw: "" });
        return;
      }
      try {
        ok({ json: JSON.parse(raw), raw });
      } catch (_) {
        ok({ json: null, raw, invalid: true });
      }
    });
    req.on("error", fail);
  });
}

function gateFromPath(pathname, url) {
  const parts = pathname.split("/").filter(Boolean);
  for (const part of parts) {
    if (planner.isGate(part)) return part;
  }
  const queryGate = url.searchParams.get("gate") || url.searchParams.get("action");
  if (planner.isGate(queryGate)) return queryGate;
  return null;
}

function gateFromBody(body) {
  if (!body || typeof body !== "object") return null;
  for (const key of ["gate", "action", "name", "op"]) {
    if (planner.isGate(body[key])) return String(body[key]).trim();
  }
  return null;
}

function createServer(options = {}) {
  const data = options.data || loadData(options.mealsPath || MEALS_PATH);
  const storePath = Object.prototype.hasOwnProperty.call(options, "storePath")
    ? options.storePath
    : STORE_PATH;
  let state = options.state || loadStore(data, storePath);

  function persist() {
    state.transport = "local-stub";
    state.external = false;
    state.kpd = false;
    persistStore(storePath, state);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err && err.status === 413 ? 413 : 500;
      sendJson(res, status, {
        ok: false,
        error: status === 413 ? "too_large" : "server_error",
      });
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url || "/", `http://${HOST}`);
    const pathname = url.pathname;
    if (!process.env.QUIET) {
      console.log(`[family-meal-planner] ${req.method} ${pathname}`);
    }

    if (pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store", Connection: "close" });
      res.end();
      return;
    }

    const pathGate = gateFromPath(pathname, url);
    if (pathGate) {
      req.resume();
      sendJson(res, 403, planner.forbidden(pathGate));
      return;
    }

    const method = req.method || "GET";
    let body = {};
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const parsed = await readBody(req);
      if (parsed.invalid) {
        sendJson(res, 400, { ok: false, error: "bad_json", message: "Expected JSON." });
        return;
      }
      body = parsed.json || {};
      const bodyGate = gateFromBody(body);
      if (bodyGate) {
        sendJson(res, 403, planner.forbidden(bodyGate));
        return;
      }
    }

    if (method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      const address = server.address();
      sendJson(res, 200, {
        ok: true,
        app: "family-meal-planner",
        host: HOST,
        port: address && address.port ? address.port : PORT,
        kpd: false,
        classification: planner.CLASSIFICATION,
        localOnly: true,
      });
      return;
    }

    if (method === "GET" && pathname === "/api/meta") {
      sendJson(res, 200, {
        ok: true,
        classification: planner.CLASSIFICATION,
        kpd: false,
        localOnly: true,
        host: HOST,
        household: "Example household · Millersville",
        gates: planner.GATES,
        notes: { hold: true, apply: "local-stub", external: false },
        features: [
          "practice-switches",
          "practice-night-swaps",
          "aisle-merge",
          "fridge-printable",
          "notes-hold-apply",
        ],
      });
      return;
    }

    if (method === "GET" && pathname === "/api/meals") {
      sendJson(res, 200, { ok: true, ...planner.presentCatalog(data) });
      return;
    }

    if (method === "GET" && pathname === "/api/week") {
      sendJson(res, 200, planner.presentWeek(data, state, HOST));
      return;
    }

    if (method === "GET" && pathname === "/api/grocery") {
      sendJson(res, 200, {
        ok: true,
        kpd: false,
        classification: planner.CLASSIFICATION,
        ...planner.mergeGrocery(data, state),
      });
      return;
    }

    if (method === "GET" && pathname === "/api/fridge") {
      sendJson(res, 200, planner.presentFridge(data, state));
      return;
    }

    if (method === "GET" && pathname === "/api/notes") {
      sendJson(res, 200, planner.presentNotes(state));
      return;
    }

    if (method !== "GET" && method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    if (method === "POST" && pathname === "/api/week/practice") {
      const day = planner.normalizeDay(body.day);
      if (!day) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_day",
          message: "Use a weekday, Mon through Sun.",
        });
        return;
      }
      if (typeof body.on !== "boolean" && typeof body.practice !== "boolean") {
        sendJson(res, 400, {
          ok: false,
          error: "bad_practice",
          message: "Pass on: true or false.",
        });
        return;
      }
      const on = typeof body.on === "boolean" ? body.on : body.practice;
      const result = planner.setPractice(data, state, day, on);
      state = result.state;
      persist();
      sendJson(res, 200, {
        ok: true,
        day,
        practice: !!state.practice[day],
        swapped: result.swapped,
        week: planner.presentWeek(data, state, HOST),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/week/swap") {
      const day = planner.normalizeDay(body.day);
      if (!day) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_day",
          message: "Use a weekday, Mon through Sun.",
        });
        return;
      }
      const result = planner.swapDay(data, state, day);
      state = result.state;
      persist();
      sendJson(res, 200, {
        ok: true,
        day,
        from: result.from,
        to: result.to,
        changed: result.changed,
        meal: planner.publicMeal(planner.mealById(data, result.to)),
        week: planner.presentWeek(data, state, HOST),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/week/meal") {
      const day = planner.normalizeDay(body.day);
      if (!day) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_day",
          message: "Use a weekday, Mon through Sun.",
        });
        return;
      }
      if (!body.mealId) {
        sendJson(res, 400, { ok: false, error: "bad_meal", message: "mealId is required." });
        return;
      }
      const result = planner.assignMeal(data, state, day, body.mealId);
      if (result.error) {
        sendJson(res, result.status, {
          ok: false,
          error: result.error,
          message: result.message,
        });
        return;
      }
      state = result.state;
      persist();
      sendJson(res, 200, {
        ok: true,
        day,
        meal: planner.publicMeal(result.meal),
        week: planner.presentWeek(data, state, HOST),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/week/shuffle") {
      state = planner.shuffleMeals(data, state);
      persist();
      sendJson(res, 200, { ok: true, week: planner.presentWeek(data, state, HOST) });
      return;
    }

    if (method === "POST" && pathname === "/api/week/clear") {
      state = planner.clearMeals(state);
      persist();
      sendJson(res, 200, { ok: true, week: planner.presentWeek(data, state, HOST) });
      return;
    }

    if (method === "POST" && pathname === "/api/notes/hold") {
      const day = planner.normalizeDay(body.day);
      if (!day) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_day",
          message: "Use a weekday, Mon through Sun.",
        });
        return;
      }
      const result = planner.holdNote(state, day, body.text);
      if (result.error) {
        sendJson(res, result.status, {
          ok: false,
          error: result.error,
          message: result.message,
        });
        return;
      }
      state = result.state;
      persist();
      sendJson(res, 200, {
        ok: true,
        state: "held",
        day,
        text: result.held.text,
        applied: false,
        transport: "local-stub",
        external: false,
        notes: planner.presentNotes(state),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/notes/apply") {
      const day = planner.normalizeDay(body.day);
      if (!day) {
        sendJson(res, 400, {
          ok: false,
          error: "bad_day",
          message: "Use a weekday, Mon through Sun.",
        });
        return;
      }
      const result = planner.applyNote(state, day);
      if (result.error) {
        sendJson(res, result.status, {
          ok: false,
          error: result.error,
          message: result.message,
        });
        return;
      }
      state = result.state;
      persist();
      sendJson(res, 200, {
        ok: true,
        state: "applied",
        day,
        text: result.applied.text,
        transport: "local-stub",
        external: false,
        notes: planner.presentNotes(state),
      });
      return;
    }

    const asset = method === "GET" ? STATIC[pathname] : null;
    if (asset) {
      const file = path.join(PUBLIC_DIR, asset.file);
      sendText(res, 200, fs.readFileSync(file, "utf8"), asset.type);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    sendText(res, 404, "not found", "text/plain; charset=utf-8");
  }

  return server;
}

function main() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    const address = server.address();
    console.log(`Family Meal Planner http://${address.address}:${address.port}/`);
  });
  return server;
}

if (require.main === module) main();

module.exports = {
  HOST,
  PORT,
  createServer,
  main,
  loadData,
};
