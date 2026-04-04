
import {
  classifyUnifiDevice,
  fireConfigChanged,
  listUnifiDevices,
} from "./helpers.js";

class UnifiDeviceCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { view: "compact", tap_action: "navigate", ...config };
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  get _devices() {
    return listUnifiDevices(this._hass);
  }

  _valueChanged(ev) {
    const target = ev.target;
    if (!target) return;

    const key = target.configValue;
    if (!key) return;

    let value = target.type === "checkbox" ? target.checked : target.value;

    if (value === "") {
      const next = { ...this._config };
      delete next[key];
      this._config = next;
    } else {
      this._config = { ...this._config, [key]: value };
    }

    fireConfigChanged(this, this._config);
    this.render();
  }

  render() {
    if (!this._hass || !this._config) return;

    const devices = this._devices;
    const selectedDevice = devices.find((d) => d.id === this._config.device_id);
    const type = selectedDevice ? classifyUnifiDevice(this._hass, selectedDevice.id) : "generic";

    this.innerHTML = `
      <style>
        .wrapper {
          display: grid;
          gap: 12px;
        }
        .hint {
          color: var(--secondary-text-color);
          font-size: 0.9rem;
        }
        .section {
          border: 1px solid var(--divider-color);
          border-radius: 12px;
          padding: 12px;
        }
        .grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        }
        label {
          display: grid;
          gap: 6px;
          font-weight: 500;
        }
        select, input {
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--divider-color);
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        .meta {
          display: grid;
          gap: 4px;
        }
      </style>

      <div class="wrapper">
        <div class="section">
          <div class="grid">
            <label>
              UniFi device
              <select configValue="device_id">
                <option value="">Select a device…</option>
                ${devices
                  .map((device) => {
                    const selected = device.id === this._config.device_id ? "selected" : "";
                    const text = `${device.name_by_user || device.name || "Unnamed"}${device.model ? ` (${device.model})` : ""}`;
                    return `<option value="${device.id}" ${selected}>${text}</option>`;
                  })
                  .join("")}
              </select>
            </label>

            <label>
              Display name
              <input
                configValue="name"
                type="text"
                value="${this._config.name || ""}"
                placeholder="Optional custom name"
              />
            </label>

            <label>
              View
              <select configValue="view">
                <option value="compact" ${this._config.view === "compact" ? "selected" : ""}>Compact</option>
                <option value="detailed" ${this._config.view === "detailed" ? "selected" : ""}>Detailed</option>
              </select>
            </label>

            <label>
              Tap action
              <select configValue="tap_action">
                <option value="navigate" ${this._config.tap_action === "navigate" ? "selected" : ""}>Navigate</option>
                <option value="more-info" ${this._config.tap_action === "more-info" ? "selected" : ""}>More info</option>
                <option value="none" ${this._config.tap_action === "none" ? "selected" : ""}>None</option>
              </select>
            </label>

            <label>
              Navigation path
              <input
                configValue="navigation_path"
                type="text"
                value="${this._config.navigation_path || ""}"
                placeholder="/dashboard/netzwerk/switch-a"
              />
            </label>
          </div>
        </div>

        <div class="section">
          <div class="meta">
            <strong>Detected type:</strong>
            <span>${selectedDevice ? type : "—"}</span>
            <strong>Selected model:</strong>
            <span>${selectedDevice?.model || "—"}</span>
            <span class="hint">Only devices that look like UniFi devices are listed here.</span>
          </div>
        </div>

        <div class="section">
          <div class="grid">
            <label>
              <input configValue="show_speed" type="checkbox" ${this._config.show_speed ? "checked" : ""} />
              Show speed in switch details
            </label>

            <label>
              <input configValue="show_port_details" type="checkbox" ${this._config.show_port_details ? "checked" : ""} />
              Show discovered port details
            </label>

            <label>
              <input configValue="show_gateway_ports" type="checkbox" ${this._config.show_gateway_ports ? "checked" : ""} />
              Show discovered gateway ports
            </label>
          </div>
        </div>
      </div>
    `;

    this.querySelectorAll("[configValue]").forEach((el) => {
      const event = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(event, this._valueChanged.bind(this));
      if (el.tagName === "SELECT") {
        el.addEventListener("change", this._valueChanged.bind(this));
      }
    });
  }
}

customElements.define("unifi-device-card-editor", UnifiDeviceCardEditor);
