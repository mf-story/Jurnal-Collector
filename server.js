import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  listJournals, pageJournals, getJournal, createJournal, updateJournal,
  deleteJournal, upsertByName, stats, listFields,
  createSubmission, listSubmissions, getSubmission, setSubmissionStatus, countPendingSubmissions,
  addRating, getRatingSummary, listRatings,
  recordVisit, visitorStats
} from './db.js';
import crypto from 'node:crypto';
import {
  ensureAdminPassword, verifyPassword, setAdminPassword, isAdmin,
  setAuthCookie, clearAuthCookie, requireAdmin
} from './auth.js';
import { scrapeSinta, scrapeScopus } from './scraper.js';
import { startUpdate, getJobStatus, requestCancel } from './updater.js';
import { runMigrations } from './migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

ensureAdminPassword();
runMigrations();

app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/csv', limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

// ---- Autentikasi admin ----
app.get('/api/auth/status', (req, res) => {
  res.json({ admin: isAdmin(req), pending: isAdmin(req) ? countPendingSubmissions() : undefined });
});

app.post('/api/auth/login', (req, res) => {
  if (!verifyPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Kata sandi salah' });
  }
  setAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAdmin, (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(current)) return res.status(401).json({ error: 'Kata sandi lama salah' });
  if (!next || String(next).length < 4) return res.status(400).json({ error: 'Kata sandi baru minimal 4 karakter' });
  setAdminPassword(next);
  res.json({ ok: true });
});

// ---- Statistik ----
app.get('/api/stats', (req, res) => {
  res.json(stats());
});

// ---- Pengunjung ----
// Catat kunjungan (dipanggil sekali per muat halaman) & kembalikan ringkasan.
app.post('/api/visit', (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const ua = req.headers['user-agent'] || '';
    const hash = crypto.createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 32);
    recordVisit(hash);
  } catch { /* abaikan kegagalan pencatatan */ }
  res.json(visitorStats());
});

app.get('/api/visit', (req, res) => {
  res.json(visitorStats());
});

// ---- Daftar bidang (untuk filter) ----
app.get('/api/fields', (req, res) => {
  res.json(listFields());
});

// ---- Daftar & filter (paginasi sisi server) ----
app.get('/api/journals', (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 100);
  res.json(pageJournals(req.query, page, pageSize));
});

app.get('/api/journals/:id', (req, res) => {
  const j = getJournal(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'Jurnal tidak ditemukan' });
  const rating = getRatingSummary(j.id);
  res.json({ ...j, rating_avg: rating.avg, rating_count: rating.count });
});

// ---- Rating komunitas (publik, rate-limited) ----
const rateLimitMap = new Map();
function ratingRateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const WINDOW = 10 * 60 * 1000, MAX = 20;
  const hits = (rateLimitMap.get(ip) || []).filter((t) => now - t < WINDOW);
  if (hits.length >= MAX) return res.status(429).json({ error: 'Terlalu banyak penilaian. Coba lagi nanti.' });
  hits.push(now); rateLimitMap.set(ip, hits); next();
}

app.get('/api/journals/:id/ratings', (req, res) => {
  const id = Number(req.params.id);
  res.json({ summary: getRatingSummary(id), ratings: listRatings(id) });
});

app.post('/api/journals/:id/ratings', ratingRateLimit, (req, res) => {
  const id = Number(req.params.id);
  const j = getJournal(id);
  if (!j) return res.status(404).json({ error: 'Jurnal tidak ditemukan' });
  const stars = Number(req.body?.stars);
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Bintang harus 1–5' });
  addRating(id, stars, req.body?.review, req.body?.submitter);
  res.status(201).json({ ok: true, summary: getRatingSummary(id) });
});

