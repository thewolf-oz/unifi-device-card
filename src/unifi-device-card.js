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
import "./unifi-device-card-editor.js";

const VERSION = __VERSION__;

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
    this._config         = {};
    this._ctx            = null;
    this._selectedKey    = null;
    this._loading        = false;
    this._loadToken      = 0;
    this._loadedDeviceId = null;
  }

  setConfig(config) {
    const oldDeviceId = this._config?.device_id || null;
    const newConfig   = config || {};
    const newDeviceId = newConfig?.device_id || null;
    this._config = newConfig;

    if (oldDeviceId !== newDeviceId) {
      this._ctx            = null;
      this._selectedKey    = null;
      this._loadedDeviceId = null;
      this._loading        = false;
      if (this._hass && newDeviceId) { this._ensureLoaded(); return; }
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureLoaded();
    this._render();
  }

  getCardSize() { return 8; }

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
    } catch (err) {
      console.error("[unifi-device-card] Failed to load device context", err);
      if (token !== this._loadToken) return;
      this._ctx            = null;
      this._loadedDeviceId = null;
    }

    this._loading = false;
    this._render();
  }

  _selectKey(key) { this._selectedKey = key; this._render(); }

  async _toggleEntity(entityId) {
    if (!entityId || !this._hass) return;
    const [domain] = entityId.split(".");
    await this._hass.callService(domain, "toggle", { entity_id: entityId });
  }

  async _pressButton(entityId) {
    if (!entityId || !this._hass) return;
    await this._hass.callService("button", "press", { entity_id: entityId });
  }

  _subtitle() {
    if (!this._config?.device_id || !this._ctx) return `Version ${VERSION}`;
    const fw    = this._ctx?.firmware;
    const model = this._ctx?.layout?.displayModel || this._ctx?.model || "";
    return fw ? `${model} · FW ${fw}` : model;
  }

  _connectedCount(allSlots) {
    return allSlots.filter((s) => isOn(this._hass, s.link_entity)).length;
  }

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

      /* HEADER */
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
      .chip {
        display: flex; align-items: center; gap: 5px;
        background: var(--udc-surf2); border: 1px solid var(--udc-border);
        border-radius: 20px; padding: 3px 10px;
        font-size: 0.71rem; font-weight: 700; white-space: nowrap;
        color: var(--udc-dim); flex-shrink: 0;
      }
      .chip .dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--udc-green); box-shadow: 0 0 5px var(--udc-green);
        animation: blink 2.5s ease-in-out infinite;
      }
      @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.4} }

      /* FRONT PANEL */
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

      /* PORT BUTTON */
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
        box-shadow: 0 0 0 1px var(--udc-accent);
      }
      .port.selected::after { background: var(--udc-accent) !important; }
      .port.has-poe.up::after { background: linear-gradient(90deg, var(--udc-green) 50%, var(--udc-orange)); }
      .port.special { min-height: 46px; border-radius: 9px; min-width: 58px; padding: 5px 9px; }
      .port-num { font-size: 10px; font-weight: 800; line-height: 1; color: var(--udc-dim); }
      .port.up .port-num { color: var(--udc-text); }
      .port-icon { font-size: 8px; line-height: 1; color: var(--udc-muted); }
      .port.up .port-icon         { color: var(--udc-green); }
      .port.has-poe.up .port-icon { color: var(--udc-orange); }

      /* DETAIL */
      .section { padding: 14px 18px 18px; display: grid; gap: 14px; }
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

      .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
      .detail-card {
        background: var(--udc-surface); border: 1px solid var(--udc-border);
        border-radius: var(--udc-rsm); padding: 9px 12px; display: grid; gap: 2px;
      }
      .dc-label { font-size: .63rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--udc-muted); }
      .dc-value { font-size: .87rem; font-weight: 700; color: var(--udc-text); }
      .dc-value.accent { color: var(--udc-accent); }
      .dc-value.poe-on { color: var(--udc-orange); }
      .dc-value.na     { color: var(--udc-muted); font-weight: 400; }

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
      .empty-state {
        padding: 24px 18px; color: var(--udc-muted);
        font-size: .875rem; text-align: center; line-height: 1.5;
      }
    </style>`;
  }

  _renderPortButton(slot, selectedKey) {
    const linkUp    = isOn(this._hass, slot.link_entity);
    const hasPoe    = Boolean(slot.power_cycle_entity);
    const poeOn     = hasPoe && slot.poe_switch_entity ? isOn(this._hass, slot.poe_switch_entity) : false;
    const isSpecial = slot.kind === "special";
    const icon      = poeOn ? "⚡" : (linkUp ? "▲" : "○");

    return `<button
      class="port ${isSpecial ? "special" : ""} ${linkUp ? "up" : "down"} ${selectedKey === slot.key ? "selected" : ""} ${hasPoe ? "has-poe" : ""}"
      data-key="${slot.key}"
      title="${slot.label}${linkUp ? " · Connected" : " · No link"}${poeOn ? " · PoE ON" : ""}">
      <div class="port-num">${slot.label}</div>
      <div class="port-icon">${icon}</div>
    </button>`;
  }

  _renderPanelAndDetail(title) {
    const ctx      = this._ctx;
    const numbered = mergePortsWithLayout(ctx?.layout, discoverPorts(ctx?.entities || []));
    const specials  = mergeSpecialsWithLayout(ctx?.layout, discoverSpecialPorts(ctx?.entities || []));
    const allSlots  = [...specials, ...numbered];
    const selected  = allSlots.find((p) => p.key === this._selectedKey) || allSlots[0] || null;
    const connected = this._connectedCount(allSlots);

    const specialRow = specials.length
      ? `<div class="special-row">${specials.map((s) => this._renderPortButton(s, selected?.key)).join("")}</div>`
      : "";

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

    // Detail panel
    let detail = `<div class="muted">Keine Ports erkannt.</div>`;
    if (selected) {
      const linkUp   = isOn(this._hass, selected.link_entity);
      const linkText = getPortLinkText(this._hass, selected);
      const speedText = getPortSpeedText(this._hass, selected);
      const poeAvail = Boolean(selected.power_cycle_entity && selected.poe_switch_entity);
      const poeOn    = poeAvail ? isOn(this._hass, selected.poe_switch_entity) : false;
      const poePower = poeAvail ? formatState(this._hass, selected.poe_power_entity, "—") : "—";

      detail = `
        <div class="detail-header">
          <div class="detail-title">${selected.kind === "special" ? selected.label : `Port ${selected.port}`}</div>
          <div class="status-badge ${linkUp ? "up" : "down"}">${linkUp ? "● Online" : "○ Offline"}</div>
        </div>

        <div class="detail-grid">
          <div class="detail-card">
            <div class="dc-label">Link Status</div>
            <div class="dc-value">${linkText !== "—" ? linkText : (linkUp ? "Connected" : "No link")}</div>
          </div>
          <div class="detail-card">
            <div class="dc-label">Geschwindigkeit</div>
            <div class="dc-value accent">${speedText}</div>
          </div>
          <div class="detail-card">
            <div class="dc-label">PoE</div>
            <div class="dc-value ${poeAvail ? (poeOn ? "poe-on" : "") : "na"}">
              ${poeAvail ? stateValue(this._hass, selected.poe_switch_entity, "—") : "—"}
            </div>
          </div>
          <div class="detail-card">
            <div class="dc-label">PoE Leistung</div>
            <div class="dc-value ${poeAvail ? "" : "na"}">${poePower}</div>
          </div>
        </div>

        <div class="actions">
          ${poeAvail
            ? `<button class="action-btn primary" data-action="toggle-poe" data-entity="${selected.poe_switch_entity}">
                ⚡ PoE ${poeOn ? "Aus" : "Ein"}
               </button>`
            : ""}
          ${selected.power_cycle_entity
            ? `<button class="action-btn secondary" data-action="power-cycle" data-entity="${selected.power_cycle_entity}">
                ↺ Power Cycle
               </button>`
            : ""}
        </div>`;
    }

    this.shadowRoot.innerHTML = `${this._styles()}
      <ha-card>
        <div class="header">
          <div class="header-info">
            <div class="title">${title}</div>
            <div class="subtitle">${this._subtitle()}</div>
          </div>
          <div class="chip"><div class="dot"></div>${connected}/${allSlots.length}</div>
        </div>

        <div class="frontpanel ${ctx?.layout?.frontStyle || "single-row"}">
          <div class="panel-label">Front Panel</div>
          ${specialRow}
          ${layoutRows.join("") || `<div class="muted" style="padding:8px 0">Keine Ports erkannt.</div>`}
        </div>

        <div class="section">${detail}</div>
      </ha-card>`;

    this.shadowRoot.querySelectorAll(".port")
      .forEach((btn) => btn.addEventListener("click", () => this._selectKey(btn.dataset.key)));

    this.shadowRoot.querySelector("[data-action='toggle-poe']")
      ?.addEventListener("click", (e) => this._toggleEntity(e.currentTarget.dataset.entity));

    this.shadowRoot.querySelector("[data-action='power-cycle']")
      ?.addEventListener("click", (e) => this._pressButton(e.currentTarget.dataset.entity));
  }

  _render() {
    const title = this._config?.name || "UniFi Device Card";

    if (!this._config?.device_id) {
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
      return;
    }

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
  type:        "unifi-device-card",
  name:        "UniFi Device Card",
  description: "Lovelace card for UniFi switches and gateways.",
});
