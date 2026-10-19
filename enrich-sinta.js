import db, { updateJournal } from './db.js';
import { searchSinta } from './scraper.js';

const DELAY_MS = 500;
const MAX_CONSECUTIVE_ERRORS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const issnDigits = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();

// Cari di Sinta dengan retry untuk error transien (HTTP 500 / timeout).
async function searchWithRetry(q, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await searchSinta(q);
    } catch (e) {
      const transient = /HTTP 5\d\d|timeout/i.test(e.message);
      if (transient && attempt < retries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  return null;
}

// Cocokkan hasil Sinta dengan jurnal lokal berdasarkan ISSN/eISSN; fallback nama.
function pickMatch(items, journal) {
  const localIssns = [issnDigits(journal.issn), issnDigits(journal.eissn)].filter(Boolean);
  for (const it of items) {
    const itIssns = [issnDigits(it.issn), issnDigits(it.eissn)].filter(Boolean);
    if (localIssns.some((x) => itIssns.includes(x))) return it;
  }
  // fallback: nama sama PERSIS (case-insensitive). Tidak mengambil hasil sembarang
  // untuk mencegah salah cocok pada nama generik.
  const lname = journal.name.trim().toLowerCase();
  const byName = items.find((it) => it.name.trim().toLowerCase() === lname);
  if (byName) return byName;
  return null;
}

async function enrichOne(journal) {
  const queries = [];
  if (journal.issn) queries.push(issnDigits(journal.issn));
  if (journal.eissn) queries.push(issnDigits(journal.eissn));
  // Hanya cari via nama bila jurnal tidak punya ISSN sama sekali.
  if (!journal.issn && !journal.eissn) queries.push(journal.name);

  for (const q of queries) {
    const items = await searchWithRetry(q);
    if (items && items.length) {
      const m = pickMatch(items, journal);
      if (m) return m;
    }
    await sleep(DELAY_MS);
  }
  return null;
}

async function run() {
  const targets = db.prepare(
    "SELECT * FROM journals WHERE index_type IS NULL OR index_type = '' ORDER BY id"
  ).all();
  console.log(`Jurnal tanpa indeks: ${targets.length}. Mulai mencari di Sinta...`);

  let matched = 0, scopus = 0, notFound = 0, errors = 0, consecutive = 0;

  for (let i = 0; i < targets.length; i++) {
    const j = targets[i];
    try {
      const m = await enrichOne(j);
      consecutive = 0;
      if (m) {
        const patch = {
          ...j,
          index_type: m.index_type,
          sinta_rank: m.sinta_rank || j.sinta_rank,
          status: 'Terindeks',
          publisher: j.publisher || m.publisher,
          field: j.field || m.field,
          url: j.url || m.url,
          issn: j.issn || m.issn,
          eissn: j.eissn || m.eissn
        };
        updateJournal(j.id, patch);
        matched++;
        if (m.index_type.includes('Scopus')) scopus++;
      } else {
        notFound++;
      }
    } catch (e) {
      errors++;
      consecutive++;
      if (errors <= 3) console.log(`\n  Error pada "${j.name}": ${e.message}`);
      if (consecutive > MAX_CONSECUTIVE_ERRORS) { console.log('\nTerlalu banyak error beruntun, berhenti (mungkin diblokir). Jalankan ulang untuk melanjutkan.'); break; }
    }
    if ((i + 1) % 10 === 0 || i === targets.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${targets.length} diproses | cocok: ${matched} (Scopus: ${scopus}) | tidak ketemu: ${notFound} | error: ${errors}   `);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nSelesai. Dicocokkan: ${matched} (termasuk Scopus: ${scopus}), tidak ditemukan: ${notFound}, error: ${errors}.`);
}

run().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
