"use strict";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DAY_FULL = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

const GATES = Object.freeze([
  "auto_order",
  "auto_checkout",
  "fabricate_meal",
  "share_external",
  "auto_text_kids",
]);

const EXAMPLE_WEEK = Object.freeze({
  Mon: "burger-bowls",
  Tue: "quesadillas",
  Wed: "pasta-pesto",
  Thu: "stir-fry",
  Fri: "pizza-night",
  Sat: "salmon-sheets",
  Sun: "roast-chicken",
});

const CLASSIFICATION = "EXAMPLE/SYNTHETIC";
const TIMEZONE = "America/New_York";
const SLOTS = Object.freeze(["planned", "leftover"]);

function isFast(meal) {
  return !!(meal && (meal.fast === true || Number(meal.minutes) <= 20));
}

function isGate(name) {
  return GATES.includes(String(name || "").trim());
}

function stampMeal(meal) {
  if (!meal) return null;
  return {
    ...meal,
    source: CLASSIFICATION,
    classification: CLASSIFICATION,
  };
}

function mealById(data, id) {
  if (!id) return null;
  const found = (data.meals || []).find((meal) => meal.id === id);
  return found ? stampMeal(found) : null;
}

function eligible(data, practice) {
  const meals = (data.meals || []).map(stampMeal);
  const pool = practice ? meals.filter(isFast) : meals;
  return pool.slice().sort((a, b) => a.id.localeCompare(b.id));
}

function nextMealId(data, currentId, practice) {
  const pool = eligible(data, practice);
  if (!pool.length) return null;
  const idx = pool.findIndex((meal) => meal.id === currentId);
  return pool[(idx + 1) % pool.length].id;
}

function freshState(data) {
  const practice = {};
  const meals = {};
  for (const day of DAYS) {
    practice[day] = !!(data.practiceDefaults && data.practiceDefaults[day]);
    let id = EXAMPLE_WEEK[day] || null;
    const meal = mealById(data, id);
    if (!meal) id = null;
    else if (practice[day] && !isFast(meal)) id = nextMealId(data, null, true);
    meals[day] = id;
  }
  const slots = {};
  for (const day of DAYS) slots[day] = "planned";
  return {
    practice,
    meals,
    slots,
    held: {},
    applied: {},
    transport: "local-stub",
    external: false,
    kpd: false,
  };
}

function sanitizeState(data, parsed) {
  const base = freshState(data);
  if (!parsed || typeof parsed !== "object") return base;
  for (const day of DAYS) {
    if (typeof parsed.practice?.[day] === "boolean") {
      base.practice[day] = parsed.practice[day];
    }
    if (parsed.meals && Object.prototype.hasOwnProperty.call(parsed.meals, day)) {
      const id = parsed.meals[day];
      if (id == null) base.meals[day] = null;
      else {
        const meal = mealById(data, id);
        if (meal && !(base.practice[day] && !isFast(meal))) base.meals[day] = meal.id;
        else if (base.practice[day]) base.meals[day] = nextMealId(data, null, true);
      }
    }
    const held = parsed.held?.[day];
    if (held && typeof held.text === "string" && held.text.trim()) {
      base.held[day] = {
        text: held.text.trim().slice(0, 280),
        heldAt: String(held.heldAt || ""),
      };
    }
    const applied = parsed.applied?.[day];
    if (applied && typeof applied.text === "string" && applied.text.trim()) {
      base.applied[day] = {
        text: applied.text.trim().slice(0, 280),
        appliedAt: String(applied.appliedAt || ""),
        transport: "local-stub",
        external: false,
      };
    }
    const slot = parsed.slots?.[day];
    if (slot === "planned" || slot === "leftover") base.slots[day] = slot;
    if (!base.meals[day]) base.slots[day] = "planned";
  }
  return base;
}

function normalizeDay(input) {
  const key = String(input || "").trim().toLowerCase();
  const map = {
    mon: "Mon",
    monday: "Mon",
    tue: "Tue",
    tues: "Tue",
    tuesday: "Tue",
    wed: "Wed",
    wednesday: "Wed",
    thu: "Thu",
    thur: "Thu",
    thurs: "Thu",
    thursday: "Thu",
    fri: "Fri",
    friday: "Fri",
    sat: "Sat",
    saturday: "Sat",
    sun: "Sun",
    sunday: "Sun",
  };
  return map[key] || null;
}

