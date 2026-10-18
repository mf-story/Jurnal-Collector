import db, { createJournal, updateJournal, getJournal } from './db.js';
import { fetchJournal, sleep } from './scraper-topjurnal.js';

const MAX_ID = Number(process.env.MAX_ID || 1435);
const DELAY_MS = 150;
const norm = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
const filled = (v) => v !== null && v !== undefined && v !== '';

db.exec('CREATE TABLE IF NOT EXISTS scrape_state (key TEXT PRIMARY KEY, value TEXT);');
const getState = (k, d) => { const r = db.prepare('SELECT value FROM scrape_state WHERE key=?').get(k); return r ? r.value : d; };
const setState = (k, v) => db.prepare('INSERT OR REPLACE INTO scrape_state (key,value) VALUES (?,?)').run(k, String(v));

// Index DB saat ini untuk dedup.
const issnIndex = new Map();
const nameIndex = new Map();
for (const r of db.prepare('SELECT id,name,issn,eissn FROM journals').all()) {
  for (const k of [norm(r.issn), norm(r.eissn)].filter((x) => x.length === 8)) issnIndex.set(k, r.id);
  nameIndex.set(r.name.trim().toLowerCase(), r.id);
}
function findExisting(j) {
  for (const k of [norm(j.issn), norm(j.eissn)].filter((x) => x.length === 8)) if (issnIndex.has(k)) return issnIndex.get(k);
  const nm = j.name.trim().toLowerCase();
  return nameIndex.has(nm) ? nameIndex.get(nm) : null;
}
function indexItem(id, j) {
  for (const k of [norm(j.issn), norm(j.eissn)].filter((x) => x.length === 8)) issnIndex.set(k, id);
  nameIndex.set(j.name.trim().toLowerCase(), id);
}

async function run() {
  let start = Number(getState('topjurnal_id', 0)) + 1;
  if (process.argv.includes('--restart')) start = 1;
  console.log(`Impor Top Jurnal Finder: id ${start}..${MAX_ID}`);

  let created = 0, updated = 0, empty = 0, errors = 0, consecEmpty = 0;

  for (let id = start; id <= MAX_ID; id++) {
    let j;
    try { j = await fetchJournal(id); }
    catch (e) { errors++; setState('topjurnal_id', id); await sleep(DELAY_MS); continue; }

    if (!j || !j.name) {
      empty++; consecEmpty++;
      setState('topjurnal_id', id);
      if (consecEmpty > 40) { console.log(`\nBanyak ID kosong beruntun di ${id} — kemungkinan akhir data.`); break; }
      continue;
    }
    consecEmpty = 0;

    const existingId = findExisting(j);
    if (existingId) {
      // Jurnal sudah ada (mis. sudah terdaftar) — lengkapi field kosong + tandai punya data internasional.
      const cur = getJournal(existingId);
      if (cur) {
        const patch = { ...cur };
        for (const f of ['apc_cost', 'currency', 'acceptance_rate', 'publish_weeks', 'scopus_quartile', 'publisher', 'url', 'field']) {
          if (!filled(patch[f]) && filled(j[f])) patch[f] = j[f];
        }
        if (!(patch.index_type || '').includes('Scopus')) patch.index_type = (patch.index_type ? patch.index_type + ' & Scopus' : 'Scopus');
        updateJournal(existingId, patch);
        updated++;
      }
    } else {
      const nj = createJournal(j);
      indexItem(nj.id, j);
      created++;
    }

    setState('topjurnal_id', id);
    if (id % 50 === 0) process.stdout.write(`\r  id ${id}/${MAX_ID} | baru: ${created} | diperbarui: ${updated} | kosong: ${empty} | error: ${errors}   `);
    await sleep(DELAY_MS);
  }

  console.log(`\nSelesai. Baru: ${created}, diperbarui: ${updated}, kosong: ${empty}, error: ${errors}`);
  console.log('Total jurnal DB:', db.prepare('SELECT COUNT(*) n FROM journals').get().n);
  console.log('Jurnal internasional:', db.prepare("SELECT COUNT(*) n FROM journals WHERE scope='Internasional'").get().n);
}

run().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
