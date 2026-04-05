import { getDeviceLayout, resolveModelKey } from "./model-registry.js";

function normalize(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return normalize(value).toLowerCase();
}

function entityText(entity) {
  return [
    entity.entity_id,
    entity.original_name,
    entity.name,
    entity.platform,
    entity.device_class,
    entity.translation_key,
    entity.original_device_class,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function deviceText(device, entities) {
  return [
    device.name_by_user,
    device.name,
    device.model,
    device.manufacturer,
    device.hw_version,
    device.sw_version,
    device.serial_number,
    ...entities.flatMap((e) => [
      e.entity_id,
      e.original_name,
      e.name,
      e.platform,
      e.device_class,
      e.translation_key,
      e.original_device_class,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ─────────────────────────────────────────────────
// UniFi config-entry detection
// Supports: "unifi", "unifi_network" and any entry
// whose title/domain contains "unifi"
// ─────────────────────────────────────────────────
function isUnifiConfigEntry(entry) {
  const domain = lower(entry?.domain);
  const title  = lower(entry?.title);
  return (
    domain === "unifi" ||
    domain === "unifi_network" ||
    domain.includes("unifi") ||
    title.includes("unifi")
  );
}

function extractUnifiEntryIds(configEntries) {
  return new Set(
    (configEntries || []).filter(isUnifiConfigEntry).map((entry) => entry.entry_id)
  );
}

function hasUbiquitiManufacturer(device) {
  const manufacturer = lower(device?.manufacturer);
  return (
    manufacturer.includes("ubiquiti") ||
    manufacturer.includes("unifi")
  );
}

function isAccessPoint(device, entities) {
  const model    = lower(device?.model);
  const name     = lower(device?.name);
  const userName = lower(device?.name_by_user);
  const text     = deviceText(device, entities);

  return (
    model.includes("uap") ||
    model.includes("u6") ||
    model.includes("u7") ||
    model.includes("acpro") ||
    model.includes("ac-lite") ||
    model.includes("aclr") ||
    model.includes("nanohd") ||
    name.includes("ac pro") ||
    userName.includes("ac pro") ||
    name.includes("access point") ||
    userName.includes("access point") ||
    text.includes("access point") ||
    text.includes("uap-") ||
    text.includes(" ac pro") ||
    text.includes(" nanohd") ||
    text.includes(" mesh")
  );
}

function classifyDevice(device, entities) {
  if (isAccessPoint(device, entities)) return "access_point";

  const modelKey = resolveModelKey(device);

  if (
    modelKey === "UDRULT" ||
    modelKey === "UCGULTRA" ||
    modelKey === "UCGMAX" ||
    modelKey === "UDMPRO" ||
    modelKey === "UDMSE"
  ) {
    return "gateway";
  }

  if (
    modelKey === "US8P60"   ||
    modelKey === "USMINI"   ||
    modelKey === "USL8LP"   ||
    modelKey === "USL8LPB"  ||
    modelKey === "USL16LP"  ||
    modelKey === "USL16LPB"
  ) {
    return "switch";
  }

  const model    = lower(device?.model);
  const name     = lower(device?.name);
  const userName = lower(device?.name_by_user);

  if (
    model.includes("udm") ||
    model.includes("ucg") ||
    model.includes("uxg") ||
    model.includes("gateway") ||
    name.includes("gateway") ||
    userName.includes("gateway")
  ) {
    return "gateway";
  }

  // If entities have numbered port pattern → definitely a switch
  const hasPorts = entities.some((e) => /_port_\d+_/i.test(e.entity_id));
  if (hasPorts) return "switch";

  if (
    model.includes("usw")    ||
    model.includes("us8")    ||
    model.includes("usmini") ||
    model.includes("usl8")   ||
    model.includes("usl16")  ||
    name.includes("lite 8")  ||
    name.includes("lite 16") ||
    name.includes("switch")  ||
    userName.includes("switch")
  ) {
    return "switch";
  }

  return "unknown";
}

async function safeCallWS(hass, msg, fallback = []) {
  try {
    return await hass.callWS(msg);
  } catch (err) {
    console.warn("[unifi-device-card] WS failed", msg?.type, err);
    return fallback;
  }
}

async function getAllData(hass) {
  const [devices, entities, configEntries] = await Promise.all([
    safeCallWS(hass, { type: "config/device_registry/list" }, []),
    safeCallWS(hass, { type: "config/entity_registry/list" }, []),
    safeCallWS(hass, { type: "config/config_entries/entry" }, []),
  ]);

  const entitiesByDevice = new Map();
  for (const entity of entities) {
    if (!entity.device_id) continue;
    if (!entitiesByDevice.has(entity.device_id)) {
      entitiesByDevice.set(entity.device_id, []);
    }
    entitiesByDevice.get(entity.device_id).push(entity);
  }

  return { devices, entitiesByDevice, configEntries };
}

// ─────────────────────────────────────────────────
// FIX: Relaxed UniFi device check.
// Previously required BOTH manufacturer AND hint.
// Now: byConfigEntry is sufficient on its own.
// Fallback: manufacturer OR strong text hint is enough
// (covers cases where manufacturer field is empty/wrong).
// ─────────────────────────────────────────────────
function isUnifiDevice(device, unifiEntryIds, entities) {
  // Strongest signal: device is registered under a UniFi config entry
  const byConfigEntry =
    Array.isArray(device?.config_entries) &&
    device.config_entries.some((id) => unifiEntryIds.has(id));

  if (byConfigEntry) return true;

  // Secondary: Ubiquiti/UniFi manufacturer label
  const byManufacturer = hasUbiquitiManufacturer(device);

  // Tertiary: strong textual model hints
  const text = deviceText(device, entities);
  const byModelHint =
    text.includes("usw") ||
    text.includes("usl8") ||
    text.includes("usl16") ||
    text.includes("usmini") ||
    text.includes("us8") ||
    text.includes("udm") ||
    text.includes("ucg") ||
    text.includes("uxg") ||
    text.includes("lite 8 poe") ||
    text.includes("lite 16 poe") ||
    text.includes("cloud gateway") ||
    text.includes("unifi switch") ||
    text.includes("unifi dream");

  // Accept device if manufacturer matches OR a strong model hint is present
  return byManufacturer || byModelHint;
}

function buildDeviceLabel(device, type) {
  const name =
    normalize(device.name_by_user) ||
    normalize(device.name) ||
    normalize(device.model) ||
    "Unknown device";

  const model     = normalize(device.model);
  const typeLabel = type === "gateway" ? "Gateway" : "Switch";

  if (model && lower(model) !== lower(name)) {
    return `${name} · ${model} (${typeLabel})`;
  }
  return `${name} (${typeLabel})`;
}

function extractFirmware(device, entities) {
  if (normalize(device?.sw_version)) return normalize(device.sw_version);

  const firmwareEntity = entities.find((entity) => {
    const id   = lower(entity.entity_id);
    const text = entityText(entity);
    return id.includes("firmware") || id.includes("version") || text.includes("firmware");
  });

  return firmwareEntity ? firmwareEntity.entity_id : "";
}

export async function getUnifiDevices(hass) {
  const { devices, entitiesByDevice, configEntries } = await getAllData(hass);
  const unifiEntryIds = extractUnifiEntryIds(configEntries);

  return (devices || [])
    .map((device) => {
      const entities = entitiesByDevice.get(device.id) || [];
      if (!isUnifiDevice(device, unifiEntryIds, entities)) return null;

      const type = classifyDevice(device, entities);
      if (type !== "switch" && type !== "gateway") return null;

      return {
        id:    device.id,
        name:  normalize(device.name_by_user) || normalize(device.name) || normalize(device.model),
        label: buildDeviceLabel(device, type),
        model: normalize(device.model),
        type,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
}

export async function getDeviceContext(hass, deviceId) {
  const { devices, entitiesByDevice, configEntries } = await getAllData(hass);
  const unifiEntryIds = extractUnifiEntryIds(configEntries);

  const device = devices.find((d) => d.id === deviceId);
  if (!device) return null;

  const entities = entitiesByDevice.get(deviceId) || [];
  if (!isUnifiDevice(device, unifiEntryIds, entities)) return null;

  const type = classifyDevice(device, entities);
  if (type !== "switch" && type !== "gateway") return null;

  const numberedPorts = discoverPorts(entities);
  const specialPorts  = discoverSpecialPorts(entities);
  const layout        = getDeviceLayout(device, numberedPorts);

  return {
    device,
    entities,
    type,
    layout,
    specialPorts,
    name:         normalize(device.name_by_user) || normalize(device.name) || normalize(device.model),
    model:        normalize(device.model),
    manufacturer: normalize(device.manufacturer),
    firmware:     extractFirmware(device, entities),
  };
}

function extractPortNumber(entity) {
  const id           = entity.entity_id   || "";
  const originalName = entity.original_name || "";
  const name         = entity.name          || "";

  // e.g. sensor.switch_port_3_link_speed
  let match = id.match(/_port_(\d+)_/i);
  if (match) return Number(match[1]);

  // e.g. "Port 3 Link Speed"
  match = originalName.match(/\bport\s+(\d+)\b/i);
  if (match) return Number(match[1]);

  match = name.match(/\bport\s+(\d+)\b/i);
  if (match) return Number(match[1]);

  return null;
}

function ensurePort(map, port) {
  if (!map.has(port)) {
    map.set(port, {
      key:               `port-${port}`,
      port,
      label:             String(port),
      kind:              "numbered",
      link_entity:       null,
      speed_entity:      null,
      poe_switch_entity: null,
      poe_power_entity:  null,
      power_cycle_entity:null,
      raw_entities:      [],
    });
  }
  return map.get(port);
}

function ensureSpecialPort(map, key, label) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      port:              null,
      label,
      kind:              "special",
      link_entity:       null,
      speed_entity:      null,
      poe_switch_entity: null,
      poe_power_entity:  null,
      power_cycle_entity:null,
      raw_entities:      [],
    });
  }
  return map.get(key);
}

function isLikelyLinkStateValue(value) {
  const v = String(value ?? "").toLowerCase();
  return (
    v === "on"           ||
    v === "off"          ||
    v === "up"           ||
    v === "down"         ||
    v === "connected"    ||
    v === "disconnected" ||
    v === "true"         ||
    v === "false"
  );
}

// ─────────────────────────────────────────────────
// Speed / throughput entity guard
// ─────────────────────────────────────────────────
function isThroughputEntity(id, text) {
  return (
    id.includes("throughput")  ||
    id.includes("traffic")     ||
    id.includes("download")    ||
    id.includes("upload")      ||
    id.includes("_rx")         ||
    id.includes("_tx")         ||
    id.includes("bandwidth")   ||
    text.includes("throughput")||
    text.includes("download")  ||
    text.includes("upload")    ||
    text.includes("traffic")
  );
}

// ─────────────────────────────────────────────────
// FIX: classifyPortEntity
//
// Previous bug: sensor link detection required BOTH
// a keyword in the entity_id AND a keyword in
// entityText(). Because translation_key / original_name
// may not always contain "port"/"link"/"connected",
// many valid link sensors fell through unclassified.
//
// New approach:
//  1. binary_sensor → always link if it has a
//     link/connected/state keyword in id OR text
//  2. sensor → link if id contains _link, _status,
//     _port_status, or _state (and not throughput,
//     not speed). The text check is now OPTIONAL
//     (OR, not AND).
//  3. sensor speed: id must contain link_speed,
//     _speed, ethernet_speed, or negotiated_speed
//     and must NOT be a throughput entity.
// ─────────────────────────────────────────────────
function classifyPortEntity(entity) {
  const id   = lower(entity.entity_id);
  const text = entityText(entity);

  // ── binary_sensor: any link/connected/state hint ──
  if (entity.entity_id.startsWith("binary_sensor.")) {
    if (
      id.includes("_link")        ||
      id.includes("_connected")   ||
      id.includes("_connection")  ||
      id.includes("_state")       ||
      text.includes(" link")      ||
      text.includes("connected")  ||
      text.includes("connection")
    ) {
      return "link_entity";
    }
  }

  // ── sensor: speed entity (check BEFORE generic link) ──
  if (
    entity.entity_id.startsWith("sensor.") &&
    !isThroughputEntity(id, text) &&
    (
      id.includes("link_speed")        ||
      id.includes("ethernet_speed")    ||
      id.includes("negotiated_speed")  ||
      // ends with _speed but is NOT a throughput sensor
      (id.endsWith("_speed") && !isThroughputEntity(id, text))
    )
  ) {
    return "speed_entity";
  }

  // ── sensor: link/status entity ──
  // FIX: only require id-level keyword; text check is optional bonus
  if (entity.entity_id.startsWith("sensor.")) {
    const hasIdKeyword =
      id.includes("_link")         ||
      id.includes("_port_status")  ||
      id.includes("_port_state")   ||
      id.includes("_status")       ||
      id.includes("_state");

    const hasTextKeyword =
      text.includes("port")      ||
      text.includes("link")      ||
      text.includes("connected") ||
      text.includes("status")    ||
      text.includes("state");

    if (!isThroughputEntity(id, text) && hasIdKeyword && hasTextKeyword) {
      return "link_entity";
    }

    // Relaxed: id keyword alone is sufficient if it contains "port" in the id too
    if (!isThroughputEntity(id, text) && id.includes("_port_") && hasIdKeyword) {
      return "link_entity";
    }
  }

  // ── switch.* PoE toggle ──
  if (
    entity.entity_id.startsWith("switch.") &&
    (id.includes("_poe") || text.includes("poe"))
  ) {
    return "poe_switch_entity";
  }

  // ── sensor.* PoE power ──
  if (
    entity.entity_id.startsWith("sensor.") &&
    (
      id.includes("_poe_power")                             ||
      (text.includes("poe") && text.includes("power"))     ||
      (text.includes("poe") && text.includes(" w"))
    )
  ) {
    return "poe_power_entity";
  }

  // ── button.* Power Cycle / Restart ──
  if (
    entity.entity_id.startsWith("button.") &&
    (
      id.includes("power_cycle")                          ||
      id.includes("restart")                             ||
      id.includes("reboot")                              ||
      (text.includes("power") && text.includes("cycle"))
    )
  ) {
    return "power_cycle_entity";
  }

  return null;
}

function detectSpecialPortKey(entity) {
  const text = entityText(entity);
  const id   = lower(entity.entity_id);

  if (text.includes("wan 2") || id.includes("wan2"))
    return { key: "wan2", label: "WAN 2" };
  if ((text.includes("wan") || id.includes("wan")) && (text.includes("sfp") || id.includes("sfp")))
    return { key: "sfp_wan", label: "WAN SFP+" };
  if ((text.includes("lan") || id.includes("lan")) && (text.includes("sfp") || id.includes("sfp")))
    return { key: "sfp_lan", label: "LAN SFP+" };
  if (text.includes("wan") || id.includes("wan"))
    return { key: "wan", label: "WAN" };
  if (text.includes("sfp+") || text.includes("sfp") || id.includes("sfp"))
    return { key: "sfp", label: "SFP" };

  return null;
}

export function discoverPorts(entities) {
  const ports = new Map();

  for (const entity of entities || []) {
    const port = extractPortNumber(entity);
    if (!port) continue;

    const row = ensurePort(ports, port);
    row.raw_entities.push(entity.entity_id);

    const type = classifyPortEntity(entity);
    if (type && !row[type]) {
      row[type] = entity.entity_id;
    }
  }

  // If a port has no power_cycle_entity, strip PoE fields
  for (const row of ports.values()) {
    if (!row.power_cycle_entity) {
      row.poe_switch_entity = null;
      row.poe_power_entity  = null;
    }
  }

  return Array.from(ports.values()).sort((a, b) => a.port - b.port);
}

export function discoverSpecialPorts(entities) {
  const specials = new Map();

  for (const entity of entities || []) {
    if (extractPortNumber(entity)) continue;

    const special = detectSpecialPortKey(entity);
    if (!special) continue;

    const row  = ensureSpecialPort(specials, special.key, special.label);
    row.raw_entities.push(entity.entity_id);

    const type = classifyPortEntity(entity);
    if (type && !row[type]) {
      row[type] = entity.entity_id;
    }
  }

  return Array.from(specials.values());
}

export function mergePortsWithLayout(layout, discoveredPorts) {
  const byPort     = new Map(discoveredPorts.map((p) => [p.port, p]));
  const layoutPorts = (layout?.rows || []).flat();
  const merged     = [];

  for (const portNumber of layoutPorts) {
    merged.push(
      byPort.get(portNumber) || {
        key:               `port-${portNumber}`,
        port:              portNumber,
        label:             String(portNumber),
        kind:              "numbered",
        link_entity:       null,
        speed_entity:      null,
        poe_switch_entity: null,
        poe_power_entity:  null,
        power_cycle_entity:null,
        raw_entities:      [],
      }
    );
  }

  for (const port of discoveredPorts) {
    if (!layoutPorts.includes(port.port)) merged.push(port);
  }

  return merged.sort((a, b) => (a.port ?? 999) - (b.port ?? 999));
}

export function mergeSpecialsWithLayout(layout, discoveredSpecials) {
  const byKey         = new Map(discoveredSpecials.map((s) => [s.key, s]));
  const layoutSpecials = layout?.specialSlots || [];

  const merged = layoutSpecials.map((slot) => {
    return (
      byKey.get(slot.key) || {
        key:               slot.key,
        port:              null,
        label:             slot.label,
        kind:              "special",
        link_entity:       null,
        speed_entity:      null,
        poe_switch_entity: null,
        poe_power_entity:  null,
        power_cycle_entity:null,
        raw_entities:      [],
      }
    );
  });

  for (const special of discoveredSpecials) {
    if (!layoutSpecials.some((s) => s.key === special.key)) merged.push(special);
  }

  return merged;
}

export function stateObj(hass, entityId) {
  return entityId ? hass.states[entityId] || null : null;
}

export function stateValue(hass, entityId, fallback = "—") {
  const state = stateObj(hass, entityId);
  return state ? state.state : fallback;
}

// ─────────────────────────────────────────────────
// FIX: isOn
// Added "1" and numeric string > 0 as active values.
// Some UniFi speed sensors report "1000" (Mbit) for
// an active port with no dedicated binary_sensor.
// Also added "active" as a valid "on" state.
// ─────────────────────────────────────────────────
export function isOn(hass, entityId) {
  const state = stateObj(hass, entityId);
  if (!state) return false;

  const value = String(state.state).toLowerCase();
  if (
    value === "on"        ||
    value === "connected" ||
    value === "up"        ||
    value === "true"      ||
    value === "active"    ||
    value === "1"
  ) return true;

  // Numeric speed value > 0 means port is up
  const num = parseFloat(value);
  if (!isNaN(num) && num > 0) {
    // Only treat as link-state if the entity looks like a link/status entity
    const id = lower(entityId);
    if (
      id.includes("_link")   ||
      id.includes("_status") ||
      id.includes("_state")  ||
      id.includes("_port_status")
    ) return true;
  }

  return false;
}

export function formatState(hass, entityId, fallback = "—") {
  const state = stateObj(hass, entityId);
  if (!state) return fallback;

  const unit = state.attributes?.unit_of_measurement;
  if (state.state === "unknown" || state.state === "unavailable") return "—";

  return unit ? `${state.state} ${unit}` : state.state;
}

// ─────────────────────────────────────────────────
// FIX: getPortLinkText
// Falls back to raw_entities scan, now also
// considers numeric speed > 0 as "connected".
// Also uses speed_entity as last resort indicator.
// ─────────────────────────────────────────────────
export function getPortLinkText(hass, port) {
  const direct = stateObj(hass, port?.link_entity);
  if (direct) {
    const value = String(direct.state ?? "");
    if (isLikelyLinkStateValue(value)) return value;
  }

  for (const entityId of port?.raw_entities || []) {
    const st = stateObj(hass, entityId);
    if (!st) continue;

    const value = String(st.state ?? "");
    const id    = lower(entityId);

    if (
      isLikelyLinkStateValue(value) &&
      !id.includes("poe") &&
      !id.includes("power") &&
      !id.includes("speed")
    ) {
      return value;
    }
  }

  // Last resort: if speed entity has a positive value → port is up
  if (port?.speed_entity) {
    const speedState = stateObj(hass, port.speed_entity);
    if (speedState) {
      const num = parseFloat(speedState.state);
      if (!isNaN(num) && num > 0) return "connected";
    }
  }

  return "—";
}

function simplifySpeed(value, unit = "") {
  const raw     = String(value ?? "").trim().toLowerCase();
  const rawUnit = String(unit  ?? "").trim().toLowerCase();

  if (!raw || raw === "unknown" || raw === "unavailable") return "—";

  const number = parseFloat(raw.replace(",", "."));

  if (!Number.isNaN(number)) {
    if (rawUnit.includes("gbit"))  return `${Math.round(number * 1000)} Mbit`;
    if (rawUnit.includes("mbit"))  return `${Math.round(number)} Mbit`;
    if (number === 10 || number === 100 || number === 1000 || number === 2500 || number === 10000) {
      return `${Math.round(number)} Mbit`;
    }
  }

  if (raw.includes("10g"))   return "10000 Mbit";
  if (raw.includes("2.5g"))  return "2500 Mbit";
  if (raw.includes("1g"))    return "1000 Mbit";
  if (raw.includes("1000"))  return "1000 Mbit";
  if (raw.includes("100m"))  return "100 Mbit";
  if (raw === "100")         return "100 Mbit";
  if (raw.includes("10m"))   return "10 Mbit";
  if (raw === "10")          return "10 Mbit";

  return "—";
}

export function getPortSpeedText(hass, port) {
  const direct = stateObj(hass, port?.speed_entity);
  if (direct) {
    const result = simplifySpeed(direct.state, direct.attributes?.unit_of_measurement);
    if (result !== "—") return result;
  }

  for (const entityId of port?.raw_entities || []) {
    const st = stateObj(hass, entityId);
    if (!st) continue;

    const id   = lower(entityId);
    const unit  = st.attributes?.unit_of_measurement || "";
    const value = String(st.state ?? "");

    if (isThroughputEntity(id, id)) continue;

    if (
      id.includes("link_speed")       ||
      id.endsWith("_speed")           ||
      id.includes("ethernet_speed")   ||
      id.includes("negotiated_speed")
    ) {
      const result = simplifySpeed(value, unit);
      if (result !== "—") return result;
    }
  }

  return "—";
}
