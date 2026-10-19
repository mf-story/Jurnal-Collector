// Migrasi data satu kali — dijalankan otomatis saat aplikasi start.
// Memperbaiki false-positive status Scopus akibat bug pencocokan nama generik
// (mis. "Communications" UNJ keliru ditandai Scopus Q1).
import db, { getConfig, setConfig } from './db.js';

const norm = (s) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase();

// Jurnal yang Sinta & SCImago sama-sama tidak akui Scopus → cabut tanda Scopus + quartile.
const REVERT_ISSNS = ['25029274','23563656','29625556','25800760','25805290','28099885','20890257','26863464','27459284','26157543','25026313','25278150','25495925','24077267','24606316','26214814','25411217','2407876X','27459330','25974874','27752674','25027646','25274716','2620522X','2655853X','2620309X','26216485','2087751X','24608742','23560991','24609102','25500023','24430994','24424285','25274031','25481576','26862611','26556847','27156230','28091019','30217865','27152081','26569477','26559617','27232603','26215225','26863251','25992538','26859572','25027824','26850591','27763013','30465117','29646219','29854318','24600288','24077690','2579308X','26866498','29618061','25494082','27457982','25024485','27160580','25494325','26848392','28100824','29880947','30249864','30252792','26568039','2656615X','25028650','28306902','28076419','28287606','26142198','25498614','02169185','26557517','27749932','25803824','29645522','2986237X','29884411','29863406','29646227'];

// Jurnal yang Sinta AKUI Scopus, tapi quartile-nya salah dari name-collision → bersihkan quartile saja.
const CLEAR_Q_ISSNS = ['20878575','25279165','24422274','27982351','27230317','27754243','26545675','23029781','27160610','25287249'];

export function runMigrations() {
  if (getConfig('migration_scopus_fix_v1') === 'done') return;

  const findByIssn = db.prepare(
    "SELECT id, index_type FROM journals WHERE scope='Nasional' AND (REPLACE(REPLACE(UPPER(COALESCE(issn,'')),'-',''),' ','') = ? OR REPLACE(REPLACE(UPPER(COALESCE(eissn,'')),'-',''),' ','') = ?)"
  );
  const updIndex = db.prepare("UPDATE journals SET index_type=?, scopus_quartile=NULL, updated_at=datetime('now') WHERE id=?");
  const clearQ = db.prepare("UPDATE journals SET scopus_quartile=NULL, updated_at=datetime('now') WHERE id=?");

  let reverted = 0, cleared = 0;
  db.exec('BEGIN');
  try {
    for (const issn of REVERT_ISSNS) {
      const k = norm(issn);
      for (const row of findByIssn.all(k, k)) {
        if (!(row.index_type || '').includes('Scopus')) continue;
        const base = (row.index_type || '').includes('DOAJ') ? 'DOAJ / Open Access' : 'Sinta';
        updIndex.run(base, row.id);
        reverted++;
      }
    }
    for (const issn of CLEAR_Q_ISSNS) {
      const k = norm(issn);
      for (const row of findByIssn.all(k, k)) { clearQ.run(row.id); cleared++; }
    }
    setConfig('migration_scopus_fix_v1', 'done');
    db.exec('COMMIT');
    if (reverted || cleared) {
      console.log(`[migrasi] Perbaikan Scopus: ${reverted} false-positive dicabut, ${cleared} quartile dibersihkan.`);
    }
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('[migrasi] Gagal:', e.message);
  }
}
