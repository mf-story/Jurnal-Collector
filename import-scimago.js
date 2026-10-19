import db, { getJournal, updateJournal } from './db.js';
import { parquetReadObjects } from 'hyparquet';
import fs from 'node:fs';

const PARQUET = 'data/sjr-2025.parquet';
const norm = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();
const filled = (v) => v !== null && v !== undefined && v !== '';

function fmtIssn(raw8) {
  const s = (raw8 || '').replace(/[^0-9Xx]/gi, '').toUpperCase();
  return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : null;
}
function subjectFromCategories(cat) {
  if (!cat) return null;
  return cat.split(';')[0].replace(/\s*\(Q[1-4]\)\s*/i, '').trim() || null;
}

async function run() {
  if (!fs.existsSync(PARQUET)) { console.error('File parquet tidak ada:', PARQUET); process.exit(1); }
  console.log('Membaca parquet SCImago...');
  const buf = fs.readFileSync(PARQUET);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  const rows = await parquetReadObjects({ file: ab, columns: ['year', 'title', 'type', 'issn', 'sjr_best_quartile', 'publisher', 'country', 'categories', 'sourceid'] });
  let maxYear = 0; for (const r of rows) if (r.year > maxYear) maxYear = r.year;
  const journals = rows.filter((r) => r.year === maxYear && r.type === 'journal');
  console.log(`Jurnal Scopus tahun ${maxYear}: ${journals.length}`);

  // Index DB untuk dedup.
  const issnIndex = new Map();
  const nameIndex = new Map();
  for (const r of db.prepare('SELECT id,name,issn,eissn FROM journals').all()) {
    for (const k of [norm(r.issn), norm(r.eissn)].filter((x) => x.length === 8)) issnIndex.set(k, r.id);
    nameIndex.set(r.name.trim().toLowerCase(), r.id);
  }

  const insert = db.prepare(`INSERT INTO journals
    (name, publisher, issn, eissn, url, field, index_type, scopus_quartile, status, notes, source, scope)
    VALUES ($name,$publisher,$issn,$eissn,$url,$field,'Scopus',$q,'Aktif',$notes,'scimago','Internasional')`);

  let created = 0, enriched = 0, skipped = 0;
  db.exec('BEGIN');
  try {
    for (const j of journals) {
      const name = (j.title || '').trim();
      if (!name) { skipped++; continue; }
      const issnParts = String(j.issn || '').split(',').map((s) => fmtIssn(s)).filter(Boolean);
      const keys = issnParts.map(norm).filter((x) => x.length === 8);
      const quartile = /Q[1-4]/.test(j.sjr_best_quartile || '') ? j.sjr_best_quartile : null;

      // Dedup — HANYA via ISSN. Pencocokan nama dinonaktifkan karena nama generik
      // (mis. "Communications") menyebabkan false-positive menandai jurnal lain Scopus.
      let existingId = null;
      for (const k of keys) if (issnIndex.has(k)) { existingId = issnIndex.get(k); break; }

      if (existingId) {
        const cur = getJournal(existingId);
        if (cur) {
          const patch = { ...cur };
          if (!filled(patch.scopus_quartile) && quartile) patch.scopus_quartile = quartile;
          if (!filled(patch.publisher) && j.publisher) patch.publisher = j.publisher;
          if (!filled(patch.field) && j.categories) patch.field = subjectFromCategories(j.categories);
          if (!(patch.index_type || '').includes('Scopus')) patch.index_type = patch.index_type ? patch.index_type + ' & Scopus' : 'Scopus';
          updateJournal(existingId, patch);
          enriched++;
        }
        continue;
      }

      const info = insert.run({
        $name: name,
        $publisher: j.publisher || null,
        $issn: issnParts[1] || issnParts[0] || null,
        $eissn: issnParts[1] ? issnParts[0] : null,
        $url: j.sourceid ? `https://www.scopus.com/sourceid/${j.sourceid}` : null,
        $field: subjectFromCategories(j.categories),
        $q: quartile,
        $notes: `Sumber: SCImago/Scopus ${maxYear}. Negara: ${j.country || '-'}.`
      });
      created++;
      // index entri baru
      for (const k of keys) issnIndex.set(k, Number(info.lastInsertRowid));
      nameIndex.set(name.toLowerCase(), Number(info.lastInsertRowid));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  console.log(`Selesai. Baru: ${created}, diperkaya: ${enriched}, dilewati: ${skipped}`);
  console.log('Total jurnal DB:', db.prepare('SELECT COUNT(*) n FROM journals').get().n);
  console.log('Internasional:', db.prepare("SELECT COUNT(*) n FROM journals WHERE scope='Internasional'").get().n);
  console.log('Total Scopus:', db.prepare("SELECT COUNT(*) n FROM journals WHERE index_type LIKE '%Scopus%'").get().n);
}

run().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
