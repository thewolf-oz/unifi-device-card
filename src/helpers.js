export async function getUnifiDevices(hass) {
  const [devices, entities] = await Promise.all([
    hass.callWS({ type: "config/device_registry/list" }),
    hass.callWS({ type: "config/entity_registry/list" }),
  ]);

  return devices
    .map((device) => {
      const devEntities = entities.filter(
        (e) => e.device_id === device.id
      );

      const text = (
        (device.name || "") +
        (device.model || "") +
        (device.manufacturer || "") +
        devEntities.map((e) => e.entity_id).join(" ")
      ).toLowerCase();

      const isUnifi =
        text.includes("unifi") ||
        text.includes("usw") ||
        text.includes("udm") ||
        text.includes("ucg");

      const isAP =
        text.includes("access point") ||
        text.includes("uap");

      const isSwitch =
        text.includes("port_") ||
        text.includes("switch");

      const isGateway =
        text.includes("udm") ||
        text.includes("gateway");

      return {
        id: device.id,
        name:
          device.name_by_user ||
          device.name ||
          device.model ||
          "Unknown",
        type: isGateway
          ? "gateway"
          : isSwitch
          ? "switch"
          : "other",
        valid: isUnifi && !isAP,
      };
    })
    .filter((d) => d.valid)
    .sort((a, b) => a.name.localeCompare(b.name));
}
