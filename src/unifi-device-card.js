import {
  discoverPorts,
  discoverSpecialPorts,
  formatState,
  getDeviceContext,
  getPortLinkText,
  getPortSpeedText,
  isOn,
  mergePortsWithLayout,
  mergeSpecialsWithLayout,
  stateValue,
} from "./helpers.js";
import { getApiClient, formatBytes, formatSpeed } from "./unifi-api.js";
import "./unifi-device-card-editor.js";

const VERSION = __VERSION__;

// ─────────────────────────────────────────────────────────────────────────────
// Data-source abstraction
//
// _ctx  → HA context (device, entities, layout …)
// _api  → live UniFi API port table, indexed by port_idx
//         { 1: {up, speed, poe_enable, poe_power, rx_rate, tx_rate, mac_table}, … }
// ─────────────────────────────────────────────────────────────────────────────

class UnifiDeviceCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("unifi-device-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config          = {};
    this._ctx             = null;   // HA device context
    this._apiPortMap      = null;   // Map<portIdx, portData> from direct API
    this._apiDeviceId     = null;   // UniFi _id of the device (for write ops)
    this._apiDeviceMac    = null;   // MAC of the device
    this._selectedKey     = null;
    this._loading         = false;
    this._loadToken       = 0;
    this._loadedDeviceId  = null;
    // Periodic API refresh
    this._apiTimer        = null;
    this._apiError        = null;
  }

  static get REFRESH_MS() { return 10_000; } // live refresh every 10 s

  setConfig(config) {
    const oldDeviceId = this._config?.device_id || null;
    const newConfig   = config || {};
    const newDeviceId = newConfig?.device_id || null;

    this._config = newConfig;

    if (oldDeviceId !== newDeviceId) {
      this._ctx            = null;
      this._apiPortMap     = null;
      this._apiDeviceId    = null;
      this._apiDeviceMac   = null;
      this._selectedKey    = null;
      this._loadedDeviceId = null;
      this._loading        = false;
      this._stopApiTimer();

      if (this._hass && newDeviceId) { this._ensureLoaded(); return; }
    }

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureLoaded();
    this._render();
  }

  disconnectedCallback() {
    this._stopApiTimer();
  }

  getCardSize() { return 8; }

  // ── Timer management ──────────────────────────────────────────────────────

  _startApiTimer() {
    if (this._apiTimer) return;
    if (!this._config?.unifi_host) return;
    this._apiTimer = setInterval(() => this._refreshApiData(), UnifiDeviceCard.REFRESH_MS);
  }

  _stopApiTimer() {
    if (this._apiTimer) { clearInterval(this._apiTimer); this._apiTimer = null; }
  }

  // ── Load orchestration ────────────────────────────────────────────────────

  async _ensureLoaded() {
    if (!this._hass || !this._config?.device_id) return;
    const currentId = this._config.device_id;
    if (this._loadedDeviceId === currentId && this._ctx) return;
    if (this._loading) return;

    this._loading = true;
    this._render();
    const token = ++this._loadToken;

    try {
      const ctx = await getDeviceContext(this._hass, currentId);
      if (token !== this._loadToken) return;

      this._ctx            = ctx;
      this._loadedDeviceId = currentId;

      const numbered = mergePortsWithLayout(ctx?.layout, discoverPorts(ctx?.entities || []));
      const specials  = mergeSpecialsWithLayout(ctx?.layout, discoverSpecialPorts(ctx?.entities || []));
      const first     = specials[0] || numbered[0] || null;
      this._selectedKey = first?.key || null;

      // If direct API is configured, kick off the first load in parallel
      if (this._config?.unifi_host) {
        this._refreshApiData(); // fire-and-forget first fetch
        this._startApiTimer();
      }
    } catch (err) {
      console.error("[unifi-device-card] HA context load failed", err);
      if (token !== this._loadToken) return;
      this._ctx            = null;
      this._loadedDeviceId = null;
    }

    this._loading = false;
    this._render();
  }

  /**
   * Fetch live data from the UniFi API and update _apiPortMap.
   * Called on first load and periodically by the timer.
   */
  async _refreshApiData() {
    const client = getApiClient(this._config);
    if (!client) return;

    try {
      // Resolve MAC if not yet known
      if (!this._apiDeviceMac) {
        await this._resolveApiDevice(client);
      }

      if (!this._apiDeviceMac) return; // still not found

      const portTable = await client.getPortTable(this._apiDeviceMac);
      const map       = new Map();
      for (const p of portTable) map.set(p.port_idx, p);
      this._apiPortMap = map;
      this._apiError   = null;
    } catch (err) {
      console.warn("[unifi-device-card] API refresh failed:", err.message);
      this._apiError = err.message;
    }

    this._render();
  }

  /**
   * Try to match the selected HA device to a UniFi API device by MAC or name.
   */
  async _resolveApiDevice(client) {
    // Explicit MAC in config → use that directly
    if (this._config?.unifi_mac) {
      this._apiDeviceMac = this._config.unifi_mac;
      return;
    }

    if (!this._ctx) return;

    try {
      const devices = await client.getDevices();

      // Try matching by serial_number (most reliable)
      const haDevice = this._ctx.device;
      const serial   = haDevice?.serial_number?.toLowerCase();

      let match = null;

      if (serial) {
        match = devices.find((d) =>
          d.serial?.toLowerCase() === serial ||
          d.mac?.toLowerCase().replace(/:/g,"") === serial.replace(/:/g,"")
        );
      }

      // Fallback: match by name
      if (!match) {
        const haName = String(
          haDevice?.name_by_user || haDevice?.name || ""
        ).toLowerCase();
        match = devices.find((d) =>
          String(d.name || "").toLowerCase() === haName
        );
      }

      if (match) {
        this._apiDeviceId  = match._id;
        this._apiDeviceMac = match.mac;
        console.info("[unifi-device-card] Resolved API device:", match.mac, match.name);
      } else {
        console.warn("[unifi-device-card] Could not match HA device to UniFi API device");
      }
    } catch (err) {
      console.warn("[unifi-device-card] Device resolve failed:", err.message);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  _selectKey(key) { this._selectedKey = key; this._render(); }

  async _togglePoe(slot) {
    const client = getApiClient(this._config);

    if (client && this._apiDeviceId && slot.port) {
      // API mode: get current state from live map
      const apiPort = this._apiPortMap?.get(slot.port);
      const current = apiPort ? apiPort.poe_enable : false;
      try {
        await client.setPortPoe(this._apiDeviceId, slot.port, !current);
        await new Promise((r) => setTimeout(r, 800)); // let controller apply
        await this._refreshApiData();
        return;
      } catch (err) {
        console.error("[unifi-device-card] PoE toggle via API failed:", err);
        // fall through to HA
      }
    }

    // HA fallback
    if (slot.poe_switch_entity && this._hass) {
      const [domain] = slot.poe_switch_entity.split(".");
      await this._hass.callService(domain, "toggle", { entity_id: slot.poe_switch_entity });
    }
  }

  async _powerCycle(slot) {
    const client = getApiClient(this._config);

    if (client && this._apiDeviceMac && slot.port) {
      try {
        await client.powerCyclePort(this._apiDeviceMac, slot.port);
        await new Promise((r) => setTimeout(r, 1200));
        await this._refreshApiData();
        return;
      } catch (err) {
        console.error("[unifi-device-card] Power cycle via API failed:", err);
      }
    }

    // HA fallback
    if (slot.power_cycle_entity && this._hass) {
      await this._hass.callService("button", "press", { entity_id: slot.power_cycle_entity });
    }
  }

  // ── Data helpers: merge HA + API ──────────────────────────────────────────

  /**
   * Is the port link up?
   * API data takes priority over HA entities.
   */
  _portIsUp(slot) {
    if (this._apiPortMap && slot.port) {
      const p = this._apiPortMap.get(slot.port);
      if (p) return p.up;
    }
    return isOn(this._hass, slot.link_entity);
  }

  /**
   * PoE enabled?
   */
  _portPoeEnabled(slot) {
    if (this._apiPortMap && slot.port) {
      const p = this._apiPortMap.get(slot.port);
      if (p) return p.poe_enable;
    }
    return isOn(this._hass, slot.poe_switch_entity);
  }

  /**
   * Has any PoE capability?
   */
  _portHasPoe(slot) {
    if (this._apiPortMap && slot.port) {
      const p = this._apiPortMap.get(slot.port);
      if (p) return p.poe_mode !== null && p.poe_mode !== undefined;
    }
    return Boolean(slot.power_cycle_entity);
  }

  _subtitle() {
    if (!this._config?.device_id || !this._ctx) return `Version ${VERSION}`;
    const fw    = this._ctx?.firmware;
    const model = this._ctx?.layout?.displayModel || this._ctx?.model || "";
    const src   = this._apiPortMap ? " · API ✓" : "";
    return fw ? `${model} · FW ${fw}${src}` : `${model}${src}`;
  }

  _connectedCount(allSlots) {
    return allSlots.filter((s) => this._portIsUp(s)).length;
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  _styles() {
    return `<style>
      :host {
        --udc-bg:      #141820;
        --udc-surface: #1e2433;
        --udc-surf2:   #252d3d;
        --udc-border:  rgba(255,255,255,0.07);
        --udc-accent:  #0090d9;
        --udc-aglow:   rgba(0,144,217,0.2);
        --udc-green:   #22c55e;
        --udc-orange:  #f59e0b;
        --udc-red:     #ef4444;
        --udc-text:    #e2e8f0;
        --udc-muted:   #4e5d73;
        --udc-dim:     #8896a8;
        --udc-r:       14px;
        --udc-rsm:     8px;
      }
      ha-card {
        background: var(--udc-bg) !important;
        color: var(--udc-text) !important;
        border: 1px solid var(--udc-border) !important;
        border-radius: var(--udc-r) !important;
        overflow: hidden;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      }

      /* ── HEADER ── */
      .header {
        padding: 16px 18px 13px;
        background: linear-gradient(160deg, var(--udc-surface) 0%, var(--udc-bg) 100%);
        border-bottom: 1px solid var(--udc-border);
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
      }
      .header-info { display: grid; gap: 2px; min-width: 0; }
      .title {
        font-size: 1.05rem; font-weight: 700; letter-spacing: -.02em;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .subtitle { font-size: 0.73rem; color: var(--udc-muted); }
      .header-chips { display: flex; gap: 7px; flex-shrink: 0; align-items: center; }

      .chip {
        display: flex; align-items: center; gap: 5px;
        background: var(--udc-surf2); border: 1px solid var(--udc-border);
        border-radius: 20px; padding: 3px 10px;
        font-size: 0.71rem; font-weight: 700; white-space: nowrap; color: var(--udc-dim);
      }
      .chip .dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--udc-green); box-shadow: 0 0 5px var(--udc-green);
        animation: blink 2.5s ease-in-out infinite;
      }
      .chip.api-chip { color: var(--udc-accent); border-color: rgba(0,144,217,.25); }
      .chip.api-chip .dot { background: var(--udc-accent); box-shadow: 0 0 5px var(--udc-accent); }
      @keyframes blink {
        0%,100% { opacity:1; } 50% { opacity:.4; }
      }

      /* ── FRONT PANEL ── */
      .frontpanel {
        padding: 13px 18px 10px; display: grid; gap: 6px;
        background: var(--udc-surface); border-bottom: 1px solid var(--udc-border);
      }
      .panel-label {
        font-size: 0.63rem; font-weight: 700; letter-spacing: .1em;
        text-transform: uppercase; color: var(--udc-muted); margin-bottom: 1px;
      }
      .special-row { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 4px; }
      .port-row    { display: grid; gap: 4px; }
      .frontpanel.single-row         .port-row,
      .frontpanel.gateway-single-row .port-row { grid-template-columns: repeat(8, minmax(0,1fr)); }
      .frontpanel.dual-row           .port-row { grid-template-columns: repeat(8, minmax(0,1fr)); }
      .frontpanel.gateway-rack       .port-row { grid-template-columns: repeat(8, minmax(0,1fr)); }
      .frontpanel.gateway-compact    .port-row { grid-template-columns: repeat(5, minmax(0,1fr)); }
      .frontpanel.quad-row           .port-row { grid-template-columns: repeat(12, minmax(0,1fr)); }

      /* ── PORT BUTTON ── */
      .port {
        border: 1px solid rgba(255,255,255,.06); border-radius: 7px;
        min-height: 40px; cursor: pointer; font: inherit;
        display: grid; place-items: center; gap: 1px; padding: 3px 2px;
        background: var(--udc-bg); transition: all .13s ease;
        position: relative; overflow: hidden;
      }
      .port::after {
        content:''; position:absolute; top:0; left:0; right:0;
        height:2px; background:transparent; transition:background .15s;
      }
      .port.up { background: rgba(34,197,94,.06); border-color: rgba(34,197,94,.25); }
      .port.up::after { background: var(--udc-green); }
      .port:hover { transform: translateY(-1px); border-color: rgba(0,144,217,.35); background: rgba(0,144,217,.07); }
      .port.selected {
        border-color: var(--udc-accent) !important;
        background: rgba(0,144,217,.12) !important;
        box-shadow: 0 0 0 1px var(--udc-accent), inset 0 0 10px rgba(0,144,217,.08);
      }
      .port.selected::after { background: var(--udc-accent) !important; }
      .port.has-poe.up::after { background: linear-gradient(90deg, var(--udc-green) 50%, var(--udc-orange)); }
      .port.special { min-height: 46px; border-radius: 9px; min-width: 58px; padding: 5px 9px; }
      .port-num { font-size: 10px; font-weight: 800; line-height: 1; color: var(--udc-dim); }
      .port.up .port-num { color: var(--udc-text); }
      .port-icon { font-size: 8px; line-height: 1; color: var(--udc-muted); }
      .port.up .port-icon    { color: var(--udc-green); }
      .port.has-poe.up .port-icon { color: var(--udc-orange); }

      /* ── DETAIL SECTION ── */
      .section { padding: 14px 18px 18px; display: grid; gap: 14px; }
      .api-banner {
        display: flex; align-items: center; gap: 7px;
        background: rgba(0,144,217,.08); border: 1px solid rgba(0,144,217,.2);
        border-radius: var(--udc-rsm); padding: 7px 12px;
        font-size: 0.73rem; color: var(--udc-accent); font-weight: 600;
      }
      .api-err-banner {
        display: flex; align-items: center; gap: 7px;
        background: rgba(239,68,68,.07); border: 1px solid rgba(239,68,68,.2);
        border-radius: var(--udc-rsm); padding: 7px 12px;
        font-size: 0.73rem; color: var(--udc-red);
      }
      .detail-header {
        display: flex; align-items: center; justify-content: space-between;
        padding-bottom: 11px; border-bottom: 1px solid var(--udc-border); margin-bottom: 12px;
      }
      .detail-title { font-size: .92rem; font-weight: 700; letter-spacing: -.01em; }
      .status-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 9px; border-radius: 20px;
        font-size: .7rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      }
      .status-badge.up   { background: rgba(34,197,94,.1);  color: var(--udc-green); border: 1px solid rgba(34,197,94,.2); }
      .status-badge.down { background: rgba(78,93,115,.2);   color: var(--udc-muted); border: 1px solid var(--udc-border); }

      /* ── DETAIL CARDS (2×N grid) ── */
      .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
      .detail-card {
        background: var(--udc-surface); border: 1px solid var(--udc-border);
        border-radius: var(--udc-rsm); padding: 9px 12px; display: grid; gap: 2px;
      }
      .dc-label { font-size: .63rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--udc-muted); }
      .dc-value { font-size: .87rem; font-weight: 700; color: var(--udc-text); }
      .dc-value.accent  { color: var(--udc-accent); }
      .dc-value.poe-on  { color: var(--udc-orange); }
      .dc-value.na      { color: var(--udc-muted); font-weight: 400; }
      .dc-value.green   { color: var(--udc-green); }

      /* ── MAC TABLE ── */
      .mac-table { display: grid; gap: 5px; margin-bottom: 12px; }
      .mac-row {
        display: flex; align-items: center; gap: 8px;
        background: var(--udc-surface); border: 1px solid var(--udc-border);
        border-radius: 7px; padding: 7px 11px; font-size: .78rem;
      }
      .mac-icon { font-size: .85rem; opacity: .6; flex-shrink: 0; }
      .mac-hostname { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .mac-addr { font-size: .7rem; color: var(--udc-dim); font-family: monospace; flex-shrink: 0; }
      .mac-ip   { font-size: .7rem; color: var(--udc-accent); flex-shrink: 0; }

      /* ── THROUGHPUT CHIPS ── */
      .tput-row { display: flex; gap: 6px; margin-bottom: 10px; }
      .tput-chip {
        display: inline-flex; align-items: center; gap: 4px;
        background: var(--udc-surf2); border: 1px solid var(--udc-border);
        border-radius: 6px; padding: 3px 8px;
        font-size: .7rem; font-weight: 600; color: var(--udc-dim);
      }
      .tput-chip .arr { font-size: 8px; opacity: .6; }

      /* ── ACTIONS ── */
      .actions { display: flex; gap: 7px; flex-wrap: wrap; }
      .action-btn {
        border: 1px solid var(--udc-border); border-radius: 7px;
        padding: 7px 14px; cursor: pointer; font: inherit;
        font-size: .8rem; font-weight: 600; transition: all .13s ease;
        display: inline-flex; align-items: center; gap: 5px;
      }
      .action-btn.primary   { background: var(--udc-accent); color: white; border-color: var(--udc-accent); }
      .action-btn.primary:hover { background: #0077bb; box-shadow: 0 0 14px var(--udc-aglow); }
      .action-btn.secondary { background: var(--udc-surf2); color: var(--udc-dim); }
      .action-btn.secondary:hover { color: var(--udc-text); border-color: rgba(255,255,255,.14); }

      /* ── MISC ── */
      .muted { color: var(--udc-muted); font-size: .875rem; }
      .loading-state {
        display: flex; align-items: center; gap: 10px;
        padding: 20px; color: var(--udc-muted); font-size: .875rem;
      }
      .spinner {
        width: 16px; height: 16px; flex-shrink: 0;
        border: 2px solid var(--udc-surf2); border-top-color: var(--udc-accent);
        border-radius: 50%; animation: spin .65s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .empty-state { padding: 24px 18px; color: var(--udc-muted); font-size: .875rem; text-align: center; line-height: 1.5; }
    </style>`;
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _renderEmpty(title) {
    this.shadowRoot.innerHTML = `${this._styles()}
      <ha-card>
        <div class="header">
          <div class="header-info">
            <div class="title">${title}</div>
            <div class="subtitle">${this._subtitle()}</div>
          </div>
        </div>
        <div class="empty-state">Bitte im Karteneditor ein UniFi-Gerät auswählen.</div>
      </ha-card>`;
  }

  _renderPortButton(slot, selectedKey) {
    const linkUp   = this._portIsUp(slot);
    const hasPoe   = this._portHasPoe(slot);
    const poeOn    = hasPoe && this._portPoeEnabled(slot);
    const isSpecial = slot.kind === "special";
    const icon     = poeOn ? "⚡" : (linkUp ? "▲" : "○");

    // Show speed in tooltip from API if available
    let tooltip = `${slot.label}${linkUp ? " · Connected" : " · No link"}`;
    if (this._apiPortMap && slot.port) {
      const ap = this._apiPortMap.get(slot.port);
      if (ap && ap.up && ap.speed) tooltip += ` · ${formatSpeed(ap.speed)}`;
    }

    return `<button
      class="port ${isSpecial?"special":""} ${linkUp?"up":"down"} ${selectedKey===slot.key?"selected":""} ${hasPoe?"has-poe":""}"
      data-key="${slot.key}" title="${tooltip}">
      <div class="port-num">${slot.label}</div>
      <div class="port-icon">${icon}</div>
    </button>`;
  }

  _renderPanelAndDetail(title) {
    const ctx = this._ctx;
    const numbered = mergePortsWithLayout(ctx?.layout, discoverPorts(ctx?.entities || []));
    const specials  = mergeSpecialsWithLayout(ctx?.layout, discoverSpecialPorts(ctx?.entities || []));
    const allSlots  = [...specials, ...numbered];
    const selected  = allSlots.find((p) => p.key === this._selectedKey) || allSlots[0] || null;
    const connected = this._connectedCount(allSlots);

    const specialRow = specials.length
      ? `<div class="special-row">${specials.map((s) => this._renderPortButton(s, selected?.key)).join("")}</div>` : "";

    const layoutRows = (ctx?.layout?.rows || []).map((rowPorts) => {
      const items = rowPorts.map((portNumber) => {
        const slot = numbered.find((p) => p.port === portNumber) || {
          key: `port-${portNumber}`, port: portNumber, label: String(portNumber), kind: "numbered",
          link_entity: null, speed_entity: null, poe_switch_entity: null,
          poe_power_entity: null, power_cycle_entity: null, raw_entities: [],
        };
        return this._renderPortButton(slot, selected?.key);
      }).join("");
      return `<div class="port-row">${items}</div>`;
    });

    // ── Detail panel ──────────────────────────────────────────────────────
    let detail = "";
    if (selected) {
      const linkUp    = this._portIsUp(selected);
      const hasPoe    = this._portHasPoe(selected);
      const poeOn     = hasPoe && this._portPoeEnabled(selected);
      const apiPort   = this._apiPortMap?.get(selected.port) || null;

      // Speed
      const speedText = apiPort
        ? formatSpeed(apiPort.speed)
        : getPortSpeedText(this._hass, selected);

      // Link text
      const linkText = apiPort
        ? (apiPort.up ? "Connected" : "No link")
        : getPortLinkText(this._hass, selected);

      // PoE details (API gives voltage + current too)
      const poePowerText = apiPort?.poe_power
        ? `${parseFloat(apiPort.poe_power).toFixed(1)} W`
        : (selected.power_cycle_entity ? formatState(this._hass, selected.poe_power_entity, "—") : "—");

      const poeVoltText  = apiPort?.poe_voltage ? `${parseFloat(apiPort.poe_voltage).toFixed(0)} V` : null;
      const poeAmpText   = apiPort?.poe_current  ? `${(parseFloat(apiPort.poe_current)*1000).toFixed(0)} mA` : null;

      // Throughput
      const rxRate = apiPort ? formatBytes(apiPort.rx_rate) : null;
      const txRate = apiPort ? formatBytes(apiPort.tx_rate) : null;

      // MAC table
      const macTable = apiPort?.mac_table || [];

      // Can we do PoE actions?
      const canPoe        = hasPoe || (apiPort?.poe_mode !== null && apiPort?.poe_mode !== undefined);
      const canPowerCycle = Boolean(selected.power_cycle_entity) || (Boolean(this._apiDeviceMac) && selected.port);

      // ── Build detail grid ──────────────────────────────────────────────
      const gridCards = [
        { label: "Link Status",   value: linkText,                          cls: ""       },
        { label: "Geschwindigkeit", value: speedText,                       cls: "accent" },
        { label: "PoE",           value: canPoe ? (poeOn ? "Ein ⚡" : "Aus") : "—",
                                                                             cls: poeOn ? "poe-on" : (canPoe ? "" : "na") },
        { label: "PoE Leistung",  value: canPoe ? poePowerText : "—",      cls: canPoe ? "" : "na" },
        ...(poeVoltText ? [{ label: "PoE Spannung", value: poeVoltText, cls: "" }] : []),
        ...(poeAmpText  ? [{ label: "PoE Strom",    value: poeAmpText,  cls: "" }] : []),
      ];

      const gridHtml = gridCards.map((c) =>
        `<div class="detail-card">
          <div class="dc-label">${c.label}</div>
          <div class="dc-value ${c.cls}">${c.value}</div>
        </div>`
      ).join("");

      // Throughput row
      const tputHtml = (rxRate || txRate) ? `
        <div class="tput-row">
          ${rxRate ? `<div class="tput-chip"><span class="arr">↓</span>${rxRate}</div>` : ""}
          ${txRate ? `<div class="tput-chip"><span class="arr">↑</span>${txRate}</div>` : ""}
        </div>` : "";

      // MAC table
      const macHtml = macTable.length > 0 ? `
        <div class="mac-table">
          ${macTable.slice(0, 4).map((m) => `
            <div class="mac-row">
              <div class="mac-icon">💻</div>
              <div class="mac-hostname">${m.hostname || "Unbekannt"}</div>
              <div class="mac-ip">${m.ip || ""}</div>
              <div class="mac-addr">${m.mac || ""}</div>
            </div>`).join("")}
        </div>` : "";

      // Action buttons
      const actionsHtml = `
        <div class="actions">
          ${canPoe
            ? `<button class="action-btn primary" data-action="toggle-poe">
                ⚡ PoE ${poeOn ? "Aus" : "Ein"}
               </button>` : ""}
          ${canPowerCycle
            ? `<button class="action-btn secondary" data-action="power-cycle">
                ↺ Power Cycle
               </button>` : ""}
        </div>`;

      detail = `
        <div class="port-detail">
          <div class="detail-header">
            <div class="detail-title">${selected.kind==="special" ? selected.label : `Port ${selected.port}`}</div>
            <div class="status-badge ${linkUp?"up":"down"}">${linkUp?"● Online":"○ Offline"}</div>
          </div>
          <div class="detail-grid">${gridHtml}</div>
          ${tputHtml}
          ${macHtml}
          ${actionsHtml}
        </div>`;
    } else {
      detail = `<div class="muted">Keine Ports erkannt.</div>`;
    }

    // ── Mode banners ──────────────────────────────────────────────────────
    let apiBanner = "";
    if (this._config?.unifi_host && this._apiPortMap) {
      apiBanner = `<div class="api-banner">⚡ Echtzeit-Daten via UniFi API</div>`;
    } else if (this._config?.unifi_host && this._apiError) {
      apiBanner = `<div class="api-err-banner">⚠ API nicht erreichbar: ${this._apiError} — verwende HA-Daten</div>`;
    } else if (this._config?.unifi_host) {
      apiBanner = `<div class="api-banner">⏳ Verbinde mit UniFi API…</div>`;
    }

    // ── Chips ──────────────────────────────────────────────────────────────
    const isApiMode = Boolean(this._config?.unifi_host && this._apiPortMap);
    const chipClass = isApiMode ? "chip api-chip" : "chip";
    const chipLabel = isApiMode ? "API" : "HA";

    this.shadowRoot.innerHTML = `${this._styles()}
      <ha-card>
        <div class="header">
          <div class="header-info">
            <div class="title">${title}</div>
            <div class="subtitle">${this._subtitle()}</div>
          </div>
          <div class="header-chips">
            <div class="${chipClass}"><div class="dot"></div>${connected}/${allSlots.length}</div>
            <div class="chip" style="font-size:.65rem;padding:3px 8px;color:var(--udc-muted)">${chipLabel}</div>
          </div>
        </div>

        <div class="frontpanel ${ctx?.layout?.frontStyle || "single-row"}">
          <div class="panel-label">Front Panel</div>
          ${specialRow}
          ${layoutRows.join("") || `<div class="muted" style="padding:8px 0">Keine Ports erkannt.</div>`}
        </div>

        <div class="section">
          ${apiBanner}
          ${detail}
        </div>
      </ha-card>`;

    // ── Event wiring ──────────────────────────────────────────────────────
    this.shadowRoot.querySelectorAll(".port")
      .forEach((btn) => btn.addEventListener("click", () => this._selectKey(btn.dataset.key)));

    // Find selected slot for actions
    const ctx2     = this._ctx;
    const numbered2 = mergePortsWithLayout(ctx2?.layout, discoverPorts(ctx2?.entities || []));
    const specials2  = mergeSpecialsWithLayout(ctx2?.layout, discoverSpecialPorts(ctx2?.entities || []));
    const allSlots2  = [...specials2, ...numbered2];
    const sel2       = allSlots2.find((p) => p.key === this._selectedKey) || allSlots2[0] || null;

    this.shadowRoot.querySelector("[data-action='toggle-poe']")
      ?.addEventListener("click", () => sel2 && this._togglePoe(sel2));

    this.shadowRoot.querySelector("[data-action='power-cycle']")
      ?.addEventListener("click", () => sel2 && this._powerCycle(sel2));
  }

  // ── Top-level render ──────────────────────────────────────────────────────

  _render() {
    const title = this._config?.name || "UniFi Device Card";

    if (!this._config?.device_id) { this._renderEmpty(title); return; }

    if (this._loading) {
      this.shadowRoot.innerHTML = `${this._styles()}
        <ha-card>
          <div class="header">
            <div class="header-info">
              <div class="title">${title}</div>
              <div class="subtitle">${this._subtitle()}</div>
            </div>
          </div>
          <div class="loading-state"><div class="spinner"></div>Lade Gerätedaten…</div>
        </ha-card>`;
      return;
    }

    if (!this._ctx) {
      this.shadowRoot.innerHTML = `${this._styles()}
        <ha-card>
          <div class="header">
            <div class="header-info">
              <div class="title">${title}</div>
              <div class="subtitle">${this._subtitle()}</div>
            </div>
          </div>
          <div class="empty-state">Keine Gerätedaten verfügbar.</div>
        </ha-card>`;
      return;
    }

    this._renderPanelAndDetail(title);
  }
}

customElements.define("unifi-device-card", UnifiDeviceCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "unifi-device-card",
  name: "UniFi Device Card",
  description: "A Lovelace card for UniFi switches and gateways — with optional direct API support.",
});
