(function () {
  "use strict";

  const AISLE_ICONS = {
    Produce: "🥬",
    "Meat & Seafood": "🥩",
    "Dairy & Eggs": "🧀",
    Bakery: "🥖",
    Pantry: "🫙",
    Frozen: "🧊",
    Snacks: "🍿",
    Other: "📦",
  };
  const CHECK_KEY = "fmp-checks-v2";

  let model = null;
  let pickerDay = null;
  let toastTimer = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toast(message) {
    const node = $("toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 2600);
  }

  async function api(pathname, options) {
    const res = await fetch(pathname, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(body.message || body.error || "Request failed");
      error.status = res.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  function post(pathname, payload) {
    return api(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  function checks() {
    try {
      return JSON.parse(localStorage.getItem(CHECK_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function saveChecks(map) {
    localStorage.setItem(CHECK_KEY, JSON.stringify(map));
  }

  function showScreen(name) {
    const screens = ["week", "grocery", "fridge", "notes", "about"];
    const next = screens.includes(name) ? name : "week";
    document.querySelectorAll(".screen").forEach((el) => {
      const on = el.id === "screen-" + next;
      el.hidden = !on;
      el.classList.toggle("active", on);
    });
    document.querySelectorAll(".tab").forEach((tab) => {
      const on = tab.dataset.screen === next;
      tab.classList.toggle("active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function route() {
    const hash = (location.hash || "#week").replace("#", "").split("?")[0];
    showScreen(hash);
  }

  async function load() {
    const [catalog, week, grocery, fridge, notes, health, meta] = await Promise.all([
      api("/api/meals"),
      api("/api/week"),
      api("/api/grocery"),
      api("/api/fridge"),
      api("/api/notes"),
      api("/api/health"),
      api("/api/meta"),
    ]);
    if (catalog.meta.kpd !== false || health.kpd !== false || meta.kpd !== false) {
      toast("Refusing to show data that is not marked synthetic.");
      return;
    }
    catalog.meals = catalog.meals.filter(
      (meal) => meal.source === "EXAMPLE/SYNTHETIC" && meal.classification === "EXAMPLE/SYNTHETIC"
    );
    model = { catalog, week, grocery, fridge, notes, health, meta };
    $("weekPill").textContent = week.label;
    $("sampleBanner").textContent = catalog.meta.disclaimer + " This page stays on 127.0.0.1.";
    render();
  }

  async function refresh(message) {
    try {
      await load();
      if (message) toast(message);
    } catch (error) {
      toast(error.message || "The planner on this computer did not answer.");
    }
  }

  function render() {
    renderWeek();
    renderGrocery();
    renderFridge();
    renderNotes();
    renderAbout();
  }

  function renderWeek() {
    const counts = model.week.counts || { planned: 0, leftover: 0, open: 0 };
    $("deskSummary").textContent =
      `${model.week.label} · ${model.week.timezone || "America/New_York"} · ${counts.planned} planned · ${counts.leftover} leftover · EXAMPLE/SYNTHETIC`;
    const grid = $("weekGrid");
    grid.innerHTML = model.week.days
      .map((day) => {
        const meal = day.meal;
        const slot = day.slot === "leftover" ? "leftover" : "planned";
        const applied = day.applied ? `<p class="day-note">Applied: ${escapeHtml(day.applied.text)}</p>` : "";
        const held = day.held ? `<p class="day-note draft">Held draft</p>` : "";
        const body = meal
          ? `<div class="day-body">
              <span class="meal-emoji">${escapeHtml(meal.emoji)}</span>
              <div class="meal-name">${escapeHtml(meal.name)}</div>
              <div class="meal-meta"><span class="badge ${meal.fast ? "fast" : "slow"}">${meal.minutes} min</span></div>
              ${applied}${held}
            </div>`
          : `<div class="day-body"><div class="day-empty">Open slot${day.practice ? " · fast dinner" : ""}</div>${applied}${held}</div>`;
        const leftoverDisabled = meal ? "" : "disabled";
        return `<article class="day-card ${day.practice ? "practice" : ""} ${day.today ? "today" : ""} ${slot}" data-day="${day.day}">
          <div class="day-head">
            <div>
              <span class="day-name">${escapeHtml(day.day)}</span>
              <span class="day-date">${escapeHtml(day.dateLabel || "")}</span>
            </div>
            <button type="button" class="switch" role="switch" aria-checked="${day.practice ? "true" : "false"}" data-practice="${day.day}" data-testid="practice-${day.day}" aria-label="${escapeHtml(day.name)} practice night">
              <span class="switch-knob" aria-hidden="true"></span>
              <span>${day.practice ? "Practice" : "Home"}</span>
            </button>
          </div>
          ${day.today ? '<span class="today-chip">Today · ET</span>' : ""}
          ${body}
          <div class="slot-toggle" role="group" aria-label="${escapeHtml(day.name)} planned or leftover">
            <button type="button" data-slot="${day.day}" data-value="planned" aria-pressed="${slot === "planned" ? "true" : "false"}" data-testid="slot-${day.day}-planned">Planned</button>
            <button type="button" data-slot="${day.day}" data-value="leftover" aria-pressed="${slot === "leftover" ? "true" : "false"}" data-testid="slot-${day.day}-leftover" ${leftoverDisabled}>Leftover</button>
          </div>
          <div class="day-actions">
            <button type="button" class="btn ghost" data-choose="${day.day}">Choose</button>
            <button type="button" class="btn ghost" data-swap="${day.day}" data-testid="swap-${day.day}">Swap</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderGrocery() {
    const stack = $("groceryByAisle");
    const empty = $("groceryEmpty");
    const aisles = model.grocery.aisles || [];
    const total = aisles.reduce((sum, aisle) => sum + aisle.items.length, 0);
    const skipped = model.grocery.skippedLeftovers || [];
    empty.hidden = total > 0;
    if (!total && skipped.length) {
      empty.hidden = false;
      empty.querySelector("p").textContent =
        "Every filled night is marked leftover, so the grocery list is empty. Nothing was ordered.";
    } else {
      empty.querySelector("p").textContent = "No meals planned yet. Fill the week grid first.";
    }
    const saved = checks();
    const skipNote = skipped.length
      ? `<p class="hint skip-note">Leftover, not shopped: ${skipped.map(escapeHtml).join(", ")}. Local mark only.</p>`
      : "";
    stack.innerHTML = skipNote + aisles
      .map((aisle) => {
        const lines = aisle.items
          .map((item) => {
            const id = `${aisle.aisle}||${item.item.toLowerCase()}`;
            const done = !!saved[id];
            return `<label class="g-item${done ? " done" : ""}">
              <input type="checkbox" data-check="${escapeHtml(id)}" ${done ? "checked" : ""}/>
              <span>
                <strong>${escapeHtml(item.item)}</strong>
                ${item.merged ? '<span class="badge fast">merged</span>' : ""}
                <span class="g-meals">${escapeHtml(item.meals.join(" · "))}</span>
              </span>
              <span class="g-qty">${escapeHtml(item.qty)}</span>
            </label>`;
          })
          .join("");
        return `<div class="aisle-card panel">
          <h3>${AISLE_ICONS[aisle.aisle] || "📦"} ${escapeHtml(aisle.aisle)} <span class="count">${aisle.items.length}</span></h3>
          ${lines}
        </div>`;
      })
      .join("");
  }

  function renderFridge() {
    $("fridgeDates").textContent = `${model.fridge.label} · EXAMPLE/SYNTHETIC · Not KPD`;
    $("fridgeGrid").innerHTML = model.fridge.days
      .map((day) => {
        const note = day.note ? `<div class="fn note">${escapeHtml(day.note)}</div>` : "";
        const slot = day.slot === "leftover" ? "Leftover" : "Planned";
        if (!day.mealName) {
          return `<div class="fridge-day ${day.practice ? "practice" : ""}">
            <div class="dn">${escapeHtml(day.day)} ${escapeHtml(day.dateLabel || "")}${day.practice ? " ⚡" : ""}</div>
            <div class="empty-f">Open</div>
            ${note}
          </div>`;
        }
        return `<div class="fridge-day ${day.practice ? "practice" : ""} ${day.slot === "leftover" ? "leftover" : ""}">
          <div class="dn">${escapeHtml(day.day)} ${escapeHtml(day.dateLabel || "")}${day.practice ? " ⚡" : ""}</div>
          <div class="fn">${escapeHtml(day.emoji || "")} ${escapeHtml(day.mealName)}</div>
          <div class="fm">${day.minutes} min · ${slot}</div>
          ${note}
        </div>`;
      })
      .join("");
  }

  function renderNotes() {
    $("notesGrid").innerHTML = model.week.days
      .map((day) => {
        const record = model.notes.days[day.day] || { held: null, applied: null };
        const heldText = record.held ? record.held.text : "";
        const applied = record.applied;
        const status = record.held
          ? "Held on this computer. Apply writes the local stub."
          : applied
            ? "Applied on this computer only."
            : "Nothing held.";
        return `<article class="note-card panel" data-day="${day.day}">
          <div class="day-head">
            <h3>${escapeHtml(day.name)}</h3>
            ${day.practice ? '<span class="badge fast">Practice</span>' : ""}
          </div>
          <label class="note-label">Note
            <textarea data-note-text="${day.day}" maxlength="280" rows="3">${escapeHtml(heldText || (applied ? applied.text : ""))}</textarea>
          </label>
          <p class="hint tight">Hold stages the draft. Apply stores it in the local stub. It is not sent.</p>
          <div class="toolbar-actions">
            <button type="button" class="btn" data-hold="${day.day}" data-testid="hold-${day.day}">Hold</button>
            <button type="button" class="btn ghost" data-apply="${day.day}" data-testid="apply-${day.day}" ${record.held ? "" : "disabled"}>Apply</button>
          </div>
          <p class="status" data-status="${day.day}">${escapeHtml(status)}</p>
          ${applied ? `<p class="applied-line">Local stub: ${escapeHtml(applied.text)}</p>` : ""}
        </article>`;
      })
      .join("");
  }

  function renderAbout() {
    const fast = model.catalog.meals.filter((meal) => meal.fast).length;
    $("aboutStats").textContent = `${model.catalog.meals.length} example meals · ${fast} fast · ${model.health.host} · not KPD`;
    $("gateList").innerHTML = (model.meta.gates || [])
      .map(
        (gate) => `<li>
          <code>${escapeHtml(gate)}</code>
          <button type="button" class="btn ghost sm" data-probe="${escapeHtml(gate)}">Check</button>
          <span data-probe-result="${escapeHtml(gate)}"></span>
        </li>`
      )
      .join("");
  }

  function openPicker(day) {
    pickerDay = day;
    const current = model.week.days.find((entry) => entry.day === day);
    $("pickerTitle").textContent = `Pick dinner · ${current.name}`;
    $("pickerHint").textContent = current.practice
      ? "Practice night. Fast EXAMPLE/SYNTHETIC meals only."
      : "EXAMPLE/SYNTHETIC meals.";
    const meals = model.catalog.meals.filter((meal) => !current.practice || meal.fast);
    $("mealList").innerHTML = meals
      .map(
        (meal) => `<button type="button" class="meal-option" data-assign="${escapeHtml(meal.id)}">
          <span class="meal-emoji">${escapeHtml(meal.emoji)}</span>
          <span class="meal-name">${escapeHtml(meal.name)}</span>
          <span class="meal-meta"><span class="badge ${meal.fast ? "fast" : "slow"}">${meal.minutes} min</span></span>
        </button>`
      )
      .join("");
    $("picker").showModal();
  }

  function closePicker() {
    pickerDay = null;
    const dialog = $("picker");
    if (dialog.open) dialog.close();
  }

  function groceryText() {
    const lines = [
      "Family Meal Planner — grocery (EXAMPLE/SYNTHETIC)",
      model.week.label,
      "Not KPD. Local copy only.",
      "",
    ];
    for (const aisle of model.grocery.aisles || []) {
      lines.push(aisle.aisle.toUpperCase());
      for (const item of aisle.items) lines.push(`- [ ] ${item.item}  (${item.qty})`);
      lines.push("");
    }
    return lines.join("\n");
  }

  document.addEventListener("click", async (event) => {
    const slot = event.target.closest("[data-slot]");
    const practice = event.target.closest("[data-practice]");
    const swap = event.target.closest("[data-swap]");
    const choose = event.target.closest("[data-choose]");
    const assign = event.target.closest("[data-assign]");
    const hold = event.target.closest("[data-hold]");
    const apply = event.target.closest("[data-apply]");
    const probe = event.target.closest("[data-probe]");
    try {
      if (slot) {
        if (slot.disabled) return;
        const day = slot.dataset.slot;
        const value = slot.dataset.value;
        const result = await post("/api/week/slot", { day, slot: value });
        const label = value === "leftover" ? "leftover, off the grocery list" : "planned";
        await refresh(`${day} is ${label}. Nothing was ordered.`);
        if (result.ordered) toast("Refusing a response that claims an order.");
      } else if (practice) {
        const day = practice.dataset.practice;
        const on = practice.getAttribute("aria-checked") !== "true";
        await post("/api/week/practice", { day, on });
        await refresh(on ? `${day} is a practice night` : `${day} is a home night`);
      } else if (swap) {
        await post("/api/week/swap", { day: swap.dataset.swap });
        await refresh("Swapped");
      } else if (choose) {
        openPicker(choose.dataset.choose);
      } else if (assign && pickerDay) {
        const day = pickerDay;
        closePicker();
        await post("/api/week/meal", { day, mealId: assign.dataset.assign });
        await refresh("Dinner saved");
      } else if (hold) {
        const day = hold.dataset.hold;
        const text = document.querySelector(`[data-note-text="${day}"]`).value;
        await post("/api/notes/hold", { day, text });
        await refresh("Held on this computer");
      } else if (apply) {
        await post("/api/notes/apply", { day: apply.dataset.apply });
        await refresh("Applied on this computer only");
      } else if (probe) {
        const gate = probe.dataset.probe;
        const res = await fetch("/api/" + gate, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const body = await res.json().catch(() => ({}));
        const slot = document.querySelector(`[data-probe-result="${gate}"]`);
        if (slot) slot.textContent = `${res.status} ${body.error || ""}`.trim();
        if (res.status !== 403) toast("Expected a 403 from " + gate);
      }
    } catch (error) {
      toast(error.message || "Request failed");
    }
  });

  document.addEventListener("input", (event) => {
    const box = event.target.closest("[data-note-text]");
    if (!box || !model) return;
    const day = box.dataset.noteText;
    const record = model.notes.days[day];
    const button = document.querySelector(`[data-apply="${day}"]`);
    if (!button || !record || !record.held) return;
    button.disabled = box.value.trim() !== record.held.text;
  });

  document.addEventListener("change", (event) => {
    const box = event.target.closest("[data-check]");
    if (!box) return;
    const map = checks();
    if (box.checked) map[box.dataset.check] = true;
    else delete map[box.dataset.check];
    saveChecks(map);
    box.closest(".g-item").classList.toggle("done", box.checked);
  });

  $("btnShuffle").addEventListener("click", async () => {
    try {
      await post("/api/week/shuffle");
      await refresh("Week shuffled");
    } catch (error) {
      toast(error.message);
    }
  });
  $("btnClear").addEventListener("click", async () => {
    try {
      await post("/api/week/clear");
      await refresh("Week cleared");
    } catch (error) {
      toast(error.message);
    }
  });
  $("btnClosePicker").addEventListener("click", closePicker);
  $("btnPrint").addEventListener("click", () => {
    showScreen("fridge");
    window.print();
  });
  $("btnCopy").addEventListener("click", async () => {
    const text = groceryText();
    try {
      await navigator.clipboard.writeText(text);
      toast("Grocery list copied on this computer");
    } catch (_) {
      toast("Copy is unavailable in this browser");
    }
  });
  $("btnUncheck").addEventListener("click", () => {
    saveChecks({});
    renderGrocery();
  });

  window.addEventListener("hashchange", route);
  route();
  load().catch((error) => {
    toast(error.message || "The planner on this computer did not answer.");
  });
})();
