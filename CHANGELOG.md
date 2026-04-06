# Changelog

## [Unreleased]

---

## [v0.2.0] - 2026-04-06

### 🐛 Bug Fixes

- **Port discovery for renamed entities** — Home Assistant 2022.6+ no longer includes `unique_id` in the WebSocket entity registry list. Port numbers for renamed port entities could no longer be resolved, causing ports to appear without data. Missing `unique_id`s are now fetched on demand via `config/entity_registry/get` and patched in before port discovery runs.

- **UDM Pro port count & special slots** — Port count corrected from 8 to 11. WAN/SFP special slots now carry explicit port numbers (9, 10, 11) so they are resolved from real port data instead of relying on fragile key matching. Slot keys updated to `wan`, `sfp_1`, `sfp_2`.

- **Special port online detection** — WAN and SFP uplink ports no longer show a false "online" state caused by stale link-speed sensors. If RX/TX bandwidth sensors are available, live traffic is used to determine whether the port is actually carrying data.

- **PoE status for ports without a switch entity** — Ports that expose only a `poe_power` sensor (no toggle switch) now correctly show PoE power consumption. The PoE toggle button is hidden for these ports instead of appearing non-functional.

- **Special slot port-label in detail panel** — Custom port labels (`port_label`) are now also shown for special slots (WAN, SFP) in the detail panel, not only for numbered ports.

- **Sensor value formatting** — Numeric sensor states are now rounded to two decimal places (e.g. `1.23 Mbit/s` instead of `1.2345678 Mbit/s`).

- **Special ports excluded from numbered port grid** — Ports that are mapped to a special slot by port number are now correctly excluded from the regular port grid to avoid duplicate rendering.

---

### ✨ New Devices

- **US 16 PoE 150W (`US16P150`)** — 16 RJ45 PoE ports in a dual-row layout (2 × 8) plus two dedicated SFP uplink slots (ports 17 & 18). Model aliases `US16P` and `US16P150` are both recognized.

- **USW Pro 24 (`US24PRO2`)** — 24 RJ45 ports in a six-grid layout (4 × 6) plus two dedicated SFP+ uplink slots (ports 25 & 26). Recognized via model strings `US24PRO2`, `US24PRO`, and `USWPRO24`.

---

### 🎨 UI / Visual Changes

- **USW 24 PoE layout** — Switched from a `dual-row` (2 × 12) layout to `six-grid` (4 × 6) for a more accurate representation of the physical front panel.

- **Port LED — PoE indicator** — The separate orange PoE LED has been replaced with a subtle ring highlight (`box-shadow`) on the link LED when PoE is active. This matches the visual style of real UniFi switches where a single LED indicates both link and PoE state through color and brightness rather than a second indicator. The PoE state remains fully visible in the port detail panel.

- **Port LED alignment** — LEDs are now centered within the port button instead of being spread to the edges.
