import db, { updateJournal, deleteJournal } from './db.js';

const DRY = process.argv.includes('--dry');
const norm = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();

const rows = db.prepare('SELECT * FROM journals').all();

// Kelompokkan berdasarkan ISSN/eISSN yang sama (union-find).
const parent = {};
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
for (const r of rows) parent[r.id] = r.id;
const byIssn = new Map();
for (const r of rows) {
  for (const key of [norm(r.issn), norm(r.eissn)].filter((k) => k.length === 8)) {
    if (!byIssn.has(key)) byIssn.set(key, []);
    byIssn.get(key).push(r.id);
  }
}
for (const ids of byIssn.values()) for (let i = 1; i < ids.length; i++) parent[find(ids[i])] = find(ids[0]);

const groups = {};
for (const r of rows) { const g = find(r.id); (groups[g] = groups[g] || []).push(r); }
const dupGroups = Object.values(groups).filter((g) => g.length > 1);

const SCORE_FIELDS = ['apc_cost', 'publish_weeks', 'scopus_quartile', 'sinta_rank', 'url', 'publisher', 'field', 'acceptance_rate', 'issn', 'eissn'];
const filled = (v) => v !== null && v !== undefined && v !== '';
const score = (r) => SCORE_FIELDS.reduce((s, f) => s + (filled(r[f]) ? 1 : 0), 0) + (r.source === 'manual' ? 1 : 0);

const MERGE_FIELDS = ['name', 'publisher', 'issn', 'eissn', 'url', 'field', 'index_type',
  'sinta_rank', 'scopus_quartile', 'status', 'apc_cost', 'currency', 'is_free',
  'publish_weeks', 'acceptance_rate', 'notes'];

let merged = 0, deleted = 0;

for (const g of dupGroups) {
  // Primer = skor tertinggi; tiebreak id terkecil.
  const sorted = [...g].sort((a, b) => score(b) - score(a) || a.id - b.id);
  const primary = sorted[0];
  const others = sorted.slice(1);

  const result = { ...primary };
  for (const o of others) {
    for (const f of MERGE_FIELDS) {
      if (!filled(result[f]) && filled(o[f])) result[f] = o[f];
    }
    // index_type: utamakan yang memuat Scopus (paling informatif)
    if ((o.index_type || '').includes('Scopus') && !(result.index_type || '').includes('Scopus')) {
      result.index_type = o.index_type;
    }
    // quartile & sinta_rank: ambil bila primer kosong
    if (!filled(result.scopus_quartile) && filled(o.scopus_quartile)) result.scopus_quartile = o.scopus_quartile;
    if (!filled(result.sinta_rank) && filled(o.sinta_rank)) result.sinta_rank = o.sinta_rank;
    // nama paling deskriptif (terpanjang)
    if ((o.name || '').length > (result.name || '').length) result.name = o.name;
  }

  console.log(`\nGrup -> primer id${primary.id}: ${result.name.slice(0, 50)}`);
  console.log(`  index=${result.index_type} rank=${result.sinta_rank} Q=${result.scopus_quartile} apc=${result.apc_cost} pub=${result.publish_weeks}`);
  console.log(`  hapus: ${others.map((o) => 'id' + o.id).join(', ')}`);

  if (!DRY) {
    updateJournal(primary.id, result);
    for (const o of others) { deleteJournal(o.id); deleted++; }
    merged++;
  }
}

console.log(`\n${DRY ? '[DRY-RUN] ' : ''}Grup diproses: ${dupGroups.length} | digabung: ${merged} | baris dihapus: ${deleted}`);
if (!DRY) console.log('Total jurnal sekarang:', db.prepare('SELECT COUNT(*) n FROM journals').get().n);
