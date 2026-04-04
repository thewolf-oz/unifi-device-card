const HA_CACHE = new WeakMap();

function getCache(hass) {
  if (!HA_CACHE.has(hass)) {
    HA_CACHE.set(hass, {
      configEntries: null,
      devices: null,
      entities: null,
      unifiDevices: null,
    });
  }
  return HA_CACHE.get(hass);
}

async function safeCallWS(hass, msg) {
  try {
    return await hass.callWS(msg);
  } catch (err) {
    console.warn("[unifi-device-card] WS call failed:", msg?.type, err);
    return [];
  }
}

async function getConfigEntries(hass) {
  const cache = getCache(hass);
  if (!cache.configEntries) {
    cache.configEntries = safeCallWS(hass, {
      type: "config/config_entries/entry",
    });
  }
  return cache.configEntries;
}

async function getDeviceRegistry(hass) {
  const cache = getCache(hass);
  if (!cache.devices) {
    cache.devices = safeCallWS(hass, {
      type: "config/device_registry/list",
    });
  }
  return cache.devices;
}

async function getEntityRegistry(hass) {
  const cache = getCache(hass);
  if (!cache.entities) {
    cache.entities = safeCallWS(hass, {
      type: "config/entity_registry/list",
    });
  }
  return cache.entities;
}

function norm(value) {
  return String(value || "").trim();
}

function low(value) {
  return norm(value).toLowerCase();
}

function hasAny(text, needles) {
  const hay = low(text);
  return needles.some((needle) => hay.includes(needle));
}

function isUnifiEntry(entry) {
  const domain = low(entry?.domain);
  const title = low(entry?.title);
  return (
    domain === "unifi" ||
    domain === "unifi_network" ||
    title.includes("unifi")
  );
}

function buildEntityMap(entityRegistry) {
  const byDeviceId = new Map();

  for (const entity of entityRegistry || []) {
    const deviceId = entity.device_id;
    if (!deviceId) continue;
    if (!byDeviceId.has(deviceId)) byDeviceId.set(deviceId, []);
    byDeviceId.get(deviceId).push(entity);
  }

  return byDeviceId;
}

function getBestName(device) {
  return (
    norm(device?.name_by_user) ||
    norm(device?.name) ||
    norm(device?.model) ||
    norm(device?.manufacturer) ||
    "Unknown device"
  );
}

function getDisplayModel(device) {
  return norm(device?.model) || norm(device?.hw_version) || "";
}

function getDisplayManufacturer(device) {
  return norm(device?.manufacturer) || "";
}

function countPortEntities(entities) {
  let count = 0;
  for (const entity of entities || []) {
    const eid = low(entity.entity_id);
    const original = low(entity.original_name);
    const name = low(entity.name);
    if (
      eid.includes("_port_") ||
      original.includes("port ") ||
      original.includes(" port ") ||
      name.includes("port ")
    ) {
      count += 1;
    }
  }
  return count;
}

