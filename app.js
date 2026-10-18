/* Boardroom Control Panel - UI
 *
 * Control rules followed throughout:
 *  - Feedback, not assumption: a button lights only when the system reports the new state.
 *    Between the press and the feedback the button shows a "pending" outline; if no feedback
 *    arrives in 4 s the panel says so.
 *  - Large targets (56 px+ on panels), visible press state on touch, no hover-only UI.
 *  - Destructive action (End meeting) asks first and the prompt cancels itself.
 *  - Hold-to-repeat on volume steps; dragging the fader sends throttled updates.
 *  - The panel returns to Sources after a period of inactivity.
 *  - The screen stays awake while a meeting is on (where the device allows it).
 */
(function () {
  "use strict";

  const CFG = window.BOARDROOM_CONFIG;
  const STORE_KEY = "boardroom.panel.v1";
  const PENDING_MS = 4000;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const app = $("#app");

  /* ---------------- settings (per device) ---------------- */
  const defaults = { transport: CFG.transport, room: CFG.room, warmup: CFG.warmupSeconds, idle: CFG.idleMinutes,
    theme: "auto", layout: "auto", core: CFG.qsys.core, component: CFG.qsys.component, token: CFG.qsys.token };
  let settings = Object.assign({}, defaults, load());
  function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked: keep in memory */ } }

  /* ---------------- transport ---------------- */
  let T = makeTransport();
  function makeTransport() {
    return settings.transport === "qsys" ? new window.QsysTransport(CFG) : new window.DemoTransport(CFG);
  }
  const v = (name) => T.get(name);

  /* ---------------- local UI state ---------------- */
  const ui = { page: "sources", mode: "combined", pickedDisplay: 1, confirmOpen: false, lastTouch: Date.now(),
    draggingVol: false, volHoldUntil: 0, wakeLock: null, pendingUpdate: null };

  /* ---------------- helpers ---------------- */
  function inputCount() { let n = 0; while (v(`InputName_${n + 1}`) !== undefined) n++; return n; }
  function displayCount() { let n = 0; while (v(`Disp${n + 1}Name`) !== undefined) n++; return n; }
  function inputsInUse() { const t = []; for (let i = 1; i <= inputCount(); i++) if (v(`InputInUse_${i}`)) t.push(i); return t; }
  function displays() { const t = []; for (let d = 1; d <= displayCount(); d++) if (v(`Disp${d}Enabled`)) t.push(d); return t; }
  function inputName(i) { return v(`InputName_${i}`) || `Input ${i}`; }
  function dispName(d) { return v(`Disp${d}Name`) || `Display ${d}`; }
  function routeOf(d) { for (let i = 1; i <= inputCount(); i++) if (v(`Disp${d}Route_${i}`)) return i; return 0; }
  function iconFor(name) {
    const n = (name || "").toLowerCase();
    if (/laptop|notebook|table|credenza/.test(n)) return "i-laptop";
    if (/wireless|share|airplay|clickshare|solstice|cast/.test(n)) return "i-wireless";
    if (/\bpc\b|computer|desktop|nuc/.test(n)) return "i-pc";
    if (/conference|\bvc\b|zoom|teams|codec|camera|webex/.test(n)) return "i-camera";
    if (/\btv\b|cable|satellite|iptv/.test(n)) return "i-tv";
    return "i-hdmi";
  }
  function icon(id, cls = "ico") { return `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* not supported */ } }
  function listNames(ds) { const n = ds.map(dispName); return n.length <= 1 ? (n[0] || "") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]; }

  let toastTimer;
  function toast(msg, ms = 3200) {
    const el = $("#toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  /* pending: element waits for a feedback key to change */
  const pending = new Map();   // key -> { els, timer }
  function setPending(key, els) {
    clearPending(key);
    els.forEach((e) => e.classList.add("is-pending"));
    const timer = setTimeout(() => {
      clearPending(key);
      toast("No response from the room system. Check the connection and try again.", 4500);
    }, PENDING_MS);
    pending.set(key, { els, timer });
  }
  function clearPending(key) {
    const p = pending.get(key); if (!p) return;
    clearTimeout(p.timer); p.els.forEach((e) => e.classList.remove("is-pending")); pending.delete(key);
  }

  /* touch press visuals (iOS needs a listener for :active) */
  document.addEventListener("touchstart", () => {}, { passive: true });
  document.addEventListener("pointerdown", (e) => {
    ui.lastTouch = Date.now();
    const b = e.target.closest("button"); if (!b) return;
    b.classList.add("is-pressed");
    const up = () => { b.classList.remove("is-pressed"); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  });
  document.addEventListener("keydown", () => { ui.lastTouch = Date.now(); });
  document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input, .sheet-settings")) e.preventDefault(); });

  /* ---------------- layout ---------------- */
  function computeLayout() {
    if (settings.layout !== "auto") return settings.layout;
    const w = window.innerWidth;
    if (w < 600) return "phone";
    if (w < 1000) return "tablet";
    return "panel";
  }
  function applyLayout() {
    const l = computeLayout();
    if (app.dataset.layout !== l) {
      app.dataset.layout = l;
      if (l === "panel" && ui.page === "volume") showPage("sources");
    }
  }
  window.addEventListener("resize", applyLayout);
  window.addEventListener("orientationchange", applyLayout);

  function applyTheme() {
    const root = document.documentElement;
    // "Match device": only clear a theme this panel set itself, so a host page's own choice survives
    if (settings.theme === "auto") { if (ui.themeSet) { root.removeAttribute("data-theme"); ui.themeSet = false; } }
    else { root.setAttribute("data-theme", settings.theme); ui.themeSet = true; }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || "#1b1613");
  }

  /* ---------------- screens ---------------- */
  function currentScreen() {
    if (!v("SystemPower")) return "start";
    if (v("LayerOn_PleaseWait")) return "wait";
    return "main";
  }
  let lastScreen = null;
  function updateScreen() {
    const s = currentScreen();
    if (s === lastScreen) return;
    const prev = lastScreen; lastScreen = s;
    app.dataset.screen = s;
    if (s === "main" && prev === "wait") { ui.mode = "combined"; showPage("sources"); updateMode(); }
    if (s === "start") { closeConfirm(); clearPending("start"); $("#btn-start").disabled = false; applyQueuedUpdate(); }
    if (s === "wait") buildSteps();
    keepAwake(s !== "start");
  }

  /* ---------------- START ---------------- */
  $("#btn-start").addEventListener("click", () => {
    haptic();
    const b = $("#btn-start");
    if (T.status === "offline") { toast("The panel is offline. Open Panel settings to check the connection."); return; }
    b.disabled = true;
    setPending("start", [b]);
    T.trigger("SystemOn");
  });
  function updateStartHint() {
    const on = displays().filter((d) => v(`Disp${d}StartupOn`));
    const src = v("StartupSource");
    $("#start-hint").textContent = on.length
      ? `Turns on ${listNames(on)}${src ? ` and shows ${src}` : ""}.`
      : (src ? `Shows ${src} when a display is turned on.` : "");
  }

  /* ---------------- PLEASE WAIT ---------------- */
  function steps() {
    const on = displays().filter((d) => v(`Disp${d}StartupOn`));
    const src = v("StartupSource");
    return [
      { label: "Switcher on", done: !!v("SystemPower") },
      { label: on.length ? `Turning on ${listNames(on)}` : "Displays stay off", done: on.every((d) => v(`Disp${d}PowerFb`)) },
      { label: `Showing ${src || "the start-up source"}`, done: displays().length > 0 && displays().every((d) => routeOf(d) > 0) },
      { label: "Setting the room volume", done: v("MasterMute") === false },
      { label: "Ready", done: !v("LayerOn_PleaseWait") && !!v("SystemPower") }
    ];
  }
  function buildSteps() {
    $("#wait-steps").innerHTML = steps().map((s) => `<li><span class="dot">${icon("i-check")}</span><span>${esc(s.label)}</span></li>`).join("");
    updateWait();
  }
  function updateWait() {
    const list = steps(); const lis = $$("#wait-steps li");
    let activeSet = false;
    list.forEach((s, k) => {
      const li = lis[k]; if (!li) return;
      li.lastElementChild.textContent = s.label;
      li.classList.toggle("is-done", s.done);
      const active = !s.done && !activeSet; if (active) activeSet = true;
      li.classList.toggle("is-active", active);
    });
    const pct = Number(v("WarmupProgress")) || 0;
    $("#ring-fill").style.strokeDashoffset = String(326.73 * (1 - pct / 100));
    $("#wait-ring").setAttribute("aria-valuenow", String(pct));
    const secs = parseInt(v("WarmupText"), 10);
    $("#wait-secs").textContent = Number.isFinite(secs) ? secs : Math.round((Number(v("WarmupTime")) || 20) * (1 - pct / 100));
  }

  /* ---------------- NAV ---------------- */
  function showPage(p) {
    if (p === "volume" && app.dataset.layout === "panel") p = "sources";
    ui.page = p;
    $$(".pane").forEach((el) => el.classList.toggle("is-active", el.dataset.pane === p));
    $$(".nav-btn").forEach((b) => { if (b.dataset.nav === p) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#content").scrollTop = 0;
  }
  $$(".nav-btn").forEach((b) => b.addEventListener("click", () => { haptic(); showPage(b.dataset.nav); }));

  /* ---------------- SOURCES ---------------- */
  function updateMode() {
    $("#pane-sources").dataset.mode = ui.mode;
    $$("#route-mode button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === ui.mode)));
  }
  $$("#route-mode button").forEach((b) => b.addEventListener("click", () => { haptic(); ui.mode = b.dataset.mode; updateMode(); }));

  function buildSources() {
    const ins = inputsInUse(); const ds = displays();
    if (!ds.includes(ui.pickedDisplay)) ui.pickedDisplay = ds[0] || 1;

    // room map
    $("#room-map").innerHTML = ds.map((d) => `
      <button type="button" class="mini" data-mini="${d}" aria-label="${esc(dispName(d))}: choose what it shows">
        <span class="mini-screen" data-mini-src></span>
        <span class="mini-label"><b>${esc(dispName(d))}</b><span class="mini-state" data-mini-state></span></span>
      </button>`).join("");
    $$("#room-map .mini").forEach((m) => m.addEventListener("click", () => {
      haptic(); ui.mode = "individual"; ui.pickedDisplay = +m.dataset.mini; updateMode(); updatePicked();
    }));

    // combined tiles
    const tiles = ins.map((i) => `
      <button type="button" class="tile" data-route-all="${i}" aria-pressed="false">
        ${icon(iconFor(inputName(i)))}
        <span><span class="tile-name">${esc(inputName(i))}</span><span class="tile-sub" data-sub></span></span>
      </button>`).join("") + `
      <button type="button" class="tile tile-blank" data-route-all="0" aria-pressed="false">
        ${icon("i-blank")}
        <span><span class="tile-name">Blank screens</span><span class="tile-sub" data-sub></span></span>
      </button>`;
    $("#tiles-combined").innerHTML = tiles;
    $$("#tiles-combined .tile").forEach((t) => t.addEventListener("click", () => {
      haptic();
      const i = +t.dataset.routeAll;
      if (t.getAttribute("aria-pressed") === "true") return;      // already showing: nothing to do
      setPending("route-all", [t]);
      if (i === 0) T.set("BlankAll", true); else T.set(`RouteAll_${i}`, true);
    }));

    // individual: picker (phones) + one column per display
    $("#disp-picker").innerHTML = ds.map((d) => `<button type="button" role="radio" data-pick="${d}">${icon("i-display")}<span>${esc(dispName(d))}</span></button>`).join("");
    $$("#disp-picker button").forEach((b) => b.addEventListener("click", () => { haptic(); ui.pickedDisplay = +b.dataset.pick; updatePicked(); }));
    $("#disp-cols").innerHTML = ds.map((d) => `
      <div class="disp-col" data-col="${d}">
        <h3>${icon("i-display")}${esc(dispName(d))}</h3>
        ${ins.map((i) => `<button type="button" class="row-btn" data-route="${d}:${i}" aria-pressed="false">${icon(iconFor(inputName(i)))}<span>${esc(inputName(i))}</span></button>`).join("")}
        <button type="button" class="row-btn" data-route="${d}:0" aria-pressed="false">${icon("i-blank")}<span>Blank</span></button>
      </div>`).join("");
    $$("#disp-cols .row-btn").forEach((b) => b.addEventListener("click", () => {
      haptic();
      const [d, i] = b.dataset.route.split(":").map(Number);
      if (b.getAttribute("aria-pressed") === "true") return;
      setPending(`route-${d}`, [b]);
      if (i === 0) T.set(`Disp${d}Blank`, true); else T.set(`Disp${d}Route_${i}`, true);
    }));
    updatePicked();
    updateSources();
  }
  function updatePicked() {
    $$("#disp-picker button").forEach((b) => b.setAttribute("aria-checked", String(+b.dataset.pick === ui.pickedDisplay)));
    $$("#disp-cols .disp-col").forEach((c) => c.classList.toggle("is-picked", +c.dataset.col === ui.pickedDisplay));
  }
  function updateSources() {
    const ds = displays();
    // combined tiles: lit only when every enabled display shows it
    $$("#tiles-combined .tile").forEach((t) => {
      const i = +t.dataset.routeAll;
      const on = i === 0 ? !!v("BlankAll") : !!v(`RouteAll_${i}`);
      t.setAttribute("aria-pressed", String(on));
      const showing = ds.filter((d) => routeOf(d) === i);
      const sub = t.querySelector("[data-sub]");
      if (i === 0) sub.textContent = on ? "Nothing on screen" : "";
      else if (on) sub.textContent = ds.length > 1 ? "On both displays" : "On screen";
      else if (showing.length) sub.textContent = `On ${listNames(showing)}`;
      else sub.textContent = "";
    });
    $$("#disp-cols .row-btn").forEach((b) => {
      const [d, i] = b.dataset.route.split(":").map(Number);
      b.setAttribute("aria-pressed", String(routeOf(d) === i));
    });
    // room map + display cards share the "screen" rendering
    ds.forEach((d) => {
      const powered = !!v(`Disp${d}PowerFb`);
      const r = routeOf(d);
      const text = !powered ? "Off" : (r ? inputName(r) : "Blank");
      $$(`[data-mini="${d}"], [data-card="${d}"]`).forEach((m) => {
        m.dataset.power = powered ? "on" : "off";
        const s = m.querySelector("[data-mini-src]"); if (s) s.textContent = text;
        const st = m.querySelector("[data-mini-state]"); if (st) st.textContent = powered ? "On" : "Off";
      });
    });
  }

  /* ---------------- VOLUME ---------------- */
  function buildVolume(host) {
    host.innerHTML = `
      <div class="vol" data-muted="false">
        <div class="vol-read"><div class="vol-num"><span data-vol-num>0</span><small>%</small></div><div class="vol-state" data-vol-state>Room volume</div></div>
        <div class="fader" role="slider" tabindex="0" aria-label="Room volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-orientation="vertical">
          <div class="fader-ticks" aria-hidden="true">${"<i></i>".repeat(11)}</div>
          <div class="fader-fill"></div><div class="fader-thumb"></div>
        </div>
        <div class="vol-steps">
          <button type="button" class="round-btn" data-vol-step="-1" aria-label="Volume down">${icon("i-minus")}</button>
          <button type="button" class="round-btn" data-vol-step="1" aria-label="Volume up">${icon("i-plus")}</button>
        </div>
        <button type="button" class="mute-btn" data-mute aria-pressed="false">${icon("i-mute")}<span>Mute</span></button>
      </div>`;
    const fader = host.querySelector(".fader");
    let lastSend = 0, sendTimer = null;
    const send = (pct, force) => {
      const now = Date.now();
      clearTimeout(sendTimer);
      if (force || now - lastSend > 120) { lastSend = now; T.set("MasterVolumePct", pct); }
      else sendTimer = setTimeout(() => { lastSend = Date.now(); T.set("MasterVolumePct", pct); }, 120);
    };
    const pctFromY = (y) => { const r = fader.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(100, (r.bottom - y) / r.height * 100))); };
    fader.addEventListener("pointerdown", (e) => {
      fader.setPointerCapture(e.pointerId); ui.draggingVol = true;
      const p = pctFromY(e.clientY); paintVolume(p); send(p, true);
    });
    fader.addEventListener("pointermove", (e) => { if (!ui.draggingVol) return; const p = pctFromY(e.clientY); paintVolume(p); send(p); });
    const end = (e) => {
      if (!ui.draggingVol) return; ui.draggingVol = false; ui.volHoldUntil = Date.now() + 700;
      const p = pctFromY(e.clientY); paintVolume(p); send(p, true);
    };
    fader.addEventListener("pointerup", end); fader.addEventListener("pointercancel", end);
    fader.addEventListener("keydown", (e) => {
      const step = { ArrowUp: 2, ArrowRight: 2, ArrowDown: -2, ArrowLeft: -2, PageUp: 10, PageDown: -10 }[e.key];
      if (!step) return; e.preventDefault(); nudgeVolume(step);
    });
    host.querySelectorAll("[data-vol-step]").forEach((b) => holdRepeat(b, () => nudgeVolume(2 * Number(b.dataset.volStep))));
    host.querySelector("[data-mute]").addEventListener("click", () => { haptic(); T.set("MasterMute", !v("MasterMute")); });
  }
  let volTarget = null;
  function nudgeVolume(delta) {
    const base = volTarget !== null && Date.now() < ui.volHoldUntil ? volTarget : Number(v("MasterVolumePct")) || 0;
    const p = Math.max(0, Math.min(100, Math.round(base + delta)));
    volTarget = p; ui.volHoldUntil = Date.now() + 700;
    paintVolume(p);
    if (delta > 0 && v("MasterMute")) T.set("MasterMute", false);   // turning it up un-mutes, as people expect
    T.set("MasterVolumePct", p);
  }
  function paintVolume(pct) {
    $$(".vol").forEach((vol) => {
      vol.querySelector("[data-vol-num]").textContent = Math.round(pct);
      vol.querySelector(".fader-fill").style.height = pct + "%";
      vol.querySelector(".fader-thumb").style.bottom = `clamp(10px, ${pct}%, calc(100% - 10px))`;
      vol.querySelector(".fader").setAttribute("aria-valuenow", String(Math.round(pct)));
    });
  }
  function updateVolume() {
    const muted = !!v("MasterMute");
    if (!ui.draggingVol && Date.now() > ui.volHoldUntil) { volTarget = null; paintVolume(Number(v("MasterVolumePct")) || 0); }
    $$(".vol").forEach((vol) => {
      vol.dataset.muted = String(muted);
      vol.querySelector("[data-vol-state]").textContent = muted ? "Muted" : "Room volume";
      const m = vol.querySelector("[data-mute]"); m.setAttribute("aria-pressed", String(muted));
      m.querySelector("span").textContent = muted ? "Unmute" : "Mute";
    });
  }
  // feedback that arrives while the user is still adjusting is applied once they stop
  setInterval(() => { if (!ui.draggingVol && volTarget !== null && Date.now() > ui.volHoldUntil) updateVolume(); }, 250);

  function holdRepeat(btn, fn) {
    let t1 = null, t2 = null;
    const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      haptic(); fn(); stop();
      t1 = setTimeout(() => { t2 = setInterval(fn, 140); }, 420);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener("click", (e) => { if (e.detail === 0) fn(); });   // keyboard Enter / Space
  }

  /* ---------------- DISPLAYS ---------------- */
  function buildDisplayCards() {
    $("#disp-cards").innerHTML = displays().map((d) => `
      <article class="dcard" data-card="${d}" data-power="off">
        <div class="dcard-head"><h3>${esc(dispName(d))}</h3><span class="mini-state" data-mini-state></span></div>
        <div class="mini-screen" data-mini-src></div>
        <div class="dcard-row">
          <span>Power</span>
          <span class="pill-pair">
            <button type="button" class="btn" data-dpow="${d}:on" aria-pressed="false">${icon("i-power")}On</button>
            <button type="button" class="btn" data-dpow="${d}:off" aria-pressed="false">Off</button>
          </span>
        </div>
        <div class="dcard-row">
          <span>Display speakers</span>
          <span class="stepper">
            <button type="button" class="round-btn" data-dvol="${d}:-1" aria-label="${esc(dispName(d))} volume down">${icon("i-minus")}</button>
            <output data-dvol-out="${d}">0</output>
            <button type="button" class="round-btn" data-dvol="${d}:1" aria-label="${esc(dispName(d))} volume up">${icon("i-plus")}</button>
            <button type="button" class="round-btn" data-dmute="${d}" aria-pressed="false" aria-label="Mute ${esc(dispName(d))}">${icon("i-mute")}</button>
          </span>
        </div>
        <div class="dcard-row">
          <span>Display input</span>
          <button type="button" class="btn btn-ghost" data-dinput="${d}">${icon("i-input")}Select switcher input</button>
        </div>
      </article>`).join("");
    $$("[data-dpow]").forEach((b) => b.addEventListener("click", () => {
      haptic();
      const [d, s] = b.dataset.dpow.split(":");
      setPending(`power-${d}`, [b]);
      T.trigger(`Disp${d}Power${s === "on" ? "On" : "Off"}`);
    }));
    const dvTarget = {};
    $$("[data-dvol]").forEach((b) => {
      const [d, dir] = b.dataset.dvol.split(":").map(Number);
      holdRepeat(b, () => {
        const base = dvTarget[d] !== undefined ? dvTarget[d] : Number(v(`Disp${d}Volume`)) || 0;
        const val = Math.max(0, Math.min(100, base + dir));
        dvTarget[d] = val; clearTimeout(dvTarget[`t${d}`]);
        dvTarget[`t${d}`] = setTimeout(() => { delete dvTarget[d]; }, 900);
        $(`[data-dvol-out="${d}"]`).textContent = val;
        T.set(`Disp${d}Volume`, val);
      });
    });
    $$("[data-dmute]").forEach((b) => b.addEventListener("click", () => { haptic(); const d = b.dataset.dmute; T.set(`Disp${d}Mute`, !v(`Disp${d}Mute`)); }));
    $$("[data-dinput]").forEach((b) => b.addEventListener("click", () => {
      haptic(); const d = b.dataset.dinput; T.trigger(`Disp${d}SetInput`); toast(`Sent the input command to ${dispName(d)}.`);
    }));
    updateDisplayCards();
  }
  function updateDisplayCards() {
    displays().forEach((d) => {
      const on = !!v(`Disp${d}PowerFb`);
      const onB = $(`[data-dpow="${d}:on"]`), offB = $(`[data-dpow="${d}:off"]`);
      if (onB) onB.setAttribute("aria-pressed", String(on));
      if (offB) offB.setAttribute("aria-pressed", String(!on));
      const out = $(`[data-dvol-out="${d}"]`); if (out && !document.activeElement?.dataset?.dvol) out.textContent = v(`Disp${d}Volume`) ?? 0;
      const m = $(`[data-dmute="${d}"]`); if (m) m.setAttribute("aria-pressed", String(!!v(`Disp${d}Mute`)));
    });
  }

  /* ---------------- END MEETING ---------------- */
  let confirmTimer = null, returnFocus = null;
  $("#btn-end").addEventListener("click", () => { haptic(); openConfirm(); });
  function openConfirm() {
    ui.confirmOpen = true; returnFocus = document.activeElement;
    $("#confirm").hidden = false; $("#confirm-no").focus();
    let left = CFG.confirmTimeoutSeconds;
    const note = $("#confirm-timer");
    const tick = () => {
      note.textContent = `This closes by itself in ${left} s.`;
      if (left-- <= 0) closeConfirm();
    };
    clearInterval(confirmTimer); tick(); confirmTimer = setInterval(tick, 1000);
  }
  function closeConfirm() {
    if (!ui.confirmOpen) return;
    ui.confirmOpen = false; clearInterval(confirmTimer);
    $("#confirm").hidden = true;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }
  $("#confirm-no").addEventListener("click", () => { haptic(); closeConfirm(); });
  $("#confirm-yes").addEventListener("click", () => {
    haptic();
    const b = $("#confirm-yes");
    setPending("end", [b]);
    T.trigger("ConfirmYes");
  });
  $("#confirm").addEventListener("click", (e) => { if (e.target.id === "confirm") closeConfirm(); });

  /* ---------------- SETTINGS (hold the room name 2 s) ---------------- */
  $$("[data-hold-settings]").forEach((el) => {
    let t = null, x = 0, y = 0;
    el.addEventListener("pointerdown", (e) => { x = e.clientX; y = e.clientY; t = setTimeout(openSettings, 2000); });
    el.addEventListener("pointermove", (e) => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 12) { clearTimeout(t); t = null; } });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => el.addEventListener(ev, () => { clearTimeout(t); t = null; }));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (!$("#settings").hidden) closeSettings(); else closeConfirm(); }
    if (e.key === "," && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSettings(); }
  });
  function openSettings() {
    haptic();
    const f = $("#settings-form");
    f.transport.value = settings.transport; f.room.value = settings.room; f.warmup.value = String(settings.warmup);
    f.idle.value = String(settings.idle); f.theme.value = settings.theme; f.layout.value = settings.layout;
    f.core.value = settings.core || ""; f.component.value = settings.component || ""; f.token.value = settings.token || "";
    $("#settings").hidden = false; $("#settings-close").focus();
  }
  function closeSettings() { $("#settings").hidden = true; }
  $("#settings-close").addEventListener("click", closeSettings);
  $("#settings").addEventListener("click", (e) => { if (e.target.id === "settings") closeSettings(); });
  $("#settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    settings.room = f.room.value.trim() || CFG.room;
    settings.warmup = Number(f.warmup.value); settings.idle = Number(f.idle.value);
    settings.theme = f.theme.value; settings.layout = f.layout.value;
    settings.core = f.core.value.trim(); settings.component = f.component.value.trim(); settings.token = f.token.value;
    save(); applySettings(); closeSettings(); toast("Settings saved.");
  });
  $("#settings-reset").addEventListener("click", () => {
    if (T.reset) T.reset();
    T.set("WarmupTime", settings.warmup);
    closeSettings(); toast("Demo room reset. Everything is off.");
  });
  function applySettings() {
    $$("[data-room-name]").forEach((el) => { el.textContent = settings.room; });
    document.title = `${settings.room} Control Panel`;
    applyTheme(); applyLayout();
    T.set("WarmupTime", settings.warmup);
  }

  /* ---------------- clock, connection, idle, wake lock ---------------- */
  function tickClock() {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    $$("[data-clock]").forEach((el) => { el.textContent = time; });
    $$("[data-date]").forEach((el) => { el.textContent = date; });
  }
  setInterval(tickClock, 10000);

  function updateConn(status, detail) {
    const label = { demo: "Demo", connected: "Connected", connecting: "Connecting", offline: "Offline" }[status] || status;
    $$("[data-conn]").forEach((el) => { el.dataset.state = status; el.textContent = label; el.title = detail || label; });
    if (status === "offline" && detail) toast(detail, 6000);
  }

  setInterval(() => {
    if (!settings.idle || lastScreen !== "main" || !$("#settings").hidden) return;
    if (Date.now() - ui.lastTouch > settings.idle * 60000 && (ui.page !== "sources" || ui.mode !== "combined" || ui.confirmOpen)) {
      closeConfirm(); ui.mode = "combined"; updateMode(); showPage("sources");
    }
  }, 15000);

  async function keepAwake(on) {
    try {
      if (on && !ui.wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
        ui.wakeLock = await navigator.wakeLock.request("screen");
        ui.wakeLock.addEventListener("release", () => { ui.wakeLock = null; });
      } else if (!on && ui.wakeLock) { await ui.wakeLock.release(); ui.wakeLock = null; }
    } catch (e) { ui.wakeLock = null; /* not allowed on this device */ }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(lastScreen !== "start"); });

  /* ---------------- feedback dispatch ---------------- */
  let rebuildQueued = false;
  function queueRebuild() {
    if (rebuildQueued) return; rebuildQueued = true;
    requestAnimationFrame(() => { rebuildQueued = false; buildSources(); buildDisplayCards(); updateStartHint(); });
  }
  T.onStatus(updateConn);
  T.onChange(onChange);
  function onChange(name) {
    if (/^(InputName_|InputInUse_|Disp\d+(Name|Enabled))/.test(name)) { queueRebuild(); return; }
    if (/^Disp\d+StartupOn$|^StartupSource$/.test(name)) updateStartHint();

    if (/^(RouteAll_|BlankAll)/.test(name)) clearPending("route-all");
    let m = name.match(/^Disp(\d+)(Route_|Blank|Source)/);
    if (m) { clearPending(`route-${m[1]}`); clearPending("route-all"); }
    m = name.match(/^Disp(\d+)PowerFb$/);
    if (m) clearPending(`power-${m[1]}`);
    if (name === "SystemPower") { clearPending(v("SystemPower") ? "start" : "end"); }

    if (/Route_|Blank|Source|PowerFb|RouteAll_/.test(name)) { updateSources(); updateDisplayCards(); }
    if (/^Disp\d+(Volume|Mute)$/.test(name)) updateDisplayCards();
    if (/^Master(Volume|VolumePct|Mute)$/.test(name)) updateVolume();
    if (/^(SystemPower|LayerOn_PleaseWait)$/.test(name)) updateScreen();
    if (lastScreen === "wait") updateWait();
  }

  /* ---------------- service worker (installable, works offline) ---------------- */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    const okOrigin = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!okOrigin) return;
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            ui.pendingUpdate = nw;
            if (lastScreen === "start") applyQueuedUpdate();
            else toast("A panel update is ready. It installs when the meeting ends.", 5000);
          }
        });
      });
    }).catch(() => { /* not allowed here (preview frames, private mode) */ });
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }
  function applyQueuedUpdate() { if (ui.pendingUpdate) { ui.pendingUpdate.postMessage("skipWaiting"); ui.pendingUpdate = null; } }

  /* ---------------- boot ---------------- */
  $$("[data-version]").forEach((el) => { el.textContent = CFG.version; });
  tickClock();
  applySettings();
  buildVolume($('[data-volume-block="big"]'));
  buildVolume($('[data-volume-block="rail"]'));
  buildSources(); buildDisplayCards(); updateStartHint(); updateMode(); showPage("sources");
  updateVolume(); updateScreen(); updateConn(T.status);
  T.connect().then(() => { T.set("WarmupTime", settings.warmup); });
  registerSW();
})();
