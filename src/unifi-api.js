/**
 * unifi-api.js
 * Thin client for the UniFi Network Application REST API.
 *
 * Supports two authentication modes:
 *   1. API Key  (UniFi Network 8.x+, recommended)
 *      Header:  X-API-Key: <key>
 *
 *   2. Username / Password  (all versions, cookie-based session)
 *      POST /api/auth/login  → receives unifises + csrf cookie
 *
 * All requests use  credentials: "include"  so the browser forwards
 * the session cookie automatically after login.
 *
 * CORS note: The UCG/UDM serves CORS headers for same-LAN origins.
 * If the HA frontend is served from a different origin the browser
 * will block the pre-flight. In that case users need to use the
 * HA-proxy approach or run HA on the same host.
 */

const LOG = "[unifi-api]";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function baseUrl(host) {
  const h = String(host || "").replace(/\/+$/, "");
  return h.startsWith("http") ? h : `https://${h}`;
}

/**
 * Build a full API URL.
 * New-style (Network 8+):  /proxy/network/api/…
 * Old-style (UDM/UCG <8):  /api/…  or  /api/s/<site>/…
 */
function apiUrl(host, path, site = "default") {
  const base = baseUrl(host);
  // Normalise path – strip leading slash
  const p = path.replace(/^\/+/, "");
  // The new proxy namespace is available on all UDM/UCG running ≥8.x
  // We try it first; callers fall back to legacy if needed.
  return `${base}/proxy/network/${p}`;
}

