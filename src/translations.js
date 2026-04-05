/**
 * translations.js
 *
 * UI string translations for the UniFi Device Card.
 * Language is detected from Home Assistant (hass.language)
 * and falls back to English for any unsupported locale.
 *
 * To add a new language: copy the "en" block, change the key,
 * and translate the values.
 */

const TRANSLATIONS = {
  en: {
    // Card states
    select_device:      "Please select a UniFi device in the card editor.",
    loading:            "Loading device data…",
    no_data:            "No device data available.",
    no_ports:           "No ports detected.",

    // Front panel
    front_panel:        "Front Panel",

    // Port detail
    link_status:        "Link Status",
    speed:              "Speed",
    poe:                "PoE",
    poe_power:          "PoE Power",
    connected:          "Connected",
    no_link:            "No link",
    online:             "Online",
    offline:            "Offline",

    // Actions
    port_disable:       "Disable port",
    port_enable:        "Enable port",
    poe_off:            "PoE off",
    poe_on:             "PoE on",
    power_cycle:        "Power Cycle",

    // Hints
    speed_disabled:     "Speed entity disabled — enable it in HA to show link speed.",

    // Editor
    editor_device_title:   "Device",
    editor_device_label:   "UniFi Device",
    editor_device_loading: "Loading devices from Home Assistant…",
    editor_device_select:  "Select device…",
    editor_name_label:     "Display name",
    editor_name_hint:      "Optional — defaults to device name",
    editor_no_devices:     "No UniFi switches or gateways found in Home Assistant.",
    editor_hint:           "Only devices from the UniFi Network Integration are shown.",
    editor_error:          "Failed to load UniFi devices.",

    // Device type labels (used in device selector)
    type_switch:  "Switch",
    type_gateway: "Gateway",
  },

  de: {
    select_device:      "Bitte im Karteneditor ein UniFi-Gerät auswählen.",
    loading:            "Lade Gerätedaten…",
    no_data:            "Keine Gerätedaten verfügbar.",
    no_ports:           "Keine Ports erkannt.",

    front_panel:        "Front Panel",

    link_status:        "Link Status",
    speed:              "Geschwindigkeit",
    poe:                "PoE",
    poe_power:          "PoE Leistung",
    connected:          "Verbunden",
    no_link:            "Kein Link",
    online:             "Online",
    offline:            "Offline",

    port_disable:       "Port deaktivieren",
    port_enable:        "Port aktivieren",
    poe_off:            "PoE Aus",
    poe_on:             "PoE Ein",
    power_cycle:        "Power Cycle",

    speed_disabled:     "Speed-Entity deaktiviert — in HA aktivieren für Geschwindigkeitsanzeige.",

    editor_device_title:   "Gerät",
    editor_device_label:   "UniFi Gerät",
    editor_device_loading: "Lade Geräte aus Home Assistant…",
    editor_device_select:  "Gerät auswählen…",
    editor_name_label:     "Anzeigename",
    editor_name_hint:      "Optional — wird sonst vom Gerät übernommen",
    editor_no_devices:     "Keine UniFi Switches oder Gateways in Home Assistant gefunden.",
    editor_hint:           "Nur Geräte aus der UniFi Network Integration werden angezeigt.",
    editor_error:          "UniFi-Geräte konnten nicht geladen werden.",

    type_switch:  "Switch",
    type_gateway: "Gateway",
  },

  nl: {
    select_device:      "Selecteer een UniFi-apparaat in de kaarteditor.",
    loading:            "Apparaatgegevens laden…",
    no_data:            "Geen apparaatgegevens beschikbaar.",
    no_ports:           "Geen poorten gedetecteerd.",

    front_panel:        "Frontpaneel",

    link_status:        "Linkstatus",
    speed:              "Snelheid",
    poe:                "PoE",
    poe_power:          "PoE Vermogen",
    connected:          "Verbonden",
    no_link:            "Geen link",
    online:             "Online",
    offline:            "Offline",

    port_disable:       "Poort uitschakelen",
    port_enable:        "Poort inschakelen",
    poe_off:            "PoE uit",
    poe_on:             "PoE aan",
    power_cycle:        "Power Cycle",

    speed_disabled:     "Snelheids-entiteit uitgeschakeld — schakel in HA in om linksnelheid te tonen.",

    editor_device_title:   "Apparaat",
    editor_device_label:   "UniFi Apparaat",
    editor_device_loading: "Apparaten laden uit Home Assistant…",
    editor_device_select:  "Selecteer apparaat…",
    editor_name_label:     "Weergavenaam",
    editor_name_hint:      "Optioneel — standaard de naam van het apparaat",
    editor_no_devices:     "Geen UniFi-switches of gateways gevonden in Home Assistant.",
    editor_hint:           "Alleen apparaten uit de UniFi Network-integratie worden weergegeven.",
    editor_error:          "UniFi-apparaten konden niet worden geladen.",

    type_switch:  "Switch",
    type_gateway: "Gateway",
  },

  fr: {
    select_device:      "Veuillez sélectionner un appareil UniFi dans l'éditeur de carte.",
    loading:            "Chargement des données…",
    no_data:            "Aucune donnée disponible.",
    no_ports:           "Aucun port détecté.",

    front_panel:        "Panneau avant",

    link_status:        "État du lien",
    speed:              "Vitesse",
    poe:                "PoE",
    poe_power:          "Puissance PoE",
    connected:          "Connecté",
    no_link:            "Pas de lien",
    online:             "En ligne",
    offline:            "Hors ligne",

    port_disable:       "Désactiver le port",
    port_enable:        "Activer le port",
    poe_off:            "PoE désactivé",
    poe_on:             "PoE activé",
    power_cycle:        "Redémarrage PoE",

    speed_disabled:     "Entité de vitesse désactivée — activez-la dans HA pour afficher la vitesse.",

    editor_device_title:   "Appareil",
    editor_device_label:   "Appareil UniFi",
    editor_device_loading: "Chargement des appareils…",
    editor_device_select:  "Sélectionner un appareil…",
    editor_name_label:     "Nom d'affichage",
    editor_name_hint:      "Optionnel — par défaut le nom de l'appareil",
    editor_no_devices:     "Aucun switch ou gateway UniFi trouvé dans Home Assistant.",
    editor_hint:           "Seuls les appareils de l'intégration UniFi Network sont affichés.",
    editor_error:          "Impossible de charger les appareils UniFi.",

    type_switch:  "Switch",
    type_gateway: "Passerelle",
  },
};

/**
 * Get translations for the given language code.
 * Falls back to "en" for any unsupported language.
 * Supports both full locale ("de-DE") and short ("de").
 */
export function getTranslations(lang) {
  if (!lang) return TRANSLATIONS.en;
  const short = String(lang).split("-")[0].toLowerCase();
  return TRANSLATIONS[short] || TRANSLATIONS.en;
}

/**
 * Convenience: get a single translated string.
 * Usage: t(hass, "loading")
 */
export function t(hass, key) {
  const lang = hass?.language || "en";
  const strings = getTranslations(lang);
  return strings[key] ?? TRANSLATIONS.en[key] ?? key;
}
