import "./unifi-device-card-editor.js";

const VERSION = __VERSION__;

class UnifiDeviceCard extends HTMLElement {
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
            Bitte im Karteneditor ein UniFi-Gerät auswählen.
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
}

customElements.define("unifi-device-card", UnifiDeviceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "unifi-device-card",
  name: "UniFi Device Card",
  description: "A Lovelace card for supported UniFi switches and gateways.",
});