function legacyApiUrl(host, path, site = "default") {
  const base = baseUrl(host);
  const p = path.replace(/^\/+/, "");
  // Replace placeholder {site} if present
  const resolved = p.replace("{site}", site);
  return `${base}/${resolved}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// UnifiApiClient
// ─────────────────────────────────────────────────────────────────────────────

export class UnifiApiClient {
  /**
   * @param {object} opts
   * @param {string}  opts.host      — IP or hostname of the controller (e.g. "192.168.1.1")
   * @param {string}  [opts.apiKey]  — API key (Network 8+, preferred)
   * @param {string}  [opts.username]
   * @param {string}  [opts.password]
   * @param {string}  [opts.site]    — UniFi site name, default "default"
   */
  constructor({ host, apiKey, username, password, site = "default" }) {
    this._host     = host;
    this._apiKey   = apiKey || null;
    this._username = username || null;
    this._password = password || null;
    this._site     = site;
    this._csrf     = null;
    this._loggedIn = false;
    this._legacy   = false; // will be set to true if new-style fails
  }

  // ── Internal fetch wrapper ────────────────────────────────────────────────

  async _fetch(url, opts = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };

    if (this._apiKey) {
      headers["X-API-Key"] = this._apiKey;
    }

    if (this._csrf) {
      headers["X-Csrf-Token"] = this._csrf;
    }

    const res = await fetch(url, {
      credentials: "include",
      ...opts,
      headers,
    });

    // Capture CSRF token for subsequent mutating requests
    const csrf = res.headers.get("x-csrf-token");
    if (csrf) this._csrf = csrf;

    return res;
  }

  // ── Authentication ────────────────────────────────────────────────────────

  /**
   * Login with username + password (cookie-based).
   * Not needed when using an API key.
   */
  async login() {
    if (this._apiKey) return; // API key needs no login
    if (this._loggedIn) return;

    if (!this._username || !this._password) {
      throw new Error("No API key and no username/password provided.");
    }

    // Try new-style endpoint first
    const urls = [
      `${baseUrl(this._host)}/api/auth/login`,
      `${baseUrl(this._host)}/api/login`,
    ];

    let lastErr;
    for (const url of urls) {
      try {
        const res = await this._fetch(url, {
          method: "POST",
          body: JSON.stringify({
            username: this._username,
            password: this._password,
            remember: false,
          }),
        });

        if (res.ok) {
          this._loggedIn = true;
          console.info(LOG, "Logged in via", url);
          return;
        }
        lastErr = new Error(`Login failed: HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr;
  }

  // ── Generic GET with new→legacy fallback ─────────────────────────────────

  async _get(newPath, legacyPath) {
    // Try new-style proxy endpoint
    if (!this._legacy) {
      try {
        const url = apiUrl(this._host, newPath, this._site);
        const res = await this._fetch(url);
        if (res.ok) {
          const json = await res.json();
          return json?.data ?? json;
        }
        // 404 usually means old firmware without proxy namespace
        if (res.status === 404 || res.status === 401) {
          console.warn(LOG, "New-style endpoint not available, switching to legacy");
          this._legacy = true;
        } else {
          throw new Error(`GET ${url} → HTTP ${res.status}`);
        }
      } catch (e) {
        if (e.message?.includes("HTTP")) throw e;
        // Network error → try legacy
        this._legacy = true;
      }
    }

    // Legacy endpoint
    const url = legacyApiUrl(this._host, legacyPath, this._site);
    const res  = await this._fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
    const json = await res.json();
    return json?.data ?? json;
  }

  async _put(newPath, legacyPath, body) {
    if (!this._legacy) {
      try {
        const url = apiUrl(this._host, newPath, this._site);
        const res = await this._fetch(url, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const json = await res.json();
          return json?.data ?? json;
        }
        if (res.status === 404) this._legacy = true;
        else throw new Error(`PUT ${url} → HTTP ${res.status}`);
      } catch (e) {
        if (e.message?.includes("HTTP")) throw e;
        this._legacy = true;
      }
    }

    const url = legacyApiUrl(this._host, legacyPath, this._site);
    const res  = await this._fetch(url, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${url} → HTTP ${res.status}`);
    const json = await res.json();
    return json?.data ?? json;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Test connection – returns true if the controller is reachable
   * and credentials are valid.
   */
  async testConnection() {
    try {
      await this.login();
      const sites = await this._get(
        "api/sites",
        "api/self/sites"
      );
      return Array.isArray(sites) && sites.length > 0;
    } catch (e) {
      console.error(LOG, "testConnection failed:", e);
      return false;
    }
  }

  /**
   * List all UniFi network devices (switches, gateways, APs …).
   * Returns an array of device objects from the controller.
   */
  async getDevices() {
    await this.login();
    return this._get(
      `api/s/${this._site}/stat/device`,
      `api/s/{site}/stat/device`
    );
  }

  /**
   * Get a single device by its MAC address.
   */
  async getDevice(mac) {
    await this.login();
    const devices = await this.getDevices();
    return devices.find((d) =>
      d.mac?.toLowerCase() === mac?.toLowerCase()
    ) || null;
  }

  /**
   * Get rich port data for a device.
   *
   * Returns an array of port objects like:
   * {
   *   port_idx:    1,
   *   name:        "Port 1",
   *   up:          true,
   *   speed:       1000,       // Mbit
   *   duplex:      "full",
   *   poe_enable:  true,
   *   poe_power:   "4.50",     // W
   *   poe_voltage: "53.00",    // V
   *   poe_current: "0.08",     // A
   *   "rx_bytes-r": 12540,     // current RX rate bytes/s
   *   "tx_bytes-r": 8320,
   *   rx_bytes:    1234567890, // total
   *   tx_bytes:    987654321,
   *   mac_table:   [{mac, hostname, ip}],
   * }
   */
  async getPortTable(mac) {
    await this.login();
    const device = await this.getDevice(mac);
    if (!device) throw new Error(`Device ${mac} not found`);

    const portTable = device.port_table || [];
    return portTable.map((p) => ({
      port_idx:    p.port_idx,
      name:        p.name || `Port ${p.port_idx}`,
      up:          Boolean(p.up),
      speed:       p.speed || 0,
      duplex:      p.full_duplex ? "full" : "half",
      poe_enable:  Boolean(p.poe_enable),
      poe_mode:    p.poe_mode || null,
      poe_power:   p.poe_power   ? String(p.poe_power)   : null,
      poe_voltage: p.poe_voltage ? String(p.poe_voltage) : null,
      poe_current: p.poe_current ? String(p.poe_current) : null,
      rx_rate:     p["rx_bytes-r"] ?? 0,
      tx_rate:     p["tx_bytes-r"] ?? 0,
      rx_bytes:    p.rx_bytes    ?? 0,
      tx_bytes:    p.tx_bytes    ?? 0,
      mac_table:   p.mac_table   || [],
      // raw data for debugging
      _raw:        p,
    }));
  }

  /**
   * Toggle PoE on a specific port.
   * @param {string} deviceId  — UniFi device _id
   * @param {number} portIdx   — 1-based port index
   * @param {boolean} enable
   */
  async setPortPoe(deviceId, portIdx, enable) {
    await this.login();

    // We need the current port_overrides array first
    const devices = await this.getDevices();
    const device  = devices.find((d) => d._id === deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    const overrides = device.port_overrides ? [...device.port_overrides] : [];
    const idx       = overrides.findIndex((o) => o.port_idx === portIdx);

    const updated = {
      port_idx:   portIdx,
      poe_mode:   enable ? "auto" : "off",
      ...(idx >= 0 ? overrides[idx] : {}),
    };
    updated.poe_mode = enable ? "auto" : "off";

    if (idx >= 0) overrides[idx] = updated;
    else overrides.push(updated);

    return this._put(
      `api/s/${this._site}/rest/device/${deviceId}`,
      `api/s/{site}/rest/device/${deviceId}`,
      { port_overrides: overrides }
    );
  }

  /**
   * Power-cycle (bounce) a PoE port.
   */
  async powerCyclePort(deviceMac, portIdx) {
    await this.login();

    const url = this._legacy
      ? legacyApiUrl(this._host, `api/s/{site}/cmd/devmgr`, this._site)
      : apiUrl(this._host, `api/s/${this._site}/cmd/devmgr`);

    const res = await this._fetch(url, {
      method: "POST",
      body: JSON.stringify({
        cmd:      "power-cycle",
        mac:      deviceMac,
        port_idx: portIdx,
      }),
    });

    if (!res.ok) throw new Error(`power-cycle → HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Fetch all known sites (useful for testing/autocomplete).
   */
  async getSites() {
    await this.login();
    return this._get("api/sites", "api/self/sites");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton cache – one client per unique host+site combination
// so the card doesn't re-login on every hass update cycle.
// ─────────────────────────────────────────────────────────────────────────────

const _clientCache = new Map();

export function getApiClient(config) {
  const { unifi_host, unifi_api_key, unifi_username, unifi_password, unifi_site } = config;
  if (!unifi_host) return null;

  const key = `${unifi_host}|${unifi_site || "default"}|${unifi_api_key || unifi_username || ""}`;

  if (!_clientCache.has(key)) {
    _clientCache.set(
      key,
      new UnifiApiClient({
        host:     unifi_host,
        apiKey:   unifi_api_key   || null,
        username: unifi_username  || null,
        password: unifi_password  || null,
        site:     unifi_site      || "default",
      })
    );
  }
  return _clientCache.get(key);
}

/**
 * Invalidate cached client (e.g. after config change).
 */
export function clearApiClient(config) {
  const { unifi_host, unifi_site, unifi_api_key, unifi_username } = config;
  const key = `${unifi_host}|${unifi_site || "default"}|${unifi_api_key || unifi_username || ""}`;
  _clientCache.delete(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers used by the card renderer
// ─────────────────────────────────────────────────────────────────────────────

export function formatBytes(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return null;
  if (bytesPerSec >= 1_000_000) return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1_000)     return `${(bytesPerSec / 1_000).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}

export function formatSpeed(mbit) {
  if (!mbit || mbit <= 0) return "—";
  if (mbit >= 1000) return `${mbit / 1000} Gbit`;
  return `${mbit} Mbit`;
}
