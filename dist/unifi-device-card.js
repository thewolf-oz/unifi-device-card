
const DEFAULT_VIEW = "compact";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function lc(value) {
  return String(value || "").toLowerCase();
}

function includesAny(value, needles = []) {
  const hay = lc(value);
  return needles.some((n) => hay.includes(lc(n)));
}

function prettyName(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function getStateObj(hass, entityId) {
  return hass?.states?.[entityId];
}

function getEntityEntriesForDevice(hass, deviceId) {
  const reg = hass?.entities || {};
  return Object.values(reg).filter((entry) => entry.device_id === deviceId);
}

function getDeviceById(hass, deviceId) {
  const devices = hass?.devices || {};
  return devices[deviceId];
}

function entityFriendlyName(hass, entityId) {
  return getStateObj(hass, entityId)?.attributes?.friendly_name || entityId;
}

function isLikelyUnifiDevice(hass, device) {
  if (!device) return false;
  const manufacturer = lc(device.manufacturer);
  const model = lc(device.model);
  const name = lc(device.name_by_user || device.name);
  const via = lc(device.via_device_id);
  if (
    manufacturer.includes("ubiquiti") ||
    manufacturer.includes("unifi") ||
    model.includes("udm") ||
    model.includes("ucg") ||
    model.includes("usw") ||
    model.includes("us-") ||
    name.includes("unifi") ||
    name.includes("ubiquiti") ||
    name.includes("udm") ||
    name.includes("ucg") ||
    name.includes("usw") ||
    name.includes(" us ")
  ) {
    return true;
  }

  const entityEntries = getEntityEntriesForDevice(hass, device.id);
  return entityEntries.some((entry) => {
    const entityId = entry.entity_id || "";
    const original = `${entry.original_name || ""} ${entry.name || ""}`;
    return includesAny(`${entityId} ${original}`, [
      "unifi",
      "ubiquiti",
      "port_1",
      "poe",
      "wan",
      "clients",
      "gateway",
      "usw",
      "udm",
      "ucg",
    ]);
  }) || via.includes("unifi");
}

function listUnifiDevices(hass) {
  const devices = Object.values(hass?.devices || {});
  return devices
    .filter((device) => isLikelyUnifiDevice(hass, device))
    .sort((a, b) => {
      const an = (a.name_by_user || a.name || a.model || "").toLowerCase();
      const bn = (b.name_by_user || b.name || b.model || "").toLowerCase();
      return an.localeCompare(bn);
    });
}

function classifyUnifiDevice(hass, deviceId) {
  const device = getDeviceById(hass, deviceId);
  const text = [
    device?.manufacturer,
    device?.model,
    device?.name_by_user,
    device?.name,
  ].join(" ").toLowerCase();

  const entities = getEntityEntriesForDevice(hass, deviceId)
    .map((e) => `${e.entity_id || ""} ${e.original_name || ""} ${e.name || ""}`)
    .join(" ")
    .toLowerCase();

  const combined = `${text} ${entities}`;

  if (
    includesAny(combined, [
      "udm",
      "ucg",
      "gateway",
      "wan",
      "internet",
      "dream machine",
      "cloud gateway",
    ])
  ) {
    return "gateway";
  }

  if (
    includesAny(combined, [
      "port_1",
      "switch",
      "usw",
      "us-8",
      "poe",
      "ethernet",
    ])
  ) {
    return "switch";
  }

  return "generic";
}

function extractPortNumber(entityIdOrName) {
  const value = String(entityIdOrName || "").toLowerCase();

  const patterns = [
    /port[_\s-]?(\d+)/,
    /(\d+)[_\s-]?link/,
    /(\d+)[_\s-]?poe/,
    /ethernet[_\s-]?(\d+)/,
    /\b(\d+)\b/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function portSort(a, b) {
  return (a.port || 999) - (b.port || 999);
}

function inferSwitchPorts(hass, deviceId) {
  const entries = getEntityEntriesForDevice(hass, deviceId);
  const ports = new Map();

  for (const entry of entries) {
    const entityId = entry.entity_id;
    const state = getStateObj(hass, entityId);
    const label = `${entityId} ${entry.original_name || ""} ${entry.name || ""} ${state?.attributes?.friendly_name || ""}`;
    const port = extractPortNumber(label);
    if (!port) continue;

    if (!ports.has(port)) {
      ports.set(port, {
        port,
        label: `Port ${port}`,
        link: null,
        speed: null,
        poeSwitch: null,
        poePower: null,
        powerCycle: null,
        profile: null,
        vlan: null,
      });
    }
    const record = ports.get(port);
    const domain = entityId.split(".")[0];
    const text = label.toLowerCase();

    if (domain === "binary_sensor" && includesAny(text, ["link", "connected"])) {
      record.link = entityId;
    } else if (domain === "sensor" && includesAny(text, ["speed", "mbps", "gbe"])) {
      record.speed = entityId;
    } else if (domain === "sensor" && includesAny(text, ["poe power", "poe_power", "power draw", "consumption", "power"])) {
      record.poePower = entityId;
    } else if (domain === "switch" && includesAny(text, ["poe"])) {
      record.poeSwitch = entityId;
    } else if (domain === "button" && includesAny(text, ["power cycle", "restart", "cycle"])) {
      record.powerCycle = entityId;
    } else if (domain === "select" && includesAny(text, ["profile", "port profile"])) {
      record.profile = entityId;
    } else if ((domain === "select" || domain === "sensor") && includesAny(text, ["vlan"])) {
      record.vlan = entityId;
    }
  }

  return [...ports.values()].sort(portSort);
}

function inferGatewayMetrics(hass, deviceId) {
  const entries = getEntityEntriesForDevice(hass, deviceId);

  const metrics = {
    internet: null,
    wan: [],
    lan: [],
    cpu: null,
    memory: null,
    temperature: null,
    uptime: null,
    clients: null,
    throughputDown: null,
    throughputUp: null,
  };

  for (const entry of entries) {
    const entityId = entry.entity_id;
    const domain = entityId.split(".")[0];
    const state = getStateObj(hass, entityId);
    const text = `${entityId} ${entry.original_name || ""} ${entry.name || ""} ${state?.attributes?.friendly_name || ""}`.toLowerCase();

    if (!metrics.internet && includesAny(text, ["internet", "wan status", "isp status", "online"])) {
      metrics.internet = entityId;
    }
    if (!metrics.cpu && domain === "sensor" && includesAny(text, ["cpu"])) {
      metrics.cpu = entityId;
    }
    if (!metrics.memory && domain === "sensor" && includesAny(text, ["memory", "ram"])) {
      metrics.memory = entityId;
    }
    if (!metrics.temperature && domain === "sensor" && includesAny(text, ["temperature", "temp"])) {
      metrics.temperature = entityId;
    }
    if (!metrics.uptime && domain === "sensor" && includesAny(text, ["uptime"])) {
      metrics.uptime = entityId;
    }
    if (!metrics.clients && includesAny(text, ["clients"])) {
      metrics.clients = entityId;
    }
    if (!metrics.throughputDown && domain === "sensor" && includesAny(text, ["download", "rx", "downlink"])) {
      metrics.throughputDown = entityId;
    }
    if (!metrics.throughputUp && domain === "sensor" && includesAny(text, ["upload", "tx", "uplink"])) {
      metrics.throughputUp = entityId;
    }

    if (includesAny(text, ["wan", "internet"]) && domain !== "button") {
      metrics.wan.push(entityId);
    }
    if (includesAny(text, ["lan", "port_", "ethernet"]) && domain !== "button") {
      metrics.lan.push(entityId);
    }
  }

  metrics.wan = [...new Set(metrics.wan)];
  metrics.lan = [...new Set(metrics.lan)];
  return metrics;
}

function callService(hass, domain, service, serviceData) {
  return hass.callService(domain, service, serviceData);
}

function stateValue(hass, entityId) {
  return getStateObj(hass, entityId)?.state ?? "—";
}

function stateUnit(hass, entityId) {
  return getStateObj(hass, entityId)?.attributes?.unit_of_measurement || "";
}

function stateDisplay(hass, entityId) {
  if (!entityId) return "—";
  const value = stateValue(hass, entityId);
  const unit = stateUnit(hass, entityId);
  return unit ? `${value} ${unit}` : value;
}

function hasEntity(hass, entityId) {
  return !!getStateObj(hass, entityId);
}

function maybeOpenMoreInfo(node, entityId) {
  if (!entityId) return;
  node.dispatchEvent(
    new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }),
  );
}

function fireConfigChanged(node, config) {
  node.dispatchEvent(
    new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    }),
  );
}



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

class UnifiDeviceCard extends HTMLElement {
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
