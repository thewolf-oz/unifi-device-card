/* UniFi Device Card 0.0.0-dev.1f6c684 */

// src/helpers.js
async function getUnifiDevices(hass) {
  const [devices, entities] = await Promise.all([
    hass.callWS({ type: "config/device_registry/list" }),
    hass.callWS({ type: "config/entity_registry/list" })
  ]);
  return devices.map((device) => {
    const devEntities = entities.filter(
      (e) => e.device_id === device.id
    );
    const text = ((device.name || "") + (device.model || "") + (device.manufacturer || "") + devEntities.map((e) => e.entity_id).join(" ")).toLowerCase();
    const isUnifi = text.includes("unifi") || text.includes("usw") || text.includes("udm") || text.includes("ucg");
    const isAP = text.includes("access point") || text.includes("uap");
    const isSwitch = text.includes("port_") || text.includes("switch");
    const isGateway = text.includes("udm") || text.includes("gateway");
    return {
      id: device.id,
      name: device.name_by_user || device.name || device.model || "Unknown",
      type: isGateway ? "gateway" : isSwitch ? "switch" : "other",
      valid: isUnifi && !isAP
    };
  }).filter((d) => d.valid).sort((a, b) => a.name.localeCompare(b.name));
}

// src/unifi-device-card-editor.js
var UnifiDeviceCardEditor = class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._devices = [];
    this._loading = false;
  }
  setConfig(config) {
    this._config = config || {};
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this._devices.length && !this._loading) {
      this._loadDevices();
    }
  }
  async _loadDevices() {
    this._loading = true;
    this._render();
    this._devices = await getUnifiDevices(this._hass);
    this._loading = false;
    this._render();
  }
  _onChange(ev) {
    const device_id = ev.target.value;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: {
          config: {
            ...this._config,
            device_id
          }
        },
        bubbles: true,
        composed: true
      })
    );
  }
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        select {
          width: 100%;
          padding: 8px;
          border-radius: 8px;
        }
      </style>

      ${this._loading ? `<div>Loading UniFi devices...</div>` : `
            <select>
              <option value="">Select device</option>
              ${this._devices.map(
      (d) => `
                  <option value="${d.id}" ${d.id === this._config.device_id ? "selected" : ""}>
                    ${d.name} (${d.type})
                  </option>
                `
    ).join("")}
            </select>
          `}
    `;
    const select = this.shadowRoot.querySelector("select");
    if (select) {
      select.addEventListener("change", this._onChange.bind(this));
    }
  }
};
customElements.define("unifi-device-card-editor", UnifiDeviceCardEditor);

// src/unifi-device-card.js
var VERSION = "0.0.0-dev.1f6c684";
var UnifiDeviceCard = class extends HTMLElement {
  static getConfigElement() {
    return document.createElement("unifi-device-card-editor");
  }
  static getStubConfig() {
    return {};
  }
  setConfig(config) {
    this._config = config || {};
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    this._render();
  }
  getCardSize() {
    return 3;
  }
  _render() {
    if (!this.shadowRoot) return;
    const deviceId = this._config?.device_id || "";
    const title = this._config?.name || `UniFi Device Card v${VERSION}`;
    if (!deviceId) {
      this.shadowRoot.innerHTML = `
        <ha-card header="${title}">
          <div class="content">
            Bitte im Karteneditor ein UniFi-Ger\xE4t ausw\xE4hlen.
          </div>
        </ha-card>

        <style>
          .content {
            padding: 16px;
            color: var(--secondary-text-color);
          }
        </style>
      `;
      return;
    }
    this.shadowRoot.innerHTML = `
      <ha-card header="${title}">
        <div class="content">
          <div><strong>Version:</strong> ${VERSION}</div>
          <div><strong>Device ID:</strong> ${deviceId}</div>
        </div>
      </ha-card>

      <style>
        .content {
          padding: 16px;
          display: grid;
          gap: 8px;
        }
      </style>
    `;
  }
};
customElements.define("unifi-device-card", UnifiDeviceCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "unifi-device-card",
  name: "UniFi Device Card",
  description: "A Lovelace card for supported UniFi switches and gateways."
});
