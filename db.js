import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'jurnal.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS journals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    publisher       TEXT,
    issn            TEXT,
    eissn           TEXT,
    url             TEXT,
    field           TEXT,              -- bidang ilmu
    index_type      TEXT,              -- 'Sinta', 'Scopus', 'Sinta & Scopus'
    sinta_rank      TEXT,              -- S1..S6
    scopus_quartile TEXT,              -- Q1..Q4
    status          TEXT DEFAULT 'Aktif', -- Aktif / Discontinued / Suspended / Terindeks
    apc_cost        REAL,              -- biaya publikasi
    currency        TEXT DEFAULT 'IDR',
    is_free         INTEGER DEFAULT 0, -- 1 = gratis
    publish_weeks   INTEGER,           -- estimasi lama publish (minggu)
    acceptance_rate REAL,              -- persen
    notes           TEXT,
    source          TEXT DEFAULT 'manual', -- manual / scraped / import
    scope           TEXT DEFAULT 'Nasional', -- Nasional / Internasional
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );
`);

// Migrasi: tambahkan kolom scope bila belum ada (database lama).
try {
  const cols = db.prepare("PRAGMA table_info(journals)").all().map((c) => c.name);
  if (!cols.includes('scope')) {
    db.exec("ALTER TABLE journals ADD COLUMN scope TEXT DEFAULT 'Nasional'");
    db.exec("UPDATE journals SET scope = 'Nasional' WHERE scope IS NULL");
  }
} catch { /* abaikan */ }

// Hindari duplikat saat scraping/import berdasarkan nama + issn
db.exec(`CREATE INDEX IF NOT EXISTS idx_journals_name ON journals(name);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_journals_name_nocase ON journals(name COLLATE NOCASE);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_journals_scope ON journals(scope);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_journals_index_type ON journals(index_type);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_journals_sinta_rank ON journals(sinta_rank);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_journals_quartile ON journals(scopus_quartile);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_journals_issn ON journals(issn);`);

// Konfigurasi aplikasi (kredensial admin, secret sesi) — key/value.
db.exec(`
  CREATE TABLE IF NOT EXISTS app_config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Usulan dari pengunjung (edit jurnal / jurnal baru) menunggu persetujuan admin.
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,              -- 'edit' | 'new'
    journal_id    INTEGER,                    -- untuk 'edit'
    journal_name  TEXT,                       -- snapshot nama untuk tampilan
    data          TEXT NOT NULL,              -- JSON field yang diusulkan
    note          TEXT,                       -- alasan/catatan pengusul
    submitter     TEXT,                       -- nama/email opsional
    status        TEXT DEFAULT 'pending',     -- pending | approved | rejected
    created_at    TEXT DEFAULT (datetime('now')),
    reviewed_at   TEXT
  );
