/**
 * unifi-api.js
 *
 * UniFi Network Application REST API client.
 *
 * ── Warum direkte Browser-Requests nicht funktionieren ───────────────────
 *
 * Die offizielle HA UniFi Integration (aiounifi) läuft als Python-Prozess
 * serverseitig auf dem HA-Host und nutzt aiohttp — kein Browser, kein CORS.
 *
 * Ein Dashboard-Plugin läuft im Browser. Der Browser blockiert fetch()-Calls
 * von http://ha-host:8123 → https://ucg-ip durch CORS, weil die UCG/UDM
 * keinen Access-Control-Allow-Origin Header setzt.
 *
 * WebSockets wären CORS-frei, aber Browser-WebSockets können keine Custom-
 * Headers senden (kein X-API-Key), und Cookie-Auth erfordert vorher einen
 * Login-fetch — der ebenfalls an CORS scheitert.
 *
 * ── Wann funktioniert es trotzdem ────────────────────────────────────────
 *
 * Der direkte API-Modus funktioniert wenn HA über einen Reverse-Proxy
 * (nginx, Caddy, …) auf HTTPS läuft und die UCG auf derselben Domain
 * oder IP erreichbar ist — oder wenn der Browser explizit CORS-frei
 * konfiguriert ist (lokale Entwicklungsumgebung).
 *
 * In allen anderen Fällen (Standard-HA-Setup, HTTP, verschiedene Hosts)
 * liefert dieser Client einen klaren Fehler mit Erklärung statt still
 * zu versagen.
 *
 * ── Datenfluss ────────────────────────────────────────────────────────────
 *
 * Primär:  HA-Entities via hass.states  (immer verfügbar, kein CORS)
 * Optional: Direkte UCG-API             (nur mit passendem Netzwerk-Setup)
 */

const LOG = "[unifi-api]";

// ─────────────────────────────────────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────────────────────────────────────

function baseUrl(host) {
  const h = String(host || "").replace(/\/+$/, "");
  return h.startsWith("http") ? h : `https://${h}`;
}

// UniFi OS (UDM/UCG ≥ 1.x): /proxy/network/api/s/<site>/...
function newStyleUrl(host, path, site) {
  return `${baseUrl(host)}/proxy/network/api/s/${site}${path}`;
}

