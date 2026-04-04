
import {
  callService,
  classifyUnifiDevice,
  getDeviceById,
  getStateObj,
  hasEntity,
  inferGatewayMetrics,
  inferSwitchPorts,
  maybeOpenMoreInfo,
  stateDisplay,
} from "./helpers.js";
import "./unifi-device-card-editor.js";

function cardStyle() {
  return `
    <style>
      :host {
        display: block;
      }
      ha-card {
        padding: 16px;
      }
      .header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .title {
        font-size: 1.1rem;
        font-weight: 700;
      }
      .subtitle {
        color: var(--secondary-text-color);
        font-size: 0.9rem;
      }
      .port-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(auto-fit, minmax(56px, 1fr));
      }
      .port {
        min-height: 56px;
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        padding: 8px 6px;
        display: grid;
        place-items: center;
        gap: 4px;
        cursor: pointer;
        user-select: none;
        transition: transform 120ms ease, opacity 120ms ease;
      }
      .port:active {
        transform: scale(0.98);
      }
      .port-name {
        font-size: 0.75rem;
        font-weight: 700;
      }
      .port-icon {
        font-size: 1.1rem;
        line-height: 1;
      }
      .up {
        background: rgba(46, 125, 50, 0.18);
        border-color: rgba(46, 125, 50, 0.45);
      }
      .down {
        background: rgba(128, 128, 128, 0.15);
      }
      .poe {
        box-shadow: inset 0 0 0 1px rgba(255, 193, 7, 0.35);
      }
      .section {
        margin-top: 14px;
      }
      .section-title {
        font-weight: 700;
        margin-bottom: 8px;
      }
      .details-list {
        display: grid;
        gap: 8px;
      }
      .detail-row,
      .metric-grid > div {
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        padding: 10px 12px;
      }
      .detail-row {
        display: grid;
        gap: 8px;
      }
      .detail-head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
      }
      .detail-meta {
        color: var(--secondary-text-color);
        font-size: 0.9rem;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      button.action {
        appearance: none;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border-radius: 10px;
        padding: 8px 10px;
        cursor: pointer;
      }
      .metric-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      }
      .metric-label {
        color: var(--secondary-text-color);
        font-size: 0.82rem;
      }
      .metric-value {
        font-size: 1rem;
        font-weight: 700;
      }
    </style>
  `;
}

function mdiIcon(name) {
  return `<ha-icon icon="${name}"></ha-icon>`;
}