`);

// Rating komunitas dari pengunjung (1-5 bintang + ulasan opsional).
db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_id  INTEGER NOT NULL,
    stars       INTEGER NOT NULL,          -- 1..5
    review      TEXT,
    submitter   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_ratings_journal ON ratings(journal_id);');

export function addRating(journalId, stars, review, submitter) {
  const s = Math.max(1, Math.min(5, Math.round(Number(stars) || 0)));
  const info = db.prepare(
    'INSERT INTO ratings (journal_id, stars, review, submitter) VALUES (?, ?, ?, ?)'
  ).run(journalId, s, review || null, submitter || null);
  return info.lastInsertRowid;
}

export function getRatingSummary(journalId) {
  const r = db.prepare('SELECT ROUND(AVG(stars),1) avg, COUNT(*) n FROM ratings WHERE journal_id = ?').get(journalId);
  return { avg: r.avg || 0, count: r.n || 0 };
}

export function listRatings(journalId, limit = 20) {
  return db.prepare('SELECT stars, review, submitter, created_at FROM ratings WHERE journal_id = ? ORDER BY created_at DESC LIMIT ?').all(journalId, limit);
}

export function getConfig(key) {
  const r = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return r ? r.value : null;
}
export function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(key, String(value));
}

export function createSubmission(s) {
  const info = db.prepare(
    `INSERT INTO submissions (kind, journal_id, journal_name, data, note, submitter)
     VALUES ($kind, $journal_id, $journal_name, $data, $note, $submitter)`
  ).run({
    $kind: s.kind,
    $journal_id: s.journal_id ?? null,
    $journal_name: s.journal_name ?? null,
    $data: JSON.stringify(s.data || {}),
    $note: s.note ?? null,
    $submitter: s.submitter ?? null
  });
  return db.prepare('SELECT * FROM submissions WHERE id = ?').get(info.lastInsertRowid);
}

export function listSubmissions(status = 'pending') {
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM submissions ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC').all(status);
  return rows.map((r) => ({ ...r, data: safeParse(r.data) }));
}

export function getSubmission(id) {
  const r = db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, data: safeParse(r.data) };
}

export function setSubmissionStatus(id, status) {
  db.prepare("UPDATE submissions SET status = ?, reviewed_at = datetime('now') WHERE id = ?").run(status, id);
  return getSubmission(id);
}

export function countPendingSubmissions() {
  return db.prepare("SELECT COUNT(*) n FROM submissions WHERE status = 'pending'").get().n;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

const COLUMNS = [
  'name', 'publisher', 'issn', 'eissn', 'url', 'field', 'index_type',
  'sinta_rank', 'scopus_quartile', 'status', 'apc_cost', 'currency',
  'is_free', 'publish_weeks', 'acceptance_rate', 'notes', 'source', 'scope'
];

function pick(data) {
  const out = {};
  for (const c of COLUMNS) {
    if (data[c] !== undefined && data[c] !== '') out[c] = data[c];
    else out[c] = null;
  }
  return out;
}

function buildQuery(filters = {}) {
  const where = [];
  const params = {};

  if (filters.q) {
    where.push('(name LIKE $q OR publisher LIKE $q OR field LIKE $q OR issn LIKE $q OR eissn LIKE $q)');
    params.$q = `%${filters.q}%`;
  }
  if (filters.index_type) { where.push('index_type LIKE $index_type'); params.$index_type = `%${filters.index_type}%`; }
  if (filters.sinta_rank) { where.push('sinta_rank = $sinta_rank'); params.$sinta_rank = filters.sinta_rank; }
  if (filters.scopus_quartile) { where.push('scopus_quartile = $scopus_quartile'); params.$scopus_quartile = filters.scopus_quartile; }
  if (filters.status) { where.push('status = $status'); params.$status = filters.status; }
  if (filters.is_free === 'true') { where.push('is_free = 1'); }
  if (filters.field) { where.push('field LIKE $field'); params.$field = `%${filters.field}%`; }
  if (filters.scope) { where.push('scope = $scope'); params.$scope = filters.scope; }

  // Skor kualitas (x10) — selaras dengan perhitungan bintang di frontend.
  const QUALITY = `(CASE
    WHEN scopus_quartile IN ('Q1','Q2','Q3','Q4') OR sinta_rank IN ('S1','S2','S3','S4','S5','S6')
    THEN MAX(
      CASE scopus_quartile WHEN 'Q1' THEN 50 WHEN 'Q2' THEN 40 WHEN 'Q3' THEN 30 WHEN 'Q4' THEN 20 ELSE 0 END,
      CASE sinta_rank WHEN 'S1' THEN 45 WHEN 'S2' THEN 40 WHEN 'S3' THEN 35 WHEN 'S4' THEN 25 WHEN 'S5' THEN 20 WHEN 'S6' THEN 15 ELSE 0 END)
    WHEN index_type LIKE '%Scopus%' THEN 30
    WHEN index_type LIKE '%DOAJ%' THEN 15
    ELSE 10 END)`;
  const COMMUNITY = '(SELECT AVG(stars) FROM ratings WHERE ratings.journal_id = journals.id)';

  const sortMap = {
    name: 'name COLLATE NOCASE ASC',
    apc_asc: 'apc_cost IS NULL, apc_cost ASC',
    apc_desc: 'apc_cost DESC',
    publish_asc: 'publish_weeks IS NULL, publish_weeks ASC',
    newest: 'created_at DESC',
    rating_desc: `${QUALITY} DESC, name COLLATE NOCASE ASC`,
    rating_asc: `${QUALITY} ASC, name COLLATE NOCASE ASC`,
    community_desc: `${COMMUNITY} IS NULL, ${COMMUNITY} DESC, name COLLATE NOCASE ASC`
  };
  const order = sortMap[filters.sort] || 'name COLLATE NOCASE ASC';
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return { clause, params, order };
}

export function listJournals(filters = {}) {
  const { clause, params, order } = buildQuery(filters);
  return db.prepare(`SELECT * FROM journals ${clause} ORDER BY ${order}`).all(params);
}

export function pageJournals(filters = {}, page = 1, pageSize = 25) {
  const { clause, params, order } = buildQuery(filters);
  const total = db.prepare(`SELECT COUNT(*) n FROM journals ${clause}`).get(params).n;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const offset = (current - 1) * pageSize;
  const items = db.prepare(`SELECT * FROM journals ${clause} ORDER BY ${order} LIMIT $limit OFFSET $offset`)
    .all({ ...params, $limit: pageSize, $offset: offset });
  // Lampirkan ringkasan rating komunitas per jurnal pada halaman ini.
  if (items.length) {
    const ids = items.map((j) => j.id);
    const ph = ids.map(() => '?').join(',');
    const rr = db.prepare(`SELECT journal_id, ROUND(AVG(stars),1) avg, COUNT(*) n FROM ratings WHERE journal_id IN (${ph}) GROUP BY journal_id`).all(...ids);
    const map = new Map(rr.map((r) => [r.journal_id, r]));
    for (const j of items) {
      const r = map.get(j.id);
      j.rating_avg = r ? r.avg : 0;
      j.rating_count = r ? r.n : 0;
    }
  }
  return { items, total, page: current, pageSize, totalPages };
}

export function getJournal(id) {
  return db.prepare('SELECT * FROM journals WHERE id = ?').get(id);
}

export function createJournal(data) {
  const row = pick(data);
  const cols = COLUMNS.join(', ');
  const placeholders = COLUMNS.map((c) => '$' + c).join(', ');
  const params = {};
  for (const c of COLUMNS) params['$' + c] = row[c];
  const info = db.prepare(`INSERT INTO journals (${cols}) VALUES (${placeholders})`).run(params);
  return getJournal(info.lastInsertRowid);
}

export function updateJournal(id, data) {
  const row = pick(data);
  const sets = COLUMNS.map((c) => `${c} = $${c}`).join(', ');
  const params = { $id: id };
  for (const c of COLUMNS) params['$' + c] = row[c];
  db.prepare(`UPDATE journals SET ${sets}, updated_at = datetime('now') WHERE id = $id`).run(params);
  return getJournal(id);
}

export function deleteJournal(id) {
  db.prepare('DELETE FROM journals WHERE id = ?').run(id);
}

// Upsert sederhana untuk scraping/import: cocokkan berdasarkan nama (case-insensitive)
export function upsertByName(data) {
  const existing = db.prepare('SELECT id FROM journals WHERE name = ? COLLATE NOCASE').get(data.name);
  if (existing) {
    // Hanya isi field indeksasi yang kosong agar tidak menimpa input manual (biaya/lama publish)
    const current = getJournal(existing.id);
    const merged = { ...current };
    for (const key of ['publisher', 'issn', 'eissn', 'url', 'field', 'index_type', 'sinta_rank', 'scopus_quartile', 'status']) {
      if (data[key] !== undefined && data[key] !== null && data[key] !== '') merged[key] = data[key];
    }
    return { journal: updateJournal(existing.id, merged), created: false };
  }
  return { journal: createJournal(data), created: true };
}

export function listFields() {
  const rows = db.prepare("SELECT field FROM journals WHERE field IS NOT NULL AND field <> ''").all();
  const counts = new Map();
  for (const r of rows) {
    for (const tok of r.field.split(',').map((s) => s.trim()).filter(Boolean)) {
      counts.set(tok, (counts.get(tok) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
}

export function stats() {
  const total = db.prepare('SELECT COUNT(*) n FROM journals').get().n;
  const sinta = db.prepare("SELECT COUNT(*) n FROM journals WHERE index_type LIKE '%Sinta%'").get().n;
  const scopus = db.prepare("SELECT COUNT(*) n FROM journals WHERE index_type LIKE '%Scopus%'").get().n;
  const free = db.prepare('SELECT COUNT(*) n FROM journals WHERE is_free = 1').get().n;

  const rankDist = {};
  for (const r of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) {
    rankDist[r] = db.prepare('SELECT COUNT(*) n FROM journals WHERE sinta_rank = ?').get(r).n;
  }
  const quartileDist = {};
  for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
    quartileDist[q] = db.prepare('SELECT COUNT(*) n FROM journals WHERE scopus_quartile = ?').get(q).n;
  }
  const scopeDist = {
    Nasional: db.prepare("SELECT COUNT(*) n FROM journals WHERE scope = 'Nasional' OR scope IS NULL").get().n,
    Internasional: db.prepare("SELECT COUNT(*) n FROM journals WHERE scope = 'Internasional'").get().n
  };
  return { total, sinta, scopus, free, rankDist, quartileDist, scopeDist };
}

export default db;