app.post('/api/journals', requireAdmin, (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ error: 'Nama jurnal wajib diisi' });
    res.status(201).json(createJournal(req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/journals/:id', requireAdmin, (req, res) => {
  try {
    const j = getJournal(Number(req.params.id));
    if (!j) return res.status(404).json({ error: 'Jurnal tidak ditemukan' });
    res.json(updateJournal(Number(req.params.id), req.body));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/journals/:id', requireAdmin, (req, res) => {
  deleteJournal(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Usulan pengunjung (submissions) ----
// Rate limit sederhana per-IP: maks 10 usulan / 10 menit.
const subRate = new Map();
const SUB_WINDOW_MS = 10 * 60 * 1000;
const SUB_MAX = 10;
function submissionRateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const hits = (subRate.get(ip) || []).filter((t) => now - t < SUB_WINDOW_MS);
  if (hits.length >= SUB_MAX) {
    const retryMin = Math.ceil((SUB_WINDOW_MS - (now - hits[0])) / 60000);
    return res.status(429).json({ error: `Terlalu banyak usulan. Coba lagi dalam ~${retryMin} menit.` });
  }
  hits.push(now);
  subRate.set(ip, hits);
  next();
}

// Publik: siapa pun boleh mengajukan edit atau jurnal baru.
app.post('/api/submissions', submissionRateLimit, (req, res) => {
  try {
    const { kind, journal_id, data, note, submitter } = req.body || {};
    if (kind !== 'edit' && kind !== 'new') return res.status(400).json({ error: 'Jenis usulan tidak valid' });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Data usulan kosong' });
    if (kind === 'new' && !data.name) return res.status(400).json({ error: 'Nama jurnal wajib diisi' });

    let journal_name = data.name || null;
    if (kind === 'edit') {
      const j = getJournal(Number(journal_id));
      if (!j) return res.status(404).json({ error: 'Jurnal yang diajukan tidak ditemukan' });
      journal_name = j.name;
    }
    const s = createSubmission({ kind, journal_id: journal_id ?? null, journal_name, data, note, submitter });
    res.status(201).json({ ok: true, id: s.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: tinjau & kelola usulan.
app.get('/api/submissions', requireAdmin, (req, res) => {
  res.json(listSubmissions(req.query.status || 'pending'));
});

app.post('/api/submissions/:id/approve', requireAdmin, (req, res) => {
  const s = getSubmission(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Usulan tidak ditemukan' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'Usulan sudah diproses' });
  try {
    if (s.kind === 'new') {
      createJournal({ ...s.data, source: 'submission' });
    } else {
      const j = getJournal(s.journal_id);
      if (!j) return res.status(404).json({ error: 'Jurnal sudah tidak ada' });
      updateJournal(s.journal_id, { ...j, ...s.data });
    }
    setSubmissionStatus(s.id, 'approved');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/submissions/:id/reject', requireAdmin, (req, res) => {
  const s = getSubmission(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Usulan tidak ditemukan' });
  setSubmissionStatus(s.id, 'rejected');
  res.json({ ok: true });
});

// ---- Perbarui data massal dari Sinta (admin, berjalan di latar belakang) ----
app.post('/api/update-data', requireAdmin, (req, res) => {
  const started = startUpdate();
  if (!started) return res.status(409).json({ error: 'Pembaruan sedang berjalan.', status: getJobStatus() });
  res.status(202).json({ ok: true, status: getJobStatus() });
});

app.get('/api/update-data/status', requireAdmin, (req, res) => {
  res.json(getJobStatus());
});

app.post('/api/update-data/cancel', requireAdmin, (req, res) => {
  const ok = requestCancel();
  res.json({ ok });
});

// ---- Scraping ----
app.post('/api/scrape/sinta', requireAdmin, async (req, res) => {
  const { pages = 1, q = '' } = req.body || {};
  const totalPages = Math.min(Math.max(Number(pages) || 1, 1), 10);
  try {
    let created = 0, updated = 0, found = 0;
    for (let p = 1; p <= totalPages; p++) {
      const items = await scrapeSinta({ page: p, q });
      found += items.length;
      for (const it of items) {
        const { created: isNew } = upsertByName(it);
        isNew ? created++ : updated++;
      }
    }
    res.json({ ok: true, found, created, updated });
  } catch (e) {
    res.status(502).json({ error: 'Gagal scraping Sinta: ' + e.message });
  }
});

app.post('/api/scrape/scopus', requireAdmin, async (req, res) => {
  try {
    await scrapeScopus();
    res.json({ ok: true });
  } catch (e) {
    res.status(501).json({ error: e.message });
  }
});

// ---- Impor CSV ----
app.post('/api/import/csv', requireAdmin, (req, res) => {
  try {
    const text = typeof req.body === 'string' ? req.body : req.body.csv;
    if (!text) return res.status(400).json({ error: 'Data CSV kosong' });
    const rows = parseCsv(text);
    let created = 0, updated = 0;
    for (const row of rows) {
      if (!row.name) continue;
      if (row.is_free !== undefined) row.is_free = /^(1|true|ya|yes|gratis)$/i.test(String(row.is_free)) ? 1 : 0;
      if (row.apc_cost) row.apc_cost = Number(String(row.apc_cost).replace(/[^\d.]/g, '')) || null;
      if (row.publish_weeks) row.publish_weeks = Number(row.publish_weeks) || null;
      row.source = 'import';
      const { created: isNew } = upsertByName(row);
      isNew ? created++ : updated++;
    }
    res.json({ ok: true, created, updated, total: rows.length });
  } catch (e) {
    res.status(400).json({ error: 'Gagal impor CSV: ' + e.message });
  }
});

// ---- Ekspor CSV (hanya admin) ----
app.get('/api/export/csv', requireAdmin, (req, res) => {
  const rows = listJournals(req.query);
  const cols = ['name', 'publisher', 'issn', 'eissn', 'url', 'field', 'index_type',
    'sinta_rank', 'scopus_quartile', 'status', 'apc_cost', 'currency', 'is_free',
    'publish_weeks', 'acceptance_rate', 'notes', 'source', 'scope'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.join(',')]
    .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="jurnal.csv"');
  res.send(csv);
});

// Parser CSV sederhana yang menangani kutip ganda dan koma dalam nilai.
function parseCsv(text) {
  const lines = [];
  let field = '', row = [], inQuotes = false;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); lines.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); lines.push(row); }
  if (!lines.length) return [];
  const header = lines.shift().map((h) => h.trim());
  return lines
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
      return obj;
    });
}

app.listen(PORT, () => {
  console.log(`Jurnal Collector berjalan di http://localhost:${PORT}`);
});