function cloneState(state) {
  return {
    practice: { ...state.practice },
    meals: { ...state.meals },
    slots: { ...state.slots },
    held: { ...state.held },
    applied: { ...state.applied },
    transport: "local-stub",
    external: false,
    kpd: false,
  };
}

function parseQty(qty) {
  const text = String(qty ?? "").trim();
  if (!text || text.includes("/")) return null;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return { amount, unit: match[2].trim().toLowerCase() };
}

function formatAmount(n) {
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
  return String(rounded);
}

function mergeQtyList(qtys) {
  const cleaned = qtys
    .filter((qty) => qty != null && String(qty).trim() !== "")
    .map((qty) => String(qty).trim());
  if (!cleaned.length) return "—";
  if (cleaned.length === 1) return cleaned[0];
  const parsed = cleaned.map(parseQty);
  if (parsed.every(Boolean)) {
    const unit = parsed[0].unit;
    if (parsed.every((entry) => entry.unit === unit)) {
      const sum = parsed.reduce((total, entry) => total + entry.amount, 0);
      const amount = formatAmount(sum);
      return unit ? `${amount} ${unit}` : amount;
    }
  }
  if (cleaned.every((qty) => qty === cleaned[0])) return `${cleaned[0]} × ${cleaned.length}`;
  return cleaned.join(" + ");
}

function mergeGrocery(data, state) {
  const aisles = (data.meta && data.meta.aisles) || [];
  const map = new Map();
  const skippedLeftovers = [];
  for (const day of DAYS) {
    if (state.slots[day] === "leftover") {
      if (state.meals[day]) skippedLeftovers.push(day);
      continue;
    }
    const meal = mealById(data, state.meals[day]);
    if (!meal || !Array.isArray(meal.ingredients)) continue;
    for (const ing of meal.ingredients) {
      const aisle = ing.aisle || "Other";
      const item = String(ing.item || "").trim();
      if (!item) continue;
      const key = `${aisle.toLowerCase()}||${item.toLowerCase()}`;
      if (!map.has(key)) map.set(key, { aisle, item, qtys: [], meals: [] });
      const row = map.get(key);
      if (ing.qty) row.qtys.push(ing.qty);
      if (!row.meals.includes(meal.name)) row.meals.push(meal.name);
    }
  }
  const grouped = new Map();
  for (const row of map.values()) {
    if (!grouped.has(row.aisle)) grouped.set(row.aisle, []);
    grouped.get(row.aisle).push({
      item: row.item,
      qty: mergeQtyList(row.qtys),
      meals: row.meals,
      count: row.meals.length,
      merged: row.qtys.length > 1,
    });
  }
  const order = [...aisles];
  for (const aisle of grouped.keys()) {
    if (!order.includes(aisle)) order.push(aisle);
  }
  const result = [];
  for (const aisle of order) {
    const items = grouped.get(aisle);
    if (!items || !items.length) continue;
    items.sort((a, b) => a.item.localeCompare(b.item));
    result.push({ aisle, items });
  }
  return { merged: true, byAisle: true, aisles: result, skippedLeftovers };
}

function setPractice(data, state, day, on) {
  const next = cloneState(state);
  next.practice[day] = !!on;
  let swapped = null;
  if (next.practice[day]) {
    const meal = mealById(data, next.meals[day]);
    if (meal && !isFast(meal)) {
      const from = next.meals[day];
      next.meals[day] = nextMealId(data, null, true);
      swapped = { from, to: next.meals[day] };
    }
  }
  return { state: next, swapped };
}

function swapDay(data, state, day) {
  const next = cloneState(state);
  const from = next.meals[day];
  const to = nextMealId(data, from, !!next.practice[day]);
  next.meals[day] = to;
  return { state: next, from, to, changed: from !== to };
}

