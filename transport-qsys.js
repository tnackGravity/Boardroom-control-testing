/* Q-SYS transport (next version) - live connection to the Boardroom plugin.
 *
 * Plan:
 *   - Connect with Q-SYS Remote WebSocket Control (QRWC, npm package @q-sys/qrwc) over
 *     WebSocket on port 443 of the Core. Requires: Core Manager > Network > Services >
 *     WebSocket enabled; the plugin's Code Access set to "External" or "All" and a Code Name
 *     (config.qsys.component); an access token when Access Control is on.
 *   - Subscribe to the plugin's controls and forward every change through onChange(name, value),
 *     exactly as DemoTransport does. The UI code does not change.
 *   - set(name, value) / trigger(name) write the plugin's controls.
 *   - Keep the socket alive (the Core closes it after 60 s without traffic) and reconnect with
 *     back-off; report "connecting" / "connected" / "offline" through onStatus.
 *
 * Until then this class only reports that the live connection is not available, so a panel
 * accidentally set to "qsys" says so instead of looking frozen.
 */
(function () {
  "use strict";

  // Controls the panel reads; the live transport will subscribe to exactly these.
  function controlList(ni, nd) {
    const names = ["SystemPower", "WarmupProgress", "WarmupText", "WarmupTime", "StartupSource",
      "MasterVolume", "MasterVolumePct", "MasterMute", "BlankAll", "CurrentLayer",
      "LayerOn_Start", "LayerOn_PleaseWait", "ConnStatus"];
    for (let i = 1; i <= ni; i++) names.push(`InputName_${i}`, `InputInUse_${i}`, `RouteAll_${i}`);
    for (let d = 1; d <= nd; d++) {
      const p = `Disp${d}`;
      names.push(`${p}Name`, `${p}Enabled`, `${p}StartupOn`, `${p}PowerFb`, `${p}Volume`, `${p}Mute`, `${p}Source`, `${p}Blank`);
      for (let i = 1; i <= ni; i++) names.push(`${p}Route_${i}`);
    }
    return names;
  }

  class QsysTransport {
    constructor(config) {
      this.cfg = config;
      this.status = "offline";
      this.c = Object.create(null);
      this.changeFns = [];
      this.statusFns = [];
      this.controls = controlList(8, 2);
    }
    connect() {
      this._setStatus("offline", "Live Q-SYS connection is not in this version. Switch to Demo mode in Panel settings.");
      return Promise.resolve();
    }
    get(name) { return this.c[name]; }
    set() {}
    trigger() {}
    onChange(fn) { this.changeFns.push(fn); }
    onStatus(fn) { this.statusFns.push(fn); }
    _setStatus(s, detail) { this.status = s; this.statusFns.forEach((f) => f(s, detail)); }
  }

  window.QsysTransport = QsysTransport;
})();
