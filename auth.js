import crypto from 'node:crypto';
import { getConfig, setConfig } from './db.js';

const COOKIE = 'jc_admin';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

// Secret sesi — dibuat sekali dan disimpan agar sesi bertahan lintas restart.
function secret() {
  let s = getConfig('session_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); setConfig('session_secret', s); }
  return s;
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

// Inisialisasi kata sandi admin bila belum ada (default dapat di-override via ENV).
export function ensureAdminPassword() {
  if (getConfig('admin_hash')) return;
  const initial = process.env.ADMIN_PASSWORD || 'admin123';
  setAdminPassword(initial);
  console.log(`\n[AUTH] Kata sandi admin awal: "${initial}"  (ubah via ENV ADMIN_PASSWORD atau endpoint ganti sandi)\n`);
}

export function setAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  setConfig('admin_salt', salt);
  setConfig('admin_hash', hashPassword(password, salt));
}

export function verifyPassword(password) {
  const salt = getConfig('admin_salt');
  const hash = getConfig('admin_hash');
  if (!salt || !hash) return false;
  const candidate = hashPassword(password || '', salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function makeToken() {
  const payload = `admin.${Date.now() + MAX_AGE_MS}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!payload.startsWith('admin.')) return false;
  const expires = Number(payload.split('.')[1]);
  if (!expires || Date.now() > expires) return false;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function isAdmin(req) {
  return verifyToken(parseCookies(req)[COOKIE]);
}

export function setAuthCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${makeToken()}; HttpOnly; Path=/; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}; SameSite=Lax`);
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// Middleware: tolak bila bukan admin.
export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Akses ditolak. Perlu login admin.' });
}
