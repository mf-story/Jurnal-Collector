import { upsertByName, stats } from './db.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGE_SIZE = 100;

function mapJournal(result) {
  const b = result.bibjson || {};
  const apc = b.apc || {};
  const hasApc = apc.has_apc === true && Array.isArray(apc.max) && apc.max.length > 0;

  let apc_cost = null, currency = null, is_free = 0;
  if (apc.has_apc === false) {
    is_free = 1; apc_cost = 0; currency = 'IDR';
  } else if (hasApc) {
    apc_cost = apc.max[0].price ?? null;
    currency = apc.max[0].currency || 'IDR';
  }

  const url = b.ref?.journal || null;
  const field = Array.isArray(b.subject) && b.subject.length ? b.subject[0].term : null;

  return {
    name: (b.title || '').trim(),
    publisher: b.publisher?.name || null,
    issn: b.pissn || null,
    eissn: b.eissn || null,
    url,
    field,
    index_type: null,            // DOAJ tidak menyediakan status Sinta/Scopus
    status: 'Aktif',
    apc_cost,
    currency,
    is_free,
    publish_weeks: null,         // tidak tersedia -> dikosongkan
    notes: 'Sumber: DOAJ (open access)',
    source: 'import'
  };
}

async function fetchPage(page) {
  const url = `https://doaj.org/api/search/journals/${encodeURIComponent('Indonesia')}?pageSize=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`DOAJ HTTP ${res.status} (page ${page})`);
  return res.json();
}

async function run() {
  const first = await fetchPage(1);
  const total = first.total;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(`DOAJ: ${total} jurnal Indonesia dalam ${totalPages} halaman.`);

  let created = 0, updated = 0, skipped = 0;

  const handle = (results) => {
    for (const r of results) {
      const j = mapJournal(r);
      if (!j.name) { skipped++; continue; }
      const { created: isNew } = upsertByName(j);
      isNew ? created++ : updated++;
    }
  };

  handle(first.results);

  for (let p = 2; p <= totalPages; p++) {
    try {
      const data = await fetchPage(p);
      handle(data.results);
      process.stdout.write(`\r  memproses halaman ${p}/${totalPages}...`);
    } catch (e) {
      console.log(`\n  Gagal halaman ${p}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 250)); // sopan ke server DOAJ
  }

  console.log(`\nSelesai. Baru: ${created}, diperbarui: ${updated}, dilewati: ${skipped}.`);
  console.log('Statistik:', JSON.stringify(stats()));
}

run().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
