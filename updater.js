import db, { getJournal, updateJournal } from './db.js';
import { scrapeSinta } from './scraper.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
const filled = (v) => v !== null && v !== undefined && v !== '';
const DELAY_MS = 400;
const MAX_PAGE = 1678;

let job = {
  running: false,
  page: 0,
  maxPage: MAX_PAGE,
  matched: 0,
  changes: { rank: 0, status: 0, field: 0 },
  startedAt: null,
  finishedAt: null,
  error: null,
  cancelRequested: false
};

export function getJobStatus() {
  const j = { ...job, changes: { ...job.changes } };
  if (job.startedAt) j.elapsedSec = Math.round(((job.finishedAt || Date.now()) - job.startedAt) / 1000);
  return j;
}

export function requestCancel() {
  if (job.running) { job.cancelRequested = true; return true; }
  return false;
}

export function startUpdate() {
  if (job.running) return false;
  job = {
    running: true, page: 0, maxPage: MAX_PAGE, matched: 0,
    changes: { rank: 0, status: 0, field: 0 },
    startedAt: Date.now(), finishedAt: null, error: null, cancelRequested: false
  };
  runLoop().catch((e) => { job.error = e.message; job.running = false; job.finishedAt = Date.now(); });
  return true;
}

async function scrapeWithRetry(page, retries = 3) {
  for (let a = 0; a <= retries; a++) {
    try { return await scrapeSinta({ page }); }
    catch (e) {
      if (a < retries && /HTTP 5\d\d|timeout/i.test(e.message)) { await sleep(1500 * (a + 1)); continue; }
      throw e;
    }
  }
}

async function runLoop() {
  // Index DB berdasarkan ISSN untuk pencocokan.
  const idx = new Map();
  for (const r of db.prepare('SELECT id,name,issn,eissn,index_type,sinta_rank,status,field FROM journals').all()) {
    for (const k of [norm(r.issn), norm(r.eissn)].filter((x) => x.length === 8)) if (!idx.has(k)) idx.set(k, r);
  }

  let consecErr = 0;
  for (let p = 1; p <= MAX_PAGE; p++) {
    if (job.cancelRequested) break;

    let items;
    try { items = await scrapeWithRetry(p); consecErr = 0; }
    catch (e) {
      consecErr++;
      if (consecErr > 25) { job.error = 'Terlalu banyak error beruntun dari Sinta. Dihentikan.'; break; }
      continue;
    }
    if (!items.length) break; // akhir daftar

    for (const it of items) {
      const keys = [norm(it.issn), norm(it.eissn)].filter((x) => x.length === 8);
      let rec = null; for (const k of keys) if (idx.has(k)) { rec = idx.get(k); break; }
      if (!rec) continue;
      job.matched++;

      const cur = getJournal(rec.id);
      if (!cur) continue;
      const patch = { ...cur };
      let changed = false;

      if (filled(it.sinta_rank) && it.sinta_rank !== cur.sinta_rank) { patch.sinta_rank = it.sinta_rank; job.changes.rank++; changed = true; }
      if (filled(it.status) && it.status !== cur.status) { patch.status = it.status; job.changes.status++; changed = true; }
      if (filled(it.field) && it.field !== cur.field) { patch.field = it.field; job.changes.field++; changed = true; }

      // Indeks: tambahkan Scopus bila Sinta menandai, JANGAN turunkan (hormati SCImago).
      const hasScopus = (cur.index_type || '').includes('Scopus') || (it.index_type || '').includes('Scopus');
      const newIndex = hasScopus ? 'Sinta & Scopus' : 'Sinta';
      if (!(cur.index_type || '').includes('DOAJ') && newIndex !== cur.index_type) { patch.index_type = newIndex; changed = true; }

      if (changed) { updateJournal(rec.id, patch); idx.set(keys[0], patch); }
    }

    job.page = p;
    await sleep(DELAY_MS);
  }

  job.running = false;
  job.finishedAt = Date.now();
}