// Legacy (standalone Network Application): /api/s/<site>/...
function legacyUrl(host, path, site) {
  return `${baseUrl(host)}/api/s/${site}${path}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// UnifiApiClient
// ─────────────────────────────────────────────────────────────────────────────

export class UnifiApiClient {
  /**
   * @param {object} opts
   * @param {string}  opts.host      IP or hostname of the controller
   * @param {string}  [opts.apiKey]  API key (Network 8+, preferred)
   * @param {string}  [opts.username]
   * @param {string}  [opts.password]
   * @param {string}  [opts.site]    default "default"
   */
  constructor({ host, apiKey, username, password, site = "default" }) {
    this._host     = host;
    this._apiKey   = apiKey     || null;
    this._username = username   || null;
    this._password = password   || null;
    this._site     = site;
    this._csrf     = null;
    this._cookie   = null;
    this._loggedIn = false;
    this._isUnifiOs = null; // detected on first request
  }

  // ── Low-level fetch ───────────────────────────────────────────────────────

  async _fetch(url, opts = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    };

    if (this._apiKey)  headers["X-API-Key"]    = this._apiKey;
    if (this._csrf)    headers["X-Csrf-Token"]  = this._csrf;
    if (this._cookie)  headers["Cookie"]        = this._cookie;

    let res;
    try {
      res = await fetch(url, {
        credentials: "include",
        ...opts,
        headers,
      });
    } catch (e) {
      // Network error or CORS preflight block
      if (e instanceof TypeError && e.message.toLowerCase().includes("failed to fetch")) {
        throw new CorsError(
          `CORS-Fehler: Der Browser blockiert den direkten Zugriff auf ${url}. ` +
          `Stelle sicher dass HA und UCG über HTTPS auf derselben Domain erreichbar sind, ` +
          `oder nutze einen Reverse-Proxy (nginx, Caddy). ` +
          `Alternativ: Die Card funktioniert vollständig ohne API über HA-Entities.`
        );
      }
      throw e;
    }

    // Capture auth tokens for subsequent requests
    const csrf   = res.headers.get("x-csrf-token");
    const cookie = res.headers.get("set-cookie");
    if (csrf)   this._csrf   = csrf;
    if (cookie) this._cookie = cookie;

    return res;
  }

  // ── Detect UniFi OS vs standalone ────────────────────────────────────────

  async _detectOs() {
    if (this._isUnifiOs !== null) return;
    try {
      const res = await this._fetch(baseUrl(this._host), {
        method: "GET",
        redirect: "manual",
      });
      // UniFi OS returns 200 on root; standalone redirects to /manage
      this._isUnifiOs = (res.status === 200 || res.status === 0);
    } catch (e) {
      if (e instanceof CorsError) throw e;
      this._isUnifiOs = true; // assume UniFi OS on error
    }
    console.info(LOG, `UniFi OS mode: ${this._isUnifiOs}`);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login() {
    if (this._apiKey)   return; // API key — no login needed
    if (this._loggedIn) return;

    if (!this._username || !this._password) {
      throw new Error("Keine Zugangsdaten: Bitte API-Key oder Benutzername/Passwort angeben.");
    }

    await this._detectOs();

    const loginPath = this._isUnifiOs ? "/api/auth/login" : "/api/login";
    const url       = `${baseUrl(this._host)}${loginPath}`;

    const res = await this._fetch(url, {
      method: "POST",
      body: JSON.stringify({
        username:   this._username,
        password:   this._password,
        rememberMe: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Login fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 120)}`);
    }

    this._loggedIn = true;
    console.info(LOG, "Logged in via", url);
  }

  // ── Generic request with new-style → legacy fallback ─────────────────────

  async _get(path) {
    await this._detectOs();

    const url = this._isUnifiOs
      ? newStyleUrl(this._host, path, this._site)
      : legacyUrl(this._host, path, this._site);

    const res = await this._fetch(url);

    if (res.status === 404 && this._isUnifiOs) {
      // Try legacy path as fallback
      const fallback = await this._fetch(legacyUrl(this._host, path, this._site));
      if (!fallback.ok) throw new Error(`GET ${path} → HTTP ${fallback.status}`);
      const json = await fallback.json();
      return json?.data ?? json;
    }

    if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
    const json = await res.json();
    return json?.data ?? json;
  }

  async _put(path, body) {
    await this._detectOs();

    const url = this._isUnifiOs
      ? newStyleUrl(this._host, path, this._site)
      : legacyUrl(this._host, path, this._site);

    const res = await this._fetch(url, {
      method: "PUT",
      body:   JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`PUT ${url} → HTTP ${res.status}`);
    const json = await res.json();
    return json?.data ?? json;
  }

  async _post(path, body) {
    await this._detectOs();

    const url = this._isUnifiOs
      ? newStyleUrl(this._host, path, this._site)
      : legacyUrl(this._host, path, this._site);

    const res = await this._fetch(url, {
      method: "POST",
      body:   JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`POST ${url} → HTTP ${res.status}`);
    return res.json();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getSites() {
    await this.login();
    // Sites endpoint is always on root, not under /s/<site>/
    await this._detectOs();
    const url = this._isUnifiOs
      ? `${baseUrl(this._host)}/proxy/network/api/sites`
      : `${baseUrl(this._host)}/api/self/sites`;
    const res  = await this._fetch(url);
    if (!res.ok) throw new Error(`getSites → HTTP ${res.status}`);
    const json = await res.json();
    return json?.data ?? json;
  }

  async getDevices() {
    await this.login();
    return this._get("/stat/device");
  }

  async getDevice(mac) {
    const devices = await this.getDevices();
    return devices.find((d) =>
      d.mac?.toLowerCase() === mac?.toLowerCase()
    ) || null;
  }

  async getPortTable(mac) {
    const device = await this.getDevice(mac);
    if (!device) throw new Error(`Gerät ${mac} nicht gefunden`);

    return (device.port_table || []).map((p) => ({
      port_idx:    p.port_idx,
      name:        p.name || `Port ${p.port_idx}`,
      up:          Boolean(p.up),
      speed:       p.speed || 0,
      duplex:      p.full_duplex ? "full" : "half",
      poe_enable:  Boolean(p.poe_enable),
      poe_mode:    p.poe_mode   || null,
      poe_power:   p.poe_power   != null ? String(p.poe_power)   : null,
      poe_voltage: p.poe_voltage != null ? String(p.poe_voltage) : null,
      poe_current: p.poe_current != null ? String(p.poe_current) : null,
      rx_rate:     p["rx_bytes-r"] ?? 0,
      tx_rate:     p["tx_bytes-r"] ?? 0,
      rx_bytes:    p.rx_bytes ?? 0,
      tx_bytes:    p.tx_bytes ?? 0,
      mac_table:   p.mac_table  || [],
    }));
  }

  async setPortPoe(deviceId, portIdx, enable) {
    await this.login();
    const devices   = await this.getDevices();
    const device    = devices.find((d) => d._id === deviceId);
    if (!device) throw new Error(`Gerät ${deviceId} nicht gefunden`);

    const overrides = [...(device.port_overrides || [])];
    const i         = overrides.findIndex((o) => o.port_idx === portIdx);
    const entry     = { ...(i >= 0 ? overrides[i] : {}), port_idx: portIdx, poe_mode: enable ? "auto" : "off" };

    if (i >= 0) overrides[i] = entry;
    else overrides.push(entry);

    return this._put(`/rest/device/${deviceId}`, { port_overrides: overrides });
  }

  async powerCyclePort(deviceMac, portIdx) {
    await this.login();
    return this._post("/cmd/devmgr", {
      cmd:      "power-cycle",
      mac:      deviceMac,
      port_idx: portIdx,
    });
  }

  async testConnection() {
    try {
      await this.login();
      const sites = await this.getSites();
      return Array.isArray(sites) ? sites : [];
    } catch (e) {
      throw e;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom error type so the UI can show a specific CORS message
// ─────────────────────────────────────────────────────────────────────────────

export class CorsError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "CorsError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton client cache
// ─────────────────────────────────────────────────────────────────────────────

const _cache = new Map();

export function getApiClient(config) {
  const { unifi_host, unifi_api_key, unifi_username, unifi_password, unifi_site } = config;
  if (!unifi_host) return null;

  const site = (unifi_site || "default").trim() || "default";
  const key  = `${unifi_host}|${site}|${unifi_api_key || unifi_username || ""}`;

  if (!_cache.has(key)) {
    _cache.set(key, new UnifiApiClient({
      host:     unifi_host,
      apiKey:   unifi_api_key  || null,
      username: unifi_username || null,
      password: unifi_password || null,
      site,
    }));
  }
  return _cache.get(key);
}

export function clearApiClient(config) {
  const site = (config.unifi_site || "default").trim() || "default";
  const key  = `${config.unifi_host}|${site}|${config.unifi_api_key || config.unifi_username || ""}`;
  _cache.delete(key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

export function formatBytes(bps) {
  if (!bps || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  if (bps >= 1_000)     return `${(bps / 1_000).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

export function formatSpeed(mbit) {
  if (!mbit || mbit <= 0) return "—";
  if (mbit >= 1000) return `${mbit / 1000} Gbit`;
  return `${mbit} Mbit`;
}
