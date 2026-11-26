import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import type express from 'express';

function resolveWritableVaultRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), '.cache', 'vault'),
    path.resolve(os.tmpdir(), 'vidcloud-vault'),
  ];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // try next directory
    }
  }
  return candidates[1];
}

const VAULT_ROOT = resolveWritableVaultRoot();
const MAX_MEM_VAULT_ENTRIES = 600;
const memVault = new Map<string, { data: any; savedAt: number }>();

function ensureVaultDir(): void {
  if (!fs.existsSync(VAULT_ROOT)) {
    fs.mkdirSync(VAULT_ROOT, { recursive: true });
  }
}

function getSafeVaultFilePath(key: string): string {
  ensureVaultDir();
  const hash = crypto.createHash('sha256').update(String(key)).digest('hex');
  const resolved = path.resolve(VAULT_ROOT, `${hash}.json`);
  if (!resolved.startsWith(VAULT_ROOT + path.sep)) {
    throw new Error('Invalid vault path');
  }
  return resolved;
}

export function readVaultJson<T = any>(key: string, maxAgeMs?: number): { data: T; savedAt: number } | null {
  const mem = memVault.get(key);
  if (mem) {
    if (!maxAgeMs || Date.now() - mem.savedAt <= maxAgeMs) {
      return mem as { data: T; savedAt: number };
    }
  }

  try {
    const filePath = getSafeVaultFilePath(key);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { savedAt?: number; data?: T };
    if (!parsed || parsed.data === undefined) return null;
    const savedAt = Number(parsed.savedAt || 0);
    if (maxAgeMs && Date.now() - savedAt > maxAgeMs) {
      return null;
    }
    const entry = { data: parsed.data as T, savedAt };
    if (memVault.size >= MAX_MEM_VAULT_ENTRIES) {
      const oldestKey = memVault.keys().next().value;
      if (oldestKey) memVault.delete(oldestKey);
    }
    memVault.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export function writeVaultJson<T = any>(key: string, data: T): void {
  if (data === undefined || data === null) return;
  const savedAt = Date.now();
  if (memVault.size >= MAX_MEM_VAULT_ENTRIES) {
    const oldestKey = memVault.keys().next().value;
    if (oldestKey) memVault.delete(oldestKey);
  }
  memVault.set(key, { data, savedAt });

  try {
    const filePath = getSafeVaultFilePath(key);
    const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    if (!tmpPath.startsWith(VAULT_ROOT + path.sep)) return;
    fs.writeFileSync(tmpPath, JSON.stringify({ savedAt, data }), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    // non-fatal disk write error
  }
}

export function getVaultStats(): { memoryEntries: number; diskFiles: number } {
  let diskFiles = 0;
  try {
    if (fs.existsSync(VAULT_ROOT)) {
      diskFiles = fs.readdirSync(VAULT_ROOT).filter((f) => f.endsWith('.json')).length;
    }
  } catch {
    diskFiles = 0;
  }
  return { memoryEntries: memVault.size, diskFiles };
}

// Circuit breakers for external upstreams so dead/CF-blocked domains never hang requests
interface BreakerState {
  failures: number;
  openUntil: number;
  lastError: string;
}

const breakers = new Map<string, BreakerState>();
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 90 * 1000;

export function isCircuitOpen(name: string): boolean {
  const st = breakers.get(name);
  if (!st) return false;
  if (Date.now() < st.openUntil) return true;
  if (st.openUntil > 0 && Date.now() >= st.openUntil) {
    breakers.set(name, { failures: 0, openUntil: 0, lastError: st.lastError });
  }
  return false;
}

export function recordUpstreamSuccess(name: string): void {
  breakers.set(name, { failures: 0, openUntil: 0, lastError: '' });
}

export function recordUpstreamFailure(name: string, reason: string, immediateOpen = false): void {
  const prev = breakers.get(name) || { failures: 0, openUntil: 0, lastError: '' };
  const failures = immediateOpen ? BREAKER_THRESHOLD : prev.failures + 1;
  const openUntil = failures >= BREAKER_THRESHOLD ? Date.now() + BREAKER_COOLDOWN_MS : prev.openUntil;
  breakers.set(name, { failures, openUntil, lastError: reason });
}

export function getBreakerSnapshot(): Record<string, { open: boolean; failures: number }> {
  const out: Record<string, { open: boolean; failures: number }> = {};
  for (const [k, v] of breakers.entries()) {
    out[k] = { open: Date.now() < v.openUntil, failures: v.failures };
  }
  return out;
}

// Strict SSRF validation blocking loopback, private IPv4/IPv6, CGNAT, link-local, and metadata hosts
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // ULA fc00::/7
  if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (ip.startsWith('::ffff:')) {
    const v4Part = ip.slice(7);
    if (net.isIPv4(v4Part)) return isPrivateIpv4(v4Part);
    return true;
  }
  return false;
}

export function isAllowedProxyHost(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;
    const rawHost = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (!rawHost) return false;

    if (
      rawHost === 'localhost' ||
      rawHost.endsWith('.localhost') ||
      rawHost.endsWith('.local') ||
      rawHost.endsWith('.internal') ||
      rawHost === 'metadata.google.internal' ||
      rawHost === 'metadata'
    ) {
      return false;
    }

    const strippedHost = rawHost.replace(/^\[|\]$/g, '');
    const ipVer = net.isIP(strippedHost);
    if (ipVer === 4) return !isPrivateIpv4(strippedHost);
    if (ipVer === 6) return !isPrivateIpv6(strippedHost);

    // Reject single-integer or hex/octal IP obfuscation (e.g. http://2130706433 or http://0x7f000001)
    if (/^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(strippedHost)) {
      return false;
    }

    return strippedHost.includes('.');
  } catch {
    return false;
  }
}

export async function safeProxyFetch(
  initialUrl: string,
  headers: Record<string, string>,
  timeoutMs = 20000
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= 4; hop++) {
    if (!isAllowedProxyHost(currentUrl)) {
      throw new Error('Blocked unsafe redirect or disallowed host');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { response: res, finalUrl: currentUrl };
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    return { response: res, finalUrl: currentUrl };
  }
  throw new Error('Too many redirects');
}

// Sliding-window in-memory rate limiter for heavy proxy/AI/auth routes
export function createRateLimiter(opts: { windowMs: number; maxRequests: number; message?: string }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // Periodically prune expired buckets
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets.entries()) {
      if (now >= v.resetAt) buckets.delete(k);
    }
  }, Math.max(30000, opts.windowMs)).unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = fwd || req.ip || 'local';
    const now = Date.now();
    const cur = buckets.get(ip);

    if (!cur || now >= cur.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }

    cur.count += 1;
    if (cur.count > opts.maxRequests) {
      const retrySec = Math.max(1, Math.ceil((cur.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      return res.status(429).json({
        success: false,
        message: opts.message || 'Too many requests. Please pause a few seconds and retry.',
      });
    }
    return next();
  };
}