function assignMeal(data, state, day, mealId) {
  const meal = mealById(data, mealId);
  if (!meal) {
    return { error: "not_found", status: 404, message: "That meal is not in the example pack." };
  }
  if (state.practice[day] && !isFast(meal)) {
    return {
      error: "practice_requires_fast",
      status: 409,
      message: "Practice nights only take fast meals.",
    };
  }
  const next = cloneState(state);
  next.meals[day] = meal.id;
  return { state: next, meal };
}

function clearMeals(state) {
  const next = cloneState(state);
  for (const day of DAYS) {
    next.meals[day] = null;
    next.slots[day] = "planned";
  }
  return next;
}

function setSlot(state, day, slot) {
  const value = String(slot ?? "").trim().toLowerCase();
  if (!SLOTS.includes(value)) {
    return {
      error: "bad_slot",
      status: 400,
      message: "Mark the slot planned or leftover.",
    };
  }
  if (value === "leftover" && !state.meals[day]) {
    return {
      error: "needs_meal",
      status: 409,
      message: "Pick a dinner before marking it leftover.",
    };
  }
  const next = cloneState(state);
  next.slots[day] = value;
  return { state: next, slot: value };
}

function shuffleMeals(data, state, rng = Math.random) {
  const next = cloneState(state);
  const used = new Set();
  for (const day of DAYS) {
    let pool = eligible(data, !!next.practice[day]).filter((meal) => !used.has(meal.id));
    if (!pool.length) pool = eligible(data, !!next.practice[day]);
    if (!pool.length) {
      next.meals[day] = null;
      next.slots[day] = "planned";
      continue;
    }
    const index = Math.floor(rng() * pool.length) % pool.length;
    const pick = pool[index];
    next.meals[day] = pick.id;
    next.slots[day] = "planned";
    used.add(pick.id);
  }
  return next;
}

function holdNote(state, day, text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { error: "empty", status: 400, message: "Write a note before holding it." };
  }
  if (trimmed.length > 280) {
    return { error: "too_long", status: 400, message: "Notes are limited to 280 characters." };
  }
  const next = cloneState(state);
  next.held[day] = { text: trimmed, heldAt: new Date().toISOString() };
  return { state: next, held: next.held[day] };
}

function applyNote(state, day) {
  const held = state.held[day];
  if (!held || !held.text) {
    return {
      error: "nothing_held",
      status: 409,
      message: "Hold the note before applying it.",
    };
  }
  const next = cloneState(state);
  const applied = {
    text: held.text,
    appliedAt: new Date().toISOString(),
    transport: "local-stub",
    external: false,
  };
  next.applied[day] = applied;
  delete next.held[day];
  return { state: next, applied };
}

function weekSpan(now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
  })
    .format(now)
    .replace(/\./g, "")
    .slice(0, 3);
  const idx = DAYS.indexOf(wd);
  const offset = idx >= 0 ? idx : 0;
  const [year, month, day] = ymd.split("-").map(Number);
  const monday = Date.UTC(year, month - 1, day) - offset * 86400000;
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const days = DAYS.map((name, i) => {
    const date = new Date(monday + i * 86400000);
    const iso = date.toISOString().slice(0, 10);
    return {
      day: name,
      date: iso,
      dateLabel: fmt.format(date),
      today: iso === ymd,
    };
  });
  return {
    timezone: TIMEZONE,
    label: `${fmt.format(new Date(monday))} – ${fmt.format(new Date(monday + 6 * 86400000))}`,
    today: ymd,
    days,
  };
}

function weekLabel(now = new Date()) {
  return weekSpan(now).label;
}

function presentCatalog(data) {
  return {
    meta: {
      ...(data.meta || {}),
      title: "Family Meal Planner — EXAMPLE/SYNTHETIC",
      source: CLASSIFICATION,
      classification: CLASSIFICATION,
      kpd: false,
      household: "Example household · Millersville",
      disclaimer: "EXAMPLE/SYNTHETIC meals only. Not a real family's menu. Not KPD.",
      practiceNotes: {
        Tue: "EXAMPLE practice block",
        Wed: "EXAMPLE practice block",
        Thu: "EXAMPLE practice block",
      },
    },
    practiceDefaults: data.practiceDefaults || {},
    meals: (data.meals || []).map(stampMeal),
  };
}