function classifyUnifiDevice(device, entities = []) {
  const text = [
    device?.name_by_user,
    device?.name,
    device?.model,
    device?.manufacturer,
    device?.hw_version,
    ...entities.flatMap((e) => [e.entity_id, e.original_name, e.name]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const portEntityCount = countPortEntities(entities);

  const isGateway =
    hasAny(text, [
      "udm",
      "dream machine",
      "ucg",
      "gateway",
      "uxg",
      "wan",
      "internet",
    ]) && !hasAny(text, ["access point", "uap"]);

  const isAccessPoint = hasAny(text, [
    "access point",
    "uap",
    "nanohd",
    "mesh",
    "u6",
    "u7",
    "uap-",
    "ap ",
    " ap",
  ]);

  const isSwitch =
    portEntityCount > 0 ||
    hasAny(text, [
      "usw",
      "us-",
      "switch",
      "lite 8",
      "lite 16",
      "flex",
      "enterprise",
      "aggregation",
      "port 1",
    ]);

  if (isGateway) return "gateway";
  if (isSwitch) return "switch";
  if (isAccessPoint) return "access_point";
  return "unknown";
}

function isLikelyUnifiDevice(device, entities, unifiEntryIds) {
  const manufacturer = low(device?.manufacturer);
  const model = low(device?.model);
  const name = low(device?.name);
  const userName = low(device?.name_by_user);

  const byConfigEntry =
    Array.isArray(device?.config_entries) &&
    device.config_entries.some((entryId) => unifiEntryIds.has(entryId));

  const byManufacturer =
    manufacturer.includes("ubiquiti") || manufacturer.includes("unifi");

  const byNameOrModel = hasAny(
    `${name} ${userName} ${model}`,
    [
      "unifi",
      "usw",
      "us-",
      "udm",
      "ucg",
      "uxg",
      "uap",
      "mesh",
      "dream machine",
      "gateway",
      "switch",
      "flex",
    ]
  );

  const byEntities = (entities || []).some((entity) =>
    hasAny(
      `${entity.entity_id} ${entity.original_name} ${entity.name} ${entity.platform}`,
      [
        "unifi",
        "usw",
        "us-",
        "udm",
        "ucg",
        "uxg",
        "_port_",
        "wan",
        "uplink",
        "poe",
      ]
    )
  );

  return byConfigEntry || byManufacturer || byNameOrModel || byEntities;
}

function buildLabel(item) {
  const bits = [item.name];

  if (item.model && low(item.model) !== low(item.name)) {
    bits.push(item.model);
  }

  if (item.type === "switch") bits.push("Switch");
  if (item.type === "gateway") bits.push("Gateway");
  if (item.type === "access_point") bits.push("AP");

  return bits.join(" · ");
}

export async function getUnifiDevices(hass, options = {}) {
  const {
    includeAccessPoints = false,
    includeUnknown = false,
  } = options;

  const cache = getCache(hass);
  const cacheKey = JSON.stringify({ includeAccessPoints, includeUnknown });

  if (cache.unifiDevices?.[cacheKey]) {
    return cache.unifiDevices[cacheKey];
  }

  const [configEntries, devices, entityRegistry] = await Promise.all([
    getConfigEntries(hass),
    getDeviceRegistry(hass),
    getEntityRegistry(hass),
  ]);

  const unifiEntryIds = new Set(
    (configEntries || []).filter(isUnifiEntry).map((entry) => entry.entry_id)
  );

  const entitiesByDeviceId = buildEntityMap(entityRegistry || []);

  const filtered = (devices || [])
    .map((device) => {
      const entities = entitiesByDeviceId.get(device.id) || [];
      return { device, entities };
    })
    .filter(({ device, entities }) =>
      isLikelyUnifiDevice(device, entities, unifiEntryIds)
    )
    .map(({ device, entities }) => {
      const type = classifyUnifiDevice(device, entities);

      return {
        id: device.id,
        name: getBestName(device),
        model: getDisplayModel(device),
        manufacturer: getDisplayManufacturer(device),
        type,
        label: "",
        device,
        entities,
      };
    })
    .filter((item) => {
      if (item.type === "access_point" && !includeAccessPoints) return false;
      if (item.type === "unknown" && !includeUnknown) return false;
      return item.type === "switch" || item.type === "gateway" || item.type === "access_point" || includeUnknown;
    })
    .map((item) => ({
      ...item,
      label: buildLabel(item),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "de", { sensitivity: "base" }));

  if (!cache.unifiDevices) cache.unifiDevices = {};
  cache.unifiDevices[cacheKey] = filtered;

  return filtered;
}

export async function getUnifiDeviceById(hass, deviceId, options = {}) {
  const devices = await getUnifiDevices(hass, {
    includeAccessPoints: true,
    includeUnknown: true,
    ...options,
  });

  return devices.find((device) => device.id === deviceId) || null;
}

export function clearUnifiDeviceCache(hass) {
  if (!HA_CACHE.has(hass)) return;
  const cache = HA_CACHE.get(hass);
  cache.configEntries = null;
  cache.devices = null;
  cache.entities = null;
  cache.unifiDevices = null;
}
