import { getUnifiDevices } from "./helpers.js";

class UnifiDeviceCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._devices = [];
    this._loading = false;
    this._loaded = false;
    this._error = "";
    this._selected = null;
    this._loadToken = 0;
  }

  setConfig(config) {
    this._config = {
      name: "",
      ...config,
    };
    this._render();
    if (this._hass && !this._loaded && !this._loading) {
      this._loadDevices();
    } else if (this._devices.length > 0) {
      this._syncSelected();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._loaded && !this._loading) {
      this._loadDevices();
    } else {
      this._render();
    }
  }

  get _deviceId() {
    return this._config?.device_id || "";
  }

  async _loadDevices() {
    if (!this._hass) return;

    this._loading = true;
    this._error = "";
    const token = ++this._loadToken;
    this._render();

    try {
      const devices = await getUnifiDevices(this._hass, {
        includeAccessPoints: false,
        includeUnknown: false,
      });

      if (token !== this._loadToken) return;

      this._devices = devices;
      this._loaded = true;
      this._loading = false;
      this._syncSelected();
      this._render();
    } catch (err) {
      if (token !== this._loadToken) return;

      console.error("[unifi-device-card] Failed to load UniFi devices", err);
      this._devices = [];
      this._loaded = true;
      this._loading = false;
      this._error = "UniFi-Geräte konnten nicht geladen werden.";
      this._render();
    }
  }

  _syncSelected() {
    this._selected =
      this._devices.find((device) => device.id === this._deviceId) || null;
  }

  _dispatchConfig(config) {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _onDeviceChange(ev) {
    const deviceId = ev.target.value || "";
    const selected =
      this._devices.find((device) => device.id === deviceId) || null;

    const nextConfig = {
      ...this._config,
      device_id: deviceId || undefined,
    };

    if (!nextConfig.name && selected?.name) {
      nextConfig.name = selected.name;
    }

    if (!deviceId) {
      delete nextConfig.device_id;
    }

    this._config = nextConfig;
    this._selected = selected;
    this._dispatchConfig(nextConfig);
    this._render();
  }

  _onNameInput(ev) {
    const value = ev.target.value || "";
    const nextConfig = {
      ...this._config,
      name: value,
    };
    this._config = nextConfig;
    this._dispatchConfig(nextConfig);
  }

  _renderDeviceInfo() {
    if (!this._selected) {
      return `<div class="hint">Es werden nur unterstützte UniFi Switches und Gateways angezeigt.</div>`;
    }

    const typeLabel =
      this._selected.type === "switch"
        ? "Switch"
        : this._selected.type === "gateway"
        ? "Gateway"
        : this._selected.type;

    return `
      <div class="device-info">
        <div><strong>Typ:</strong> ${typeLabel}</div>
        <div><strong>Modell:</strong> ${this._selected.model || "Unbekannt"}</div>
        <div><strong>Gerätename:</strong> ${this._selected.name}</div>
      </div>
    `;
  }

  _render() {
    const deviceOptions = this._devices
      .map(
        (device) => `
          <option value="${device.id}" ${
            device.id === this._deviceId ? "selected" : ""
          }>
            ${device.label}
          </option>
        `
      )
      .join("");

    const selectedName = this._config?.name || "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        .wrapper {
          display: grid;
          gap: 16px;
        }

        .grid {
          display: grid;
          gap: 16px;
          grid-template-columns: 1fr 1fr;
        }

        .field {
          display: grid;
          gap: 6px;
        }

        .field label {
          font-size: 14px;
          font-weight: 600;
          color: var(--primary-text-color);
        }

        select,
        input {
          box-sizing: border-box;
          width: 100%;
          min-height: 40px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
          padding: 8px 10px;
          font: inherit;
        }

        .hint {
          color: var(--secondary-text-color);
          font-size: 13px;
          line-height: 1.4;
        }

        .error {
          color: var(--error-color);
          font-size: 13px;
          line-height: 1.4;
        }

        .device-info {
          border-radius: 10px;
          padding: 12px;
          background: var(--secondary-background-color, rgba(127,127,127,0.08));
          display: grid;
          gap: 6px;
          font-size: 14px;
        }

        .loading {
          color: var(--secondary-text-color);
          font-size: 14px;
        }

        @media (max-width: 700px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <div class="wrapper">
        <div class="grid">
          <div class="field">
            <label for="deviceSelect">UniFi device</label>
            ${
              this._loading
                ? `<div class="loading">Lade unterstützte UniFi-Geräte…</div>`
                : `
                  <select id="deviceSelect">
                    <option value="">Select a device...</option>
                    ${deviceOptions}
                  </select>
                `
            }
          </div>

          <div class="field">
            <label for="displayName">Display name</label>
            <input
              id="displayName"
              type="text"
              value="${String(selectedName).replace(/"/g, "&quot;")}"
              placeholder="Optional"
            />
          </div>
        </div>

        ${this._error ? `<div class="error">${this._error}</div>` : ""}
        ${!this._loading && !this._devices.length && !this._error ? `<div class="hint">Keine unterstützten UniFi Switches oder Gateways gefunden.</div>` : ""}
        ${this._renderDeviceInfo()}
      </div>
    `;

    const select = this.shadowRoot.getElementById("deviceSelect");
    const input = this.shadowRoot.getElementById("displayName");

    if (select) {
      select.addEventListener("change", this._onDeviceChange.bind(this));
    }

    if (input) {
      input.addEventListener("input", this._onNameInput.bind(this));
    }
  }
}

customElements.define("unifi-device-card-editor", UnifiDeviceCardEditor);
