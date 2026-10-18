/* Demo transport: a stand-in for the Atlona Boardroom AV Controller plugin.
 *
 * It exposes the same control names the plugin has (SystemOn, ConfirmYes, RouteAll_n,
 * DispNRoute_n, MasterVolumePct, LayerOn_PleaseWait, ...) and reproduces the plugin's
 * behaviour: the System On sequence and warm-up timer, routing feedback, display power,
 * volume and mute. Commands answer after a short random delay, like a real Core would,
 * so the panel's "waiting for feedback" states can be seen and tested.
 *
 * Interface shared by every transport (see transport-qsys.js):
 *   connect()            -> Promise
 *   status               -> "demo" | "connecting" | "connected" | "offline"
 *   get(name)            -> current value (boolean | number | string)
 *   set(name, value)     -> request a value change (feedback arrives via onChange)
 *   trigger(name)        -> press a trigger button
 *   onChange(fn)         -> fn(name, value) for every control change
 *   onStatus(fn)         -> fn(status, detail)
 */
(function () {
  "use strict";

  class DemoTransport {
    constructor(config) {
      this.cfg = config;
      this.demo = config.demo;
      this.status = "connecting";
      this.c = Object.create(null);         // control values
      this.changeFns = [];
      this.statusFns = [];
      this.timers = [];
      this.seq = 0;                          // like the plugin's PowerSeq
      this.NI = this.demo.inputs.length;
      this.ND = this.demo.displays.length;
      this.vmin = this.demo.volumeMinDb;
      this.vmax = this.demo.volumeMaxDb;
      this._seed();
    }

    /* ---------- public API ---------- */
    connect() {
      this._setStatus("connecting");
      return new Promise((resolve) => {
        setTimeout(() => { this._setStatus("demo", "Demo mode - simulated room"); resolve(); }, 450);
      });
    }
    get(name) { return this.c[name]; }
    onChange(fn) { this.changeFns.push(fn); }
    onStatus(fn) { this.statusFns.push(fn); }

    set(name, value) { this._later(() => this._handleSet(name, value)); }
    trigger(name) { this._later(() => this._handleTrigger(name)); }

    /* reset to a powered-off room */
    reset() {
      this.timers.forEach(clearTimeout); this.timers = [];
      this.seq++;
      this._seed(true);
    }

    /* ---------- internals ---------- */
    _setStatus(s, detail) { this.status = s; this.statusFns.forEach((f) => f(s, detail)); }

    _emit(name, value) {
      if (this.c[name] === value) return;
      this.c[name] = value;
      this.changeFns.forEach((f) => f(name, value));
    }

    _later(fn, extra = 0) {
      const [a, b] = this.demo.latencyMs;
      const t = setTimeout(fn, a + Math.random() * (b - a) + extra);
      this.timers.push(t);
    }
    _after(ms, seq, fn) {
      const t = setTimeout(() => { if (seq === this.seq) fn(); }, ms);
      this.timers.push(t);
    }

    _seed(emit) {
      const put = emit ? (k, v) => this._emit(k, v) : (k, v) => { this.c[k] = v; };
      this.demo.inputs.forEach((inp, i) => {
        put(`InputName_${i + 1}`, inp.name);
        put(`InputInUse_${i + 1}`, inp.inUse);
        put(`RouteAll_${i + 1}`, false);
      });
      put("BlankAll", false);
      this.demo.displays.forEach((d, k) => {
        const p = `Disp${k + 1}`;
        put(`${p}Name`, d.name);
        put(`${p}Enabled`, d.enabled);
        put(`${p}StartupOn`, d.startupOn);
        put(`${p}PowerFb`, false);
        put(`${p}Volume`, 30);
        put(`${p}Mute`, false);
        put(`${p}Source`, "Blank");
        put(`${p}Blank`, true);
        for (let i = 1; i <= this.NI; i++) put(`${p}Route_${i}`, false);
      });
      put("SystemPower", false);
      put("WarmupProgress", 0);
      put("WarmupText", "");
      put("WarmupTime", this.cfg.warmupSeconds);
      put("StartupSource", this.demo.inputs[this.demo.startupSource - 1].name);
      put("MasterMute", true);
      const db = this._pctToDb(this.demo.startupVolumePct);
      put("MasterVolume", db);
      put("MasterVolumePct", this.demo.startupVolumePct);
      put("LayerOn_Start", true);
      put("LayerOn_PleaseWait", false);
      put("CurrentLayer", "Start");
    }

    _pctToDb(p) { return Math.round(this.vmin + (this.vmax - this.vmin) * p / 100); }
    _dbToPct(db) { return (db - this.vmin) / (this.vmax - this.vmin) * 100; }
    _enabled() { const t = []; for (let d = 1; d <= this.ND; d++) if (this.c[`Disp${d}Enabled`]) t.push(d); return t; }

    _updateRouteFb(route) {
      // route: { d: inputIndex | 0 }
      Object.entries(route).forEach(([d, i]) => {
        const p = `Disp${d}`;
        for (let n = 1; n <= this.NI; n++) this._emit(`${p}Route_${n}`, n === i);
        this._emit(`${p}Blank`, i === 0);
        this._emit(`${p}Source`, i ? this.c[`InputName_${i}`] : "Blank");
      });
      const act = this._enabled();
      for (let n = 1; n <= this.NI; n++) this._emit(`RouteAll_${n}`, act.length > 0 && act.every((d) => this.c[`Disp${d}Route_${n}`]));
      this._emit("BlankAll", act.length > 0 && act.every((d) => this.c[`Disp${d}Blank`]));
    }

    _route(list, i) { const r = {}; list.forEach((d) => { r[d] = i; }); this._updateRouteFb(r); }

    _dispPower(d, on) { if (this.c[`Disp${d}Enabled`]) this._emit(`Disp${d}PowerFb`, on); }

    _systemOn() {
      if (this.c.LayerOn_PleaseWait) return;           // plugin ignores System On while warming
      const seq = ++this.seq;
      const warm = Math.max(5, Number(this.c.WarmupTime) || 20) * 1000;
      this._emit("SystemPower", true);
      this._emit("LayerOn_Start", false);
      this._emit("LayerOn_PleaseWait", true);
      this._emit("CurrentLayer", "PleaseWait");
      const t0 = Date.now();
      const tick = () => {
        if (seq !== this.seq) return;
        const el = Date.now() - t0;
        this._emit("WarmupProgress", Math.min(100, Math.round(el / warm * 100)));
        this._emit("WarmupText", `${Math.max(0, Math.ceil((warm - el) / 1000))} s`);
        if (el >= warm) {
          this._emit("LayerOn_PleaseWait", false);
          this._emit("WarmupText", "Ready");
          this._emit("CurrentLayer", "RoutingCombined");
        } else {
          this.timers.push(setTimeout(tick, 250));
        }
      };
      tick();
      // same timeline as the plugin's SystemOn()
      this._after(1500, seq, () => {
        for (let d = 1; d <= this.ND; d++) if (this.c[`Disp${d}StartupOn`]) this._dispPower(d, true);
      });
      this._after(2500, seq, () => {
        const name = this.c.StartupSource;
        let src = 1;
        for (let i = 1; i <= this.NI; i++) if (this.c[`InputInUse_${i}`] && this.c[`InputName_${i}`] === name) { src = i; break; }
        this._route(this._enabled(), src);
        const pct = this.demo.startupVolumePct;
        this._emit("MasterVolumePct", pct);
        this._emit("MasterVolume", this._pctToDb(pct));
        this._emit("MasterMute", false);
      });
      this._after(Math.min(10000, Math.max(3000, warm - 3000)), seq, () => {
        for (let d = 1; d <= this.ND; d++) if (this.c[`Disp${d}StartupOn`]) this._emit(`Disp${d}Mute`, false);
      });
    }

    _shutdown() {
      ++this.seq;
      this._emit("MasterMute", true);
      this._enabled().forEach((d) => this._dispPower(d, false));
      this._emit("SystemPower", false);
      this._emit("LayerOn_PleaseWait", false);
      this._emit("LayerOn_Start", true);
      this._emit("WarmupProgress", 0);
      this._emit("WarmupText", "");
      this._emit("CurrentLayer", "Start");
    }

    _handleTrigger(name) {
      let m;
      if (name === "SystemOn") return this._systemOn();
      if (name === "ConfirmYes") return this._shutdown();
      if ((m = name.match(/^Disp(\d+)PowerOn$/))) return this._dispPower(+m[1], true);
      if ((m = name.match(/^Disp(\d+)PowerOff$/))) return this._dispPower(+m[1], false);
      if (/^Disp\d+SetInput$/.test(name)) return;                    // display input select: no state
      // route buttons are toggles in the plugin but act on press
      return this._handleSet(name, true);
    }

    _handleSet(name, value) {
      let m;
      if ((m = name.match(/^RouteAll_(\d+)$/))) return this._route(this._enabled(), +m[1]);
      if (name === "BlankAll") return this._route(this._enabled(), 0);
      if ((m = name.match(/^Disp(\d+)Route_(\d+)$/))) return this._route([+m[1]], +m[2]);
      if ((m = name.match(/^Disp(\d+)Blank$/))) return this._route([+m[1]], 0);
      if (name === "MasterVolumePct") {
        const pct = Math.max(0, Math.min(100, Number(value)));
        const db = this._pctToDb(pct);
        this._emit("MasterVolume", db);
        return this._emit("MasterVolumePct", this._dbToPct(db));      // the switcher works in whole dB
      }
      if (name === "MasterVolume") {
        const db = Math.max(this.vmin, Math.min(this.vmax, Math.round(Number(value))));
        this._emit("MasterVolume", db);
        return this._emit("MasterVolumePct", this._dbToPct(db));
      }
      if (name === "MasterMute") return this._emit("MasterMute", !!value);
      if ((m = name.match(/^Disp(\d+)Volume$/))) return this._emit(name, Math.max(0, Math.min(100, Math.round(Number(value)))));
      if ((m = name.match(/^Disp(\d+)Mute$/))) return this._emit(name, !!value);
      if (name === "WarmupTime") return this._emit(name, Number(value));
      this._emit(name, value);
    }
  }

  window.DemoTransport = DemoTransport;
})();
