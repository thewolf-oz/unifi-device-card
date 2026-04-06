import {
  getRelevantEntityWarningsForDevice,
  getUnifiDevices,
} from "./helpers.js";
import { t } from "./translations.js";

// ─── Port type detection helpers ─────────────────────────────────────────────

/**
 * Determine the port type badge for the WAN port selector dropdown.
 * Returns one of: "wan" | "sfp_wan" | "sfp" | "lan"
 *
 * Priority:
 *  1. Slot key starts with "wan"     → default WAN port
 *  2. Slot key contains "sfp_wan"    → SFP used as WAN
 *  3. Slot key contains "sfp"        → SFP (could be used as WAN)
 *  4. Otherwise                      → LAN port
 */
function slotPortType(slot) {
  const key = String(slot.key || "").toLowerCase();
  if (key === "wan" || key === "wan2") return "wan";
  if (key.includes("sfp_wan") || key.includes("wan_sfp")) return "sfp_wan";
  if (key.includes("sfp")) return "sfp";
  return "lan";
}

/**
 * Build the human-readable label for a slot in the WAN port dropdown.
 * Format: "WAN (Port 5)" / "SFP+ 1 — SFP (Port 10)" / "Port 3 — LAN"
 */
function slotDropdownLabel(slot, tFn) {
  const type = slotPortType(slot);
  const portNum = slot.port != null ? ` (Port ${slot.port})` : "";

  switch (type) {
    case "wan":
      return `${slot.label}${portNum}`;
    case "sfp_wan":
      return `${slot.label}${portNum} — ${tFn("editor_wan_port_sfpwan")}`;
    case "sfp":
      return `${slot.label}${portNum} — ${tFn("editor_wan_port_sfp")}`;
    default:
      return `${slot.label}${portNum} — ${tFn("editor_wan_port_lan")}`;
  }
}

/**
 * Build the list of all selectable port options for the WAN dropdown.
 * Includes all specialSlots (WAN, SFP) AND all numbered LAN ports.
 * The value stored in config is the slot key (for specials) or "port_N" (for numbered).
 */
function buildWanPortOptions(layout, tFn) {
  const options = [];

  // Default / auto option
  options.push({ value: "auto", label: tFn("editor_wan_port_auto") });

  if (!layout) return options;

  // Special slots first (WAN, SFP, etc.)
  for (const slot of layout.specialSlots || []) {
    const type = slotPortType(slot);
    options.push({
      value: slot.key,
      label: slotDropdownLabel(slot, tFn),
      type,
    });
  }

  // Numbered LAN ports (rows are arrays of port numbers)
  const specialPortNums = new Set(
    (layout.specialSlots || []).map((s) => s.port).filter((p) => p != null)
  );
  const allPortNums = (layout.rows || []).flat();
  for (const portNum of allPortNums) {
    if (specialPortNums.has(portNum)) continue;
    options.push({
      value: `port_${portNum}`,
      label: `Port ${portNum} — ${tFn("editor_wan_port_lan")}`,
      type: "lan",
    });
  }

  return options;
}

class UnifiDeviceCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._devices = [];
    this._loading = false;
    this._loaded = false;
    this._error = "";
    this._hass = null;
    this._loadToken = 0;
    this._entityHint = null;
    this._entityHintLoading = false;
    this._entityHintToken = 0;
    this._rendered = false;
    // Context of the currently selected device (type + layout)
    this._deviceCtx = null;
    this._deviceCtxLoading = false;
    this._deviceCtxToken = 0;
  }

  setConfig(config) {
    this._config = config || {};
    if (this._hass && this._config?.device_id) {
      this._loadEntityHint(this._config.device_id);
      this._loadDeviceCtx(this._config.device_id);
    } else {
      this._entityHint = null;
      this._deviceCtx = null;
    }
    // DOM already exists → patch only field values, never rebuild
    if (this._rendered) {
      this._patchFields();
    } else {
      this._render();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && !this._loading) this._loadDevices();
    if (this._config?.device_id) {
      this._loadEntityHint(this._config.device_id);
      this._loadDeviceCtx(this._config.device_id);
    }
  }

  _t(key) { return t(this._hass, key); }

  // ─── Smart render helper ───────────────────────────────────────────────────
  _smartRender() {
    const root = this.shadowRoot;
    const hasDeviceSelect = !!root?.getElementById("device");
    const shouldHaveDeviceSelect = !this._loading;

    if (!this._rendered || hasDeviceSelect !== shouldHaveDeviceSelect) {
      this._render();
      return;
    }

    this._patchFields();
    this._patchWarning();
  }

  // ─── Async loaders ────────────────────────────────────────────────────────
  async _loadDevices() {
    if (!this._hass) return;
    this._loading = true;
    this._error = "";
    const token = ++this._loadToken;
    this._smartRender();

    try {
      const devices = await getUnifiDevices(this._hass);
      if (token !== this._loadToken) return;
      this._devices = devices;
      this._loaded = true;
      this._loading = false;
      this._smartRender();
    } catch (err) {
      if (token !== this._loadToken) return;
      this._devices = [];
      this._loaded = true;
      this._loading = false;
      this._error = this._t("editor_error");
      this._smartRender();
    }
  }

  async _loadEntityHint(deviceId) {
    if (!this._hass || !deviceId) {
      this._entityHint = null;
      this._entityHintLoading = false;
      this._smartRender();
      return;
    }

    const token = ++this._entityHintToken;
    this._entityHintLoading = true;
    this._smartRender();

    try {
      const info = await getRelevantEntityWarningsForDevice(this._hass, deviceId);
      if (token !== this._entityHintToken) return;
      this._entityHint = info;
    } catch (err) {
      console.warn("[unifi-device-card] Failed to load entity warnings", err);
      if (token !== this._entityHintToken) return;
      this._entityHint = null;
    }

    this._entityHintLoading = false;
    this._smartRender();
  }

  /**
   * Load the device type and layout for the selected device so we know
   * whether to show the WAN port selector (gateway only) and which ports
   * to offer.
   */
  async _loadDeviceCtx(deviceId) {
    if (!this._hass || !deviceId) {
      this._deviceCtx = null;
      this._deviceCtxLoading = false;
      return;
    }

    const token = ++this._deviceCtxToken;
    this._deviceCtxLoading = true;

    try {
      // We only need device type + layout — reuse the same WS call via helpers
      const { getDeviceContext } = await import("./helpers.js");
      const ctx = await getDeviceContext(this._hass, deviceId);
      if (token !== this._deviceCtxToken) return;
      this._deviceCtx = ctx;
    } catch (err) {
      console.warn("[unifi-device-card] Failed to load device ctx for editor", err);
      if (token !== this._deviceCtxToken) return;
      this._deviceCtx = null;
    }

    this._deviceCtxLoading = false;
    // WAN selector is structural — needs a full re-render when ctx changes
    this._render();
  }

  // ─── Event dispatching ────────────────────────────────────────────────────
  _dispatch(config) {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    }));
  }

  _selectedDeviceName(deviceId) {
    return this._devices.find((d) => d.id === deviceId)?.name || "";
  }

  // ─── Input handlers ───────────────────────────────────────────────────────
  _onDeviceChange(ev) {
    const newDeviceId = ev.target.value || "";
    const oldDeviceId = this._config?.device_id || "";
    const oldAutoName = this._selectedDeviceName(oldDeviceId);
    const newAutoName = this._selectedDeviceName(newDeviceId);
    const next = { ...this._config };

    if (newDeviceId) next.device_id = newDeviceId;
    else delete next.device_id;

    const currentName = String(next.name || "").trim();
    if (!currentName || currentName === oldAutoName) {
      if (newAutoName) next.name = newAutoName;
      else delete next.name;
    }

    // Reset WAN port when device changes — the previous selection may not
    // exist on the newly chosen device.
    delete next.wan_port;

    this._config = next;
    this._dispatch(next);
    this._loadEntityHint(newDeviceId);
    this._deviceCtx = null;
    this._loadDeviceCtx(newDeviceId);
    // Device change needs a full re-render (select options must reflect new state)
    this._render();
  }

  _onNameInput(ev) {
    // No _render() – just dispatch; the input retains focus naturally
    this._config = { ...this._config, name: ev.target.value || "" };
    this._dispatch(this._config);
  }

  _onBackgroundInput(ev) {
    const value = String(ev.target.value || "").trim();
    const next = { ...this._config };
    if (value) next.background_color = value;
    else delete next.background_color;
    this._config = next;
    this._dispatch(next);
    // No _render() – focus preserved
  }

  _onWanPortChange(ev) {
    const value = ev.target.value || "auto";
    const next = { ...this._config };
    if (value && value !== "auto") {
      next.wan_port = value;
    } else {
      delete next.wan_port;
    }
    this._config = next;
    this._dispatch(next);
    // No _render() – focus preserved via patchFields
  }

  // ─── DOM patch helpers ────────────────────────────────────────────────────

  /**
   * Update only the *values* of existing input fields without touching the DOM
   * structure. Skips any field that currently has focus so the user's cursor
   * position is never disturbed.
   */
  _patchFields() {
    const root = this.shadowRoot;
    if (!root) return;

    const active = this.shadowRoot.activeElement || document.activeElement;

    const nameEl = root.getElementById("name");
    if (nameEl && nameEl !== active) {
      nameEl.value = this._config?.name || "";
    }

    const bgEl = root.getElementById("background_color");
    if (bgEl && bgEl !== active) {
      bgEl.value = this._config?.background_color || "";
    }

    // Re-sync the device select (value may change from outside)
    const selEl = root.getElementById("device");
    if (selEl && selEl !== active) {
      selEl.value = this._config?.device_id || "";
    }

    // Re-sync WAN port select if present
    const wanEl = root.getElementById("wan_port");
    if (wanEl && wanEl !== active) {
      wanEl.value = this._config?.wan_port || "auto";
    }
  }

  /**
   * Replace only the warning/hint block without touching any input elements.
   * This prevents the full-DOM rebuild that would steal focus.
   */
  _patchWarning() {
    const root = this.shadowRoot;
    if (!root) return;

    const container = root.getElementById("warning-container");
    if (!container) return;

    container.innerHTML = this._renderEntityWarning() +
      (this._error ? `<div class="error">${this._error}</div>` : "") +
      (!this._loading && !this._devices.length && !this._error
        ? `<div class="hint">${this._t("editor_no_devices")}</div>`
        : !this._loading
          ? `<div class="hint">${this._t("editor_hint")}</div>`
          : "");
  }

  // ─── Warning block renderer ───────────────────────────────────────────────
  _renderEntityWarning() {
    if (this._entityHintLoading) {
      return `<div class="hint">${this._t("warning_checking")}</div>`;
    }

    const info = this._entityHint;
    if (!info || !info.total) return "";

    const lines = [];
    if (info.counts.port_switch) lines.push(`<li>${info.counts.port_switch} ${this._t("warning_entity_port_switch")}</li>`);
    if (info.counts.poe_switch)  lines.push(`<li>${info.counts.poe_switch} ${this._t("warning_entity_poe_switch")}</li>`);
    if (info.counts.poe_power)   lines.push(`<li>${info.counts.poe_power} ${this._t("warning_entity_poe_power")}</li>`);
    if (info.counts.link_speed)  lines.push(`<li>${info.counts.link_speed} ${this._t("warning_entity_link_speed")}</li>`);
    if (info.counts.rx_tx)       lines.push(`<li>${info.counts.rx_tx} ${this._t("warning_entity_rx_tx")}</li>`);
    if (info.counts.power_cycle) lines.push(`<li>${info.counts.power_cycle} ${this._t("warning_entity_power_cycle")}</li>`);
    if (info.counts.link_entity) lines.push(`<li>${info.counts.link_entity} ${this._t("warning_entity_link")}</li>`);

    const statusText = this._t("warning_status")
      .replace("{disabled}", `<strong>${info.disabled}</strong>`)
      .replace("{hidden}",   `<strong>${info.hidden}</strong>`);

    return `
      <div class="warning">
        <div class="warning-title">${this._t("warning_title")}</div>
        <div class="warning-text">${this._t("warning_body")}</div>
        <div class="warning-text">${statusText}</div>
        ${lines.length ? `<ul class="warning-list">${lines.join("")}</ul>` : ""}
        <div class="warning-text">
          ${this._t("warning_check_in")}<br>
          <strong>${this._t("warning_ha_path")}</strong>
        </div>
      </div>
    `;
  }

  // ─── WAN port selector renderer ───────────────────────────────────────────

  /**
   * Render the WAN port dropdown.
   * Only shown when:
   *   1. A device is selected
   *   2. The device type is "gateway"
   *   3. The layout has at least one slot (so there is something to choose from)
   */
  _renderWanPortSelector() {
    if (!this._config?.device_id) return "";

    // While ctx is loading show a subtle loading hint
    if (this._deviceCtxLoading) {
      return `
        <div class="field">
          <label>${this._t("editor_wan_port_label")}</label>
          <div class="hint">${this._t("editor_device_loading")}</div>
        </div>
      `;
    }

    const ctx = this._deviceCtx;
    // Only show for gateways
    if (!ctx || ctx.type !== "gateway") return "";

    const layout = ctx.layout;
    const options = buildWanPortOptions(layout, (k) => this._t(k));

    // If there's only the "auto" option (no ports discovered) skip rendering
    if (options.length <= 1) return "";

    const currentVal = this._config?.wan_port || "auto";

    const optionHtml = options.map((o) => {
      const sel = o.value === currentVal ? " selected" : "";
      return `<option value="${o.value}"${sel}>${o.label}</option>`;
    }).join("");

    return `
      <div class="field">
        <label for="wan_port">${this._t("editor_wan_port_label")}</label>
        <select id="wan_port">
          ${optionHtml}
        </select>
        <div class="hint">${this._t("editor_wan_port_hint")}</div>
      </div>
    `;
  }

  // ─── Full render (first time only / device change) ────────────────────────
  _render() {
    const cfg = this._config;
    const selId  = cfg?.device_id || "";
    const selName = String(cfg?.name || "").replace(/"/g, "&quot;");
    const selBg   = String(cfg?.background_color || "").replace(/"/g, "&quot;");

    const options = this._devices
      .map((d) => `<option value="${d.id}" ${d.id === selId ? "selected" : ""}>${d.label}</option>`)
      .join("");

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .wrap { display: grid; gap: 14px; }
        .section-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          padding-bottom: 4px;
          border-bottom: 1px solid var(--divider-color);
        }
        .field { display: grid; gap: 5px; }
        label {
          font-size: 13px;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        select, input {
          width: 100%;
          box-sizing: border-box;
          min-height: 38px;
          padding: 7px 10px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          font: inherit;
        }
        .hint {
          color: var(--secondary-text-color);
          font-size: 12px;
          line-height: 1.4;
        }
        .error {
          color: var(--error-color);
          font-size: 12px;
          line-height: 1.4;
        }
        .warning {
          border: 1px solid var(--warning-color, #f59e0b);
          background: rgba(245, 158, 11, 0.08);
          color: var(--primary-text-color);
          border-radius: 8px;
          padding: 10px 12px;
          display: grid;
          gap: 6px;
        }
        .warning-title { font-size: 13px; font-weight: 700; }
        .warning-text  { font-size: 12px; line-height: 1.4; }
        .warning-list  { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.4; }
      </style>

      <div class="wrap">
        <div class="section-title">${this._t("editor_device_title")}</div>

        <div class="field">
          <label for="device">${this._t("editor_device_label")}</label>
          ${this._loading
            ? `<div class="hint">${this._t("editor_device_loading")}</div>`
            : `<select id="device">
                 <option value="">${this._t("editor_device_select")}</option>
                 ${options}
               </select>`}
        </div>

        ${this._renderWanPortSelector()}

        <div class="field">
          <label for="name">${this._t("editor_name_label")}</label>
          <input
            id="name"
            type="text"
            value="${selName}"
            placeholder="${this._t("editor_name_hint")}"
          />
        </div>

        <div class="field">
          <label for="background_color">${this._t("editor_bg_label")}</label>
          <input
            id="background_color"
            type="text"
            value="${selBg}"
            placeholder="${this._t("editor_bg_hint")}"
          />
        </div>

        <div id="warning-container">
          ${this._renderEntityWarning()}
          ${this._error ? `<div class="error">${this._error}</div>` : ""}
          ${!this._loading && !this._devices.length && !this._error
            ? `<div class="hint">${this._t("editor_no_devices")}</div>`
            : !this._loading
              ? `<div class="hint">${this._t("editor_hint")}</div>`
              : ""}
        </div>
      </div>
    `;

    this._rendered = true;

    this.shadowRoot.getElementById("device")
      ?.addEventListener("change", (e) => this._onDeviceChange(e));
    this.shadowRoot.getElementById("wan_port")
      ?.addEventListener("change", (e) => this._onWanPortChange(e));
    this.shadowRoot.getElementById("name")
      ?.addEventListener("input", (e) => this._onNameInput(e));
    this.shadowRoot.getElementById("background_color")
      ?.addEventListener("input", (e) => this._onBackgroundInput(e));
  }
}

customElements.define("unifi-device-card-editor", UnifiDeviceCardEditor);
