import db, { createJournal, updateJournal, getJournal } from './db.js';
import { scrapeSinta } from './scraper.js';

const DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
const filled = (v) => v !== null && v !== undefined && v !== '';

db.exec('CREATE TABLE IF NOT EXISTS scrape_state (key TEXT PRIMARY KEY, value TEXT);');
const getState = (k, d) => { const r = db.prepare('SELECT value FROM scrape_state WHERE key=?').get(k); return r ? r.value : d; };
const setState = (k, v) => db.prepare('INSERT OR REPLACE INTO scrape_state (key,value) VALUES (?,?)').run(k, String(v));

// Index ISSN/nama yang sudah ada untuk pencocokan cepat.
const issnIndex = new Map();
const nameIndex = new Map();
for (const r of db.prepare('SELECT id,name,issn,eissn FROM journals').all()) {
  for (const k of [norm(r.issn), norm(r.eissn)].filter((x) => x.length === 8)) issnIndex.set(k, r.id);
  nameIndex.set(r.name.trim().toLowerCase(), r.id);
}

function findExisting(item) {
  for (const k of [norm(item.issn), norm(item.eissn)].filter((x) => x.length === 8)) {
    if (issnIndex.has(k)) return issnIndex.get(k);
  }
  const nm = item.name.trim().toLowerCase();
  return nameIndex.has(nm) ? nameIndex.get(nm) : null;
}

function indexItem(id, item) {
  for (const k of [norm(item.issn), norm(item.eissn)].filter((x) => x.length === 8)) issnIndex.set(k, id);
  nameIndex.set(item.name.trim().toLowerCase(), id);
}

// Isi hanya field indeksasi yang kosong; jangan sentuh biaya/lama publish/catatan.
function mergeInto(current, item) {
  const out = { ...current };
  for (const f of ['publisher', 'issn', 'eissn', 'url', 'field', 'sinta_rank']) {
    if (!filled(out[f]) && filled(item[f])) out[f] = item[f];
  }
  if ((item.index_type || '').includes('Scopus') && !(out.index_type || '').includes('Scopus')) out.index_type = item.index_type;
  else if (!filled(out.index_type)) out.index_type = item.index_type;
  if (!filled(out.status)) out.status = item.status;
  return out;
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

async function run() {
  const maxPage = Number(process.env.MAX_PAGE || getState('max_page', 1678));
  let start = Number(getState('last_page', 0)) + 1;
  if (process.argv.includes('--restart')) start = 1;
  console.log(`Bulk scrape Sinta: halaman ${start}..${maxPage}`);

  let created = 0, updated = 0, pagesDone = 0, consecErr = 0;

  for (let p = start; p <= maxPage; p++) {
    let items;
    try { items = await scrapeWithRetry(p); consecErr = 0; }
    catch (e) {
      consecErr++;
      console.log(`\n  Halaman ${p} gagal: ${e.message}`);
      if (consecErr > 25) { console.log('Terlalu banyak error beruntun, berhenti. Jalankan ulang untuk melanjutkan.'); break; }
      continue;
    }

    if (!items.length) { console.log(`\nHalaman ${p} kosong — kemungkinan akhir daftar.`); setState('last_page', p); break; }

    for (const item of items) {
      if (!item.name) continue;
      const existingId = findExisting(item);
      if (existingId) {
        const cur = getJournal(existingId);
        if (cur) { updateJournal(existingId, mergeInto(cur, item)); updated++; indexItem(existingId, item); }
      } else {
        const j = createJournal(item);
        created++;
        indexItem(j.id, item);
      }
    }

    setState('last_page', p);
    pagesDone++;
    if (p % 20 === 0 || p === maxPage) {
      process.stdout.write(`\r  halaman ${p}/${maxPage} | baru: ${created} | diperbarui: ${updated} | total DB: ${db.prepare('SELECT COUNT(*) n FROM journals').get().n}   `);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nSelesai batch ini. Baru: ${created}, diperbarui: ${updated}, halaman diproses: ${pagesDone}.`);
  console.log('Total jurnal di DB:', db.prepare('SELECT COUNT(*) n FROM journals').get().n);
}

run().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
