/* Boardroom Control Panel - configuration
 *
 * Everything the panel shows comes from the plugin's own controls (input names, which inputs
 * are in use, display names, ...). In demo mode the values below stand in for the plugin's
 * setup pages so the panel looks like a configured room.
 *
 * Control names used throughout the app are the Atlona Boardroom AV Controller plugin's
 * control names (v1.5.0), so switching from the demo engine to the live Q-SYS connection
 * does not change the UI code.
 */
window.BOARDROOM_CONFIG = {
  version: "0.1.0",

  room: "Boardroom",

  // "demo" now; "qsys" once the live connection is added
  transport: "demo",

  qsys: {
    core: "",              // Core IP or hostname
    component: "BoardroomAV", // the plugin's Code Name in the design
    token: ""              // Core Manager access token, if Access Control is enabled
  },

  // Seconds the "Starting the room" screen stays up (plugin: Warm-up Time)
  warmupSeconds: 20,

  // Return to the Sources page after this many idle minutes while a meeting is on (0 = never)
  idleMinutes: 5,

  // Show a countdown on the End Meeting prompt and cancel it automatically
  confirmTimeoutSeconds: 30,

  // ---- demo room: mirrors what you would enter on the plugin's setup pages ----
  demo: {
    inputs: [
      // plugin controls: InputName_n / InputInUse_n
      { name: "Table Laptop",       inUse: true },   // 1  HDBaseT In 1 (table box)
      { name: "Credenza Laptop",    inUse: true },   // 2  HDBaseT In 2
      { name: "Wireless Share",     inUse: true },   // 3  HDBaseT In 3
      { name: "Room PC",            inUse: true },   // 4  HDMI 4
      { name: "Video Conference",   inUse: true },   // 5  HDMI 5
      { name: "Cable TV",           inUse: true },   // 6  HDMI 6
      { name: "HDMI 7",             inUse: false },  // 7  not used - hidden
      { name: "Input 8",            inUse: false }   // 8  not used - hidden
    ],
    displays: [
      // plugin controls: DispNName / DispNEnabled / DispNStartupOn
      { name: "Left Display",  enabled: true, startupOn: true },
      { name: "Right Display", enabled: true, startupOn: true }
    ],
    startupSource: 1,      // plugin: Startup Source
    startupVolumePct: 45,  // plugin: Startup Volume (shown as %)
    volumeMinDb: -80,      // plugin property: Volume Min (dB)
    volumeMaxDb: 10,       // plugin property: Volume Max (dB)
    latencyMs: [120, 260]  // simulated round-trip so pending states are visible
  }
};