function publicMeal(meal) {
  if (!meal) return null;
  return {
    id: meal.id,
    name: meal.name,
    minutes: meal.minutes,
    fast: isFast(meal),
    emoji: meal.emoji || "🍽️",
    tags: meal.tags || [],
    servings: meal.servings,
    ingredients: meal.ingredients || [],
    steps: meal.steps || [],
    source: CLASSIFICATION,
    classification: CLASSIFICATION,
  };
}

function presentWeek(data, state, host, now = new Date()) {
  const span = weekSpan(now);
  const days = span.days.map((slotDay) => {
    const day = slotDay.day;
    const slot = state.slots[day] === "leftover" ? "leftover" : "planned";
    return {
      day,
      name: DAY_FULL[day],
      date: slotDay.date,
      dateLabel: slotDay.dateLabel,
      today: slotDay.today,
      slot,
      practice: !!state.practice[day],
      practiceHint: day === "Tue" || day === "Wed" || day === "Thu" ? "EXAMPLE practice block" : "",
      meal: publicMeal(mealById(data, state.meals[day])),
      held: state.held[day]
        ? { text: state.held[day].text, heldAt: state.held[day].heldAt }
        : null,
      applied: state.applied[day]
        ? {
            text: state.applied[day].text,
            appliedAt: state.applied[day].appliedAt,
            transport: "local-stub",
            external: false,
          }
        : null,
    };
  });
  return {
    ok: true,
    label: span.label,
    timezone: span.timezone,
    classification: CLASSIFICATION,
    kpd: false,
    host: host || "127.0.0.1",
    counts: {
      planned: days.filter((day) => day.meal && day.slot === "planned").length,
      leftover: days.filter((day) => day.slot === "leftover").length,
      open: days.filter((day) => !day.meal).length,
    },
    days,
  };
}

function presentNotes(state) {
  const days = {};
  for (const day of DAYS) {
    days[day] = {
      held: state.held[day]
        ? { text: state.held[day].text, heldAt: state.held[day].heldAt }
        : null,
      applied: state.applied[day]
        ? {
            text: state.applied[day].text,
            appliedAt: state.applied[day].appliedAt,
            transport: "local-stub",
            external: false,
          }
        : null,
    };
  }
  return {
    ok: true,
    transport: "local-stub",
    external: false,
    kpd: false,
    days,
  };
}

function presentFridge(data, state) {
  const week = presentWeek(data, state);
  return {
    ok: true,
    printable: true,
    title: "Millersville weeknight dinners",
    classification: CLASSIFICATION,
    kpd: false,
    label: week.label,
    timezone: week.timezone,
    days: week.days.map((day) => ({
      day: day.day,
      name: day.name,
      date: day.date,
      dateLabel: day.dateLabel,
      today: day.today,
      slot: day.slot,
      practice: day.practice,
      mealId: day.meal && day.meal.id,
      mealName: day.meal ? day.meal.name : null,
      minutes: day.meal ? day.meal.minutes : null,
      emoji: day.meal ? day.meal.emoji : null,
      fast: day.meal ? day.meal.fast : null,
      note: day.applied ? day.applied.text : null,
    })),
  };
}

function forbidden(gate) {
  return {
    ok: false,
    error: "forbidden",
    gate,
    status: 403,
    localOnly: true,
    kpd: false,
    message:
      "Refused. This planner does not order, check out, fabricate meals, share outside this computer, or text kids.",
  };
}

module.exports = {
  DAYS,
  DAY_FULL,
  GATES,
  EXAMPLE_WEEK,
  CLASSIFICATION,
  TIMEZONE,
  SLOTS,
  isFast,
  isGate,
  stampMeal,
  mealById,
  eligible,
  nextMealId,
  freshState,
  sanitizeState,
  normalizeDay,
  mergeQtyList,
  mergeGrocery,
  setPractice,
  swapDay,
  assignMeal,
  clearMeals,
  setSlot,
  shuffleMeals,
  holdNote,
  applyNote,
  weekSpan,
  weekLabel,
  presentCatalog,
  publicMeal,
  presentWeek,
  presentNotes,
  presentFridge,
  forbidden,
};
