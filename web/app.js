(function () {
  "use strict";

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_FULL = {
    Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
    Fri: "Friday", Sat: "Saturday", Sun: "Sunday"
  };
  const AISLE_ICONS = {
    "Produce": "🥬",
    "Meat & Seafood": "🥩",
    "Dairy & Eggs": "🧀",
    "Bakery": "🥖",
    "Pantry": "🫙",
    "Frozen": "🧊",
    "Snacks": "🍿",
    "Other": "📦"
  };

  const DATA = window.__MEALS__ || { meals: [], meta: {}, practiceDefaults: {} };
  const MEALS = Array.isArray(DATA.meals) ? DATA.meals : [];
  const AISLES = (DATA.meta && DATA.meta.aisles) || Object.keys(AISLE_ICONS);
  const STORE_KEY = "fmp-week-v1";

  let plan = loadPlan();
  let pickerDay = null;
  let checkedItems = loadChecked();

  function loadPlan() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.meals && p.practice) return p;
      }
    } catch (_) {}
    return defaultPlan();
  }

  function defaultPlan() {
    const defaults = DATA.practiceDefaults || {};
    const practice = {};
    const meals = {};
    DAYS.forEach((d) => {
      practice[d] = !!defaults[d];
      meals[d] = null;
    });
    return { practice, meals };
  }

  function savePlan() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(plan));
    } catch (_) {}
  }

  function loadChecked() {
    try {
      return JSON.parse(localStorage.getItem("fmp-checked-v1") || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function saveChecked() {
    try {
      localStorage.setItem("fmp-checked-v1", JSON.stringify(checkedItems));
    } catch (_) {}
  }

  function mealById(id) {
    return MEALS.find((m) => m.id === id) || null;
  }

  function weekLabel() {
    const now = new Date();
    const day = (now.getDay() + 6) % 7; // Mon=0
    const mon = new Date(now);
    mon.setDate(now.getDate() - day);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (d) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(mon)} – ${fmt(sun)}`;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((el) => {
      const on = el.id === "screen-" + name;
      el.hidden = !on;
      el.classList.toggle("active", on);
    });
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.screen === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (name === "grocery") renderGrocery();
    if (name === "fridge") renderFridge();
    if (name === "about") renderAbout();
  }

  function routeFromHash() {
    const h = (location.hash || "#week").replace("#", "").split("?")[0];
    const ok = ["week", "grocery", "fridge", "about"].includes(h) ? h : "week";
    showScreen(ok);
  }

  function pickRandom(pool) {
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function candidatesForDay(day) {
    const needFast = !!plan.practice[day];
    let pool = MEALS.slice();
    if (needFast) pool = pool.filter((m) => m.fast || m.minutes <= 20);
    return pool;
  }

  function shuffleWeek() {
    const used = new Set();
    DAYS.forEach((d) => {
      let pool = candidatesForDay(d).filter((m) => !used.has(m.id));
      if (!pool.length) pool = candidatesForDay(d);
      const pick = pickRandom(pool);
      plan.meals[d] = pick ? pick.id : null;
      if (pick) used.add(pick.id);
    });
    savePlan();
    renderWeek();
    renderFridge();
    renderGrocery();
  }

  function clearWeek() {
    DAYS.forEach((d) => {
      plan.meals[d] = null;
    });
    savePlan();
    renderWeek();
    renderFridge();
    renderGrocery();
  }

  function setPractice(day, on) {
    plan.practice[day] = !!on;
    // If practice turned on and current meal is slow, clear it
    const m = mealById(plan.meals[day]);
    if (on && m && !(m.fast || m.minutes <= 20)) {
      plan.meals[day] = null;
    }
    savePlan();
    renderWeek();
    renderFridge();
  }

  function applyPracticeDefaults(on) {
    if (!on) return;
    const defaults = DATA.practiceDefaults || {};
    DAYS.forEach((d) => {
      plan.practice[d] = !!defaults[d];
      const m = mealById(plan.meals[d]);
      if (plan.practice[d] && m && !(m.fast || m.minutes <= 20)) {
        plan.meals[d] = null;
      }
    });
    savePlan();
    renderWeek();
    renderFridge();
  }

  function openPicker(day) {
    pickerDay = day;
    const box = $("#mealPicker");
    box.hidden = false;
    $("#pickerTitle").textContent = `Pick dinner · ${DAY_FULL[day]}`;
    const forceFast = !!plan.practice[day];
    const filt = $("#filterFast");
    filt.checked = forceFast;
    filt.disabled = forceFast;
    renderMealList();
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closePicker() {
    pickerDay = null;
    $("#mealPicker").hidden = true;
  }

  function renderMealList() {
    const list = $("#mealList");
    const onlyFast = $("#filterFast").checked;
    let pool = MEALS.slice();
    if (onlyFast) pool = pool.filter((m) => m.fast || m.minutes <= 20);
    list.innerHTML = pool
      .map((m) => {
        const fast = m.fast || m.minutes <= 20;
        return `<button type="button" class="meal-option" data-id="${m.id}">
          <span class="meal-emoji">${m.emoji || "🍽️"}</span>
          <span class="meal-name">${escapeHtml(m.name)}</span>
          <span class="meal-meta">
            <span class="badge ${fast ? "fast" : "slow"}">${m.minutes} min</span>
            ${(m.tags || []).slice(0, 2).map((t) => `<span>${escapeHtml(t)}</span>`).join("")}
          </span>
        </button>`;
      })
      .join("");
    list.querySelectorAll(".meal-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!pickerDay) return;
        plan.meals[pickerDay] = btn.dataset.id;
        savePlan();
        closePicker();
        renderWeek();
        renderFridge();
        renderGrocery();
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderWeek() {
    const grid = $("#weekGrid");
    grid.innerHTML = DAYS.map((d) => {
      const m = mealById(plan.meals[d]);
      const prac = !!plan.practice[d];
      const note = (DATA.practiceNotes && DATA.practiceNotes[d]) || "";
      let body;
      if (m) {
        const fast = m.fast || m.minutes <= 20;
        const mismatch = prac && !fast;
        body = `
          <div class="day-body" data-pick="${d}" role="button" tabindex="0">
            <span class="meal-emoji">${m.emoji || "🍽️"}</span>
            <div class="meal-name">${escapeHtml(m.name)}</div>
            <div class="meal-meta">
              <span class="badge ${fast ? "fast" : "slow"}">${m.minutes} min</span>
              ${mismatch ? '<span class="badge warn">slow for practice</span>' : ""}
            </div>
          </div>`;
      } else {
        body = `
          <div class="day-body" data-pick="${d}" role="button" tabindex="0">
            <div class="day-empty">Tap to choose dinner${prac ? " (fast)" : ""}</div>
          </div>`;
      }
      return `<article class="day-card ${prac ? "practice" : ""}" data-day="${d}">
        <div class="day-head">
          <span class="day-name">${DAY_FULL[d]}</span>
          <button type="button" class="day-toggle" data-toggle="${d}" title="${escapeHtml(note || "Toggle practice night")}">
            ${prac ? "⚡ Practice" : "Home night"}
          </button>
        </div>
        ${body}
        <div class="day-actions">
          <button type="button" class="btn ghost" data-pick="${d}">Choose</button>
          <button type="button" class="btn ghost" data-rand="${d}">Lucky</button>
        </div>
      </article>`;
    }).join("");

    grid.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = btn.dataset.toggle;
        setPractice(d, !plan.practice[d]);
      });
    });
    grid.querySelectorAll("[data-pick]").forEach((el) => {
      el.addEventListener("click", () => openPicker(el.dataset.pick));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker(el.dataset.pick);
        }
      });
    });
    grid.querySelectorAll("[data-rand]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const d = btn.dataset.rand;
        const pick = pickRandom(candidatesForDay(d));
        plan.meals[d] = pick ? pick.id : null;
        savePlan();
        renderWeek();
        renderFridge();
        renderGrocery();
      });
    });
  }

  function buildGrocery() {
    const map = new Map(); // key = aisle|item lower
    DAYS.forEach((d) => {
      const m = mealById(plan.meals[d]);
      if (!m || !m.ingredients) return;
      m.ingredients.forEach((ing) => {
        const aisle = ing.aisle || "Other";
        const key = aisle + "||" + String(ing.item).toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            aisle,
            item: ing.item,
            qtys: [],
            meals: []
          });
        }
        const row = map.get(key);
        if (ing.qty) row.qtys.push(ing.qty);
        if (!row.meals.includes(m.name)) row.meals.push(m.name);
      });
    });
    const byAisle = {};
    AISLES.forEach((a) => {
      byAisle[a] = [];
    });
    map.forEach((row) => {
      if (!byAisle[row.aisle]) byAisle[row.aisle] = [];
      byAisle[row.aisle].push(row);
    });
    Object.keys(byAisle).forEach((a) => {
      byAisle[a].sort((x, y) => x.item.localeCompare(y.item));
    });
    return byAisle;
  }

  function renderGrocery() {
    const byAisle = buildGrocery();
    const stack = $("#groceryByAisle");
    const empty = $("#groceryEmpty");
    let total = 0;
    Object.values(byAisle).forEach((arr) => {
      total += arr.length;
    });
    empty.hidden = total > 0;
    stack.innerHTML = "";
    if (!total) return;

    AISLES.forEach((aisle) => {
      const items = byAisle[aisle] || [];
      if (!items.length) return;
      const card = document.createElement("div");
      card.className = "aisle-card panel";
      card.innerHTML = `<h3>${AISLE_ICONS[aisle] || "📦"} ${escapeHtml(aisle)} <span class="count">${items.length}</span></h3>`;
      items.forEach((row) => {
        const id = aisle + "||" + row.item.toLowerCase();
        const done = !!checkedItems[id];
        const line = document.createElement("label");
        line.className = "g-item" + (done ? " done" : "");
        line.innerHTML = `
          <input type="checkbox" data-gid="${escapeHtml(id)}" ${done ? "checked" : ""}/>
          <span>
            <strong>${escapeHtml(row.item)}</strong>
            <span class="g-meals">${escapeHtml(row.meals.join(" · "))}</span>
          </span>
          <span class="g-qty">${escapeHtml(uniqueJoin(row.qtys))}</span>`;
        card.appendChild(line);
      });
      stack.appendChild(card);
    });

    stack.querySelectorAll("input[data-gid]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const id = inp.dataset.gid;
        if (inp.checked) checkedItems[id] = true;
        else delete checkedItems[id];
        saveChecked();
        inp.closest(".g-item").classList.toggle("done", inp.checked);
      });
    });
  }

  function uniqueJoin(arr) {
    return [...new Set(arr.filter(Boolean))].join(" + ") || "—";
  }

  function groceryPlainText() {
    const byAisle = buildGrocery();
    const lines = ["Family Meal Planner — grocery (SAMPLE)", weekLabel(), ""];
    AISLES.forEach((aisle) => {
      const items = byAisle[aisle] || [];
      if (!items.length) return;
      lines.push(aisle.toUpperCase());
      items.forEach((row) => {
        lines.push(`- [ ] ${row.item}  (${uniqueJoin(row.qtys)})`);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  function renderFridge() {
    $("#fridgeDates").textContent = weekLabel() + " · SAMPLE recipes";
    const grid = $("#fridgeGrid");
    grid.innerHTML = DAYS.map((d) => {
      const m = mealById(plan.meals[d]);
      const prac = !!plan.practice[d];
      if (!m) {
        return `<div class="fridge-day ${prac ? "practice" : ""}">
          <div class="dn">${d}${prac ? " ⚡" : ""}</div>
          <div class="empty-f">TBD</div>
        </div>`;
      }
      return `<div class="fridge-day ${prac ? "practice" : ""}">
        <div class="dn">${d}${prac ? " ⚡" : ""}</div>
        <div class="fn">${escapeHtml(m.emoji || "")} ${escapeHtml(m.name)}</div>
        <div class="fm">${m.minutes} min</div>
      </div>`;
    }).join("");
  }

  function renderAbout() {
    const fast = MEALS.filter((m) => m.fast || m.minutes <= 20).length;
    $("#aboutStats").textContent =
      `${MEALS.length} sample meals · ${fast} fast (≤20 min) · aisles: ${AISLES.join(", ")}`;
  }

  function init() {
    $("#weekPill").textContent = weekLabel();
    if (DATA.meta && DATA.meta.disclaimer) {
      $("#sampleBanner").textContent = DATA.meta.disclaimer;
    }

    // First visit: auto-shuffle so screenshots look full
    const anyMeal = DAYS.some((d) => plan.meals[d]);
    if (!anyMeal && MEALS.length) shuffleWeek();
    else renderWeek();

    renderFridge();
    renderGrocery();
    renderAbout();

    $("#btnShuffle").addEventListener("click", shuffleWeek);
    $("#btnClear").addEventListener("click", clearWeek);
    $("#btnClosePicker").addEventListener("click", closePicker);
    $("#filterFast").addEventListener("change", renderMealList);
    $("#autoPractice").addEventListener("change", (e) => {
      applyPracticeDefaults(e.target.checked);
    });
    $("#btnPrint").addEventListener("click", () => window.print());
    $("#btnCopyList").addEventListener("click", async () => {
      const text = groceryPlainText();
      try {
        await navigator.clipboard.writeText(text);
        $("#btnCopyList").textContent = "✓ Copied";
        setTimeout(() => {
          $("#btnCopyList").textContent = "📋 Copy";
        }, 1400);
      } catch (_) {
        prompt("Copy grocery list:", text);
      }
    });
    $("#btnUncheckAll").addEventListener("click", () => {
      checkedItems = {};
      saveChecked();
      renderGrocery();
    });

    window.addEventListener("hashchange", routeFromHash);
    routeFromHash();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
