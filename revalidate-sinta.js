import db from './db.js';
import { scrapeSinta } from './scraper.js';

const DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
const filled = (v) => v !== null && v !== undefined && v !== '';

db.exec('CREATE TABLE IF NOT EXISTS scrape_state (key TEXT PRIMARY KEY, value TEXT);');
const getState = (k, d) => { const r = db.prepare('SELECT value FROM scrape_state WHERE key=?').get(k); return r ? r.value : d; };
const setState = (k, v) => db.prepare('INSERT OR REPLACE INTO scrape_state (key,value) VALUES (?,?)').run(k, String(v));

// Index DB by ISSN untuk pencocokan.
const idx = new Map();
for (const r of db.prepare('SELECT id,name,issn,eissn,index_type,sinta_rank,status,field FROM journals').all()) {
  for (const k of [norm(r.issn), norm(r.eissn)].filter((x) => x.length === 8)) if (!idx.has(k)) idx.set(k, r);
}

const updRank = db.prepare("UPDATE journals SET sinta_rank=?, updated_at=datetime('now') WHERE id=?");
const updStatus = db.prepare("UPDATE journals SET status=?, updated_at=datetime('now') WHERE id=?");
const updField = db.prepare("UPDATE journals SET field=?, updated_at=datetime('now') WHERE id=?");
const updIndex = db.prepare("UPDATE journals SET index_type=?, updated_at=datetime('now') WHERE id=?");

const MAX_PAGE = Number(process.env.MAX_PAGE || 1678);

async function scrapeWithRetry(page, retries = 3) {
  for (let a = 0; a <= retries; a++) {
    try { return await scrapeSinta({ page }); }
    catch (e) { if (a < retries && /HTTP 5\d\d|timeout/i.test(e.message)) { await sleep(1500 * (a + 1)); continue; } throw e; }
  }
}

async function run() {
  let start = Number(getState('reval_page', 0)) + 1;
  if (process.argv.includes('--restart')) start = 1;
  console.log(`Validasi ulang Sinta: halaman ${start}..${MAX_PAGE}`);

  let rankCh = 0, statusCh = 0, fieldCh = 0, scopusAdd = 0, pages = 0, consecErr = 0;
  const rankLog = [];

  for (let p = start; p <= MAX_PAGE; p++) {
    let items;
    try { items = await scrapeWithRetry(p); consecErr = 0; }
    catch (e) { consecErr++; if (consecErr > 25) { console.log('\nTerlalu banyak error beruntun, berhenti. Jalankan ulang untuk melanjutkan.'); break; } continue; }
    if (!items.length) { setState('reval_page', p); break; }

    for (const it of items) {
      const keys = [norm(it.issn), norm(it.eissn)].filter((x) => x.length === 8);
      let rec = null; for (const k of keys) if (idx.has(k)) { rec = idx.get(k); break; }
      if (!rec) continue;

      // Peringkat Sinta — perbarui bila berbeda
      if (filled(it.sinta_rank) && it.sinta_rank !== rec.sinta_rank) {
        if (rankLog.length < 40) rankLog.push(`${rec.name.slice(0, 38)}: ${rec.sinta_rank || '—'} -> ${it.sinta_rank}`);
        updRank.run(it.sinta_rank, rec.id); rec.sinta_rank = it.sinta_rank; rankCh++;
      }
      // Status
      if (filled(it.status) && it.status !== rec.status) { updStatus.run(it.status, rec.id); rec.status = it.status; statusCh++; }
      // Bidang — perbarui bila Sinta punya nilai berbeda
      if (filled(it.field) && it.field !== rec.field) { updField.run(it.field, rec.id); rec.field = it.field; fieldCh++; }
      // Indeks — tambah Scopus bila Sinta menandai, JANGAN turunkan (SCImago tetap dihormati)
      const hasScopus = (rec.index_type || '').includes('Scopus') || (it.index_type || '').includes('Scopus');
      const newIndex = hasScopus ? 'Sinta & Scopus' : 'Sinta';
      if (newIndex !== rec.index_type && !(rec.index_type || '').includes('DOAJ')) {
        if (newIndex.includes('Scopus') && !(rec.index_type || '').includes('Scopus')) scopusAdd++;
        updIndex.run(newIndex, rec.id); rec.index_type = newIndex;
      }
    }

    setState('reval_page', p);
    pages++;
    if (p % 20 === 0 || p === MAX_PAGE) {
      process.stdout.write(`\r  hal ${p}/${MAX_PAGE} | rank: ${rankCh} | status: ${statusCh} | bidang: ${fieldCh} | +scopus: ${scopusAdd}   `);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nSelesai batch. Perubahan -> peringkat: ${rankCh}, status: ${statusCh}, bidang: ${fieldCh}, +Scopus(dari Sinta): ${scopusAdd}`);
  if (rankLog.length) { console.log('Contoh perubahan peringkat:'); rankLog.forEach((l) => console.log('  ' + l)); }
}

run().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
