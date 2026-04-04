
export const DEFAULT_VIEW = "compact";

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function lc(value) {
  return String(value || "").toLowerCase();
}

export function includesAny(value, needles = []) {
  const hay = lc(value);
  return needles.some((n) => hay.includes(lc(n)));
}

export function prettyName(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function getStateObj(hass, entityId) {
  return hass?.states?.[entityId];
}

export function getEntityEntriesForDevice(hass, deviceId) {
  const reg = hass?.entities || {};
  return Object.values(reg).filter((entry) => entry.device_id === deviceId);
}

export function getDeviceById(hass, deviceId) {
  const devices = hass?.devices || {};
  return devices[deviceId];
}

export function entityFriendlyName(hass, entityId) {
  return getStateObj(hass, entityId)?.attributes?.friendly_name || entityId;
}

export function isLikelyUnifiDevice(hass, device) {
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

export function listUnifiDevices(hass) {
  const devices = Object.values(hass?.devices || {});
  return devices
    .filter((device) => isLikelyUnifiDevice(hass, device))
    .sort((a, b) => {
      const an = (a.name_by_user || a.name || a.model || "").toLowerCase();
      const bn = (b.name_by_user || b.name || b.model || "").toLowerCase();
      return an.localeCompare(bn);
    });
}

export function classifyUnifiDevice(hass, deviceId) {
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

export function extractPortNumber(entityIdOrName) {
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

export function portSort(a, b) {
  return (a.port || 999) - (b.port || 999);
}

export function inferSwitchPorts(hass, deviceId) {
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

export function inferGatewayMetrics(hass, deviceId) {
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

export function callService(hass, domain, service, serviceData) {
  return hass.callService(domain, service, serviceData);
}

export function stateValue(hass, entityId) {
  return getStateObj(hass, entityId)?.state ?? "—";
}

export function stateUnit(hass, entityId) {
  return getStateObj(hass, entityId)?.attributes?.unit_of_measurement || "";
}

export function stateDisplay(hass, entityId) {
  if (!entityId) return "—";
  const value = stateValue(hass, entityId);
  const unit = stateUnit(hass, entityId);
  return unit ? `${value} ${unit}` : value;
}

export function hasEntity(hass, entityId) {
  return !!getStateObj(hass, entityId);
}

export function maybeOpenMoreInfo(node, entityId) {
  if (!entityId) return;
  node.dispatchEvent(
    new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }),
  );
}

export function fireConfigChanged(node, config) {
  node.dispatchEvent(
    new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    }),
  );
}