export class UnifiDeviceCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("unifi-device-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:unifi-device-card",
      view: "compact",
      tap_action: "navigate",
    };
  }

  setConfig(config) {
    if (!config?.device_id) {
      throw new Error("device_id is required");
    }
    this._config = {
      view: "compact",
      tap_action: "navigate",
      show_speed: true,
      show_port_details: true,
      show_gateway_ports: false,
      ...config,
    };
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  _device() {
    return getDeviceById(this._hass, this._config.device_id);
  }

  _title() {
    const device = this._device();
    return (
      this._config.name ||
      device?.name_by_user ||
      device?.name ||
      device?.model ||
      "UniFi device"
    );
  }

  _navigate() {
    const path = this._config.navigation_path;
    if (!path) return;
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed"));
  }

  _handlePortTap(port) {
    const action = this._config.tap_action || "navigate";

    if (action === "navigate" && this._config.navigation_path) {
      this._navigate();
      return;
    }
    if (action === "more-info") {
      maybeOpenMoreInfo(this, port.link || port.poeSwitch || port.speed || port.poePower);
    }
  }

  _renderSwitch(device) {
    const ports = inferSwitchPorts(this._hass, device.id);
    const model = device.model || "Switch";

    return `
      ${cardStyle()}
      <ha-card>
        <div class="header">
          <div>
            <div class="title">${this._title()}</div>
            <div class="subtitle">${model} · ${ports.length || "?"} discovered ports</div>
          </div>
        </div>

        <div class="port-grid">
          ${ports
            .map((port) => {
              const up = getStateObj(this._hass, port.link)?.state === "on";
              const poe = getStateObj(this._hass, port.poeSwitch)?.state === "on";
              return `
                <div class="port ${up ? "up" : "down"} ${poe ? "poe" : ""}" data-port="${port.port}">
                  <div class="port-icon">${poe ? mdiIcon("mdi:flash") : mdiIcon("mdi:ethernet")}</div>
                  <div class="port-name">${port.port}</div>
                </div>
              `;
            })
            .join("")}
        </div>

        ${
          this._config.view === "detailed" || this._config.show_port_details
            ? `
          <div class="section">
            <div class="section-title">Ports</div>
            <div class="details-list">
              ${ports
                .map(
                  (port) => `
                    <div class="detail-row">
                      <div class="detail-head">
                        <strong>Port ${port.port}</strong>
                        <span class="detail-meta">${port.link ? stateDisplay(this._hass, port.link) : "No link entity"}</span>
                      </div>
                      <div class="metric-grid">
                        <div>
                          <div class="metric-label">Link</div>
                          <div class="metric-value">${port.link ? stateDisplay(this._hass, port.link) : "—"}</div>
                        </div>
                        <div>
                          <div class="metric-label">Speed</div>
                          <div class="metric-value">${port.speed && this._config.show_speed ? stateDisplay(this._hass, port.speed) : "—"}</div>
                        </div>
                        <div>
                          <div class="metric-label">PoE power</div>
                          <div class="metric-value">${port.poePower ? stateDisplay(this._hass, port.poePower) : "—"}</div>
                        </div>
                        <div>
                          <div class="metric-label">Profile</div>
                          <div class="metric-value">${port.profile ? stateDisplay(this._hass, port.profile) : "—"}</div>
                        </div>
                      </div>
                      <div class="actions">
                        ${port.poeSwitch ? `<button class="action" data-entity="${port.poeSwitch}" data-service="toggle">PoE on/off</button>` : ""}
                        ${port.powerCycle ? `<button class="action" data-entity="${port.powerCycle}" data-service="press">Power cycle</button>` : ""}
                        ${port.link ? `<button class="action" data-more-info="${port.link}">More info</button>` : ""}
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>`
            : ""
        }
      </ha-card>
    `;
  }

  _renderGateway(device) {
    const metrics = inferGatewayMetrics(this._hass, device.id);
    const important = [
      ["Internet", metrics.internet],
      ["CPU", metrics.cpu],
      ["Memory", metrics.memory],
      ["Temperature", metrics.temperature],
      ["Uptime", metrics.uptime],
      ["Clients", metrics.clients],
      ["Download", metrics.throughputDown],
      ["Upload", metrics.throughputUp],
    ].filter(([, entityId]) => !!entityId);

    return `
      ${cardStyle()}
      <ha-card>
        <div class="header">
          <div>
            <div class="title">${this._title()}</div>
            <div class="subtitle">${device.model || "Gateway / Console"}</div>
          </div>
        </div>

        <div class="metric-grid">
          ${important
            .map(
              ([label, entityId]) => `
                <div data-more-info="${entityId}">
                  <div class="metric-label">${label}</div>
                  <div class="metric-value">${stateDisplay(this._hass, entityId)}</div>
                </div>
              `,
            )
            .join("")}
        </div>

        ${
          this._config.show_gateway_ports
            ? `
          <div class="section">
            <div class="section-title">Discovered WAN / LAN entities</div>
            <div class="details-list">
              ${[...metrics.wan, ...metrics.lan]
                .slice(0, 30)
                .map(
                  (entityId) => `
                    <div class="detail-row" data-more-info="${entityId}">
                      <div class="detail-head">
                        <strong>${getStateObj(this._hass, entityId)?.attributes?.friendly_name || entityId}</strong>
                        <span class="detail-meta">${stateDisplay(this._hass, entityId)}</span>
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </div>`
            : ""
        }
      </ha-card>
    `;
  }

  render() {
    if (!this._hass || !this._config) return;
    const device = this._device();

    if (!device) {
      this.innerHTML = `${cardStyle()}<ha-card><div class="title">UniFi device not found</div></ha-card>`;
      return;
    }

    const kind = classifyUnifiDevice(this._hass, device.id);

    if (kind === "switch") {
      this.innerHTML = this._renderSwitch(device);
    } else if (kind === "gateway") {
      this.innerHTML = this._renderGateway(device);
    } else {
      this.innerHTML = `
        ${cardStyle()}
        <ha-card>
          <div class="title">${this._title()}</div>
          <div class="subtitle">Unsupported or not yet recognized device type</div>
        </ha-card>
      `;
    }

    this.querySelectorAll(".port").forEach((el) => {
      el.addEventListener("click", () => {
        const portNo = Number(el.dataset.port);
        const port = inferSwitchPorts(this._hass, device.id).find((p) => p.port === portNo);
        if (port) this._handlePortTap(port);
      });
    });

    this.querySelectorAll("[data-service]").forEach((button) => {
      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const entityId = button.dataset.entity;
        const service = button.dataset.service;
        if (!entityId || !service) return;
        if (service === "toggle") {
          callService(this._hass, "homeassistant", "toggle", { entity_id: entityId });
        } else if (service === "press") {
          callService(this._hass, "button", "press", { entity_id: entityId });
        }
      });
    });

    this.querySelectorAll("[data-more-info]").forEach((node) => {
      node.style.cursor = "pointer";
      node.addEventListener("click", (ev) => {
        const entityId = node.dataset.moreInfo;
        maybeOpenMoreInfo(this, entityId);
      });
    });
  }

  getCardSize() {
    return this._config?.view === "detailed" ? 8 : 4;
  }
}

customElements.define("unifi-device-card", UnifiDeviceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "unifi-device-card",
  name: "UniFi Device Card",
  description: "UniFi switch and gateway card with built-in config editor",
});
