import { createJournal, stats } from './db.js';

const samples = [
  {
    name: 'Jurnal Teknologi Informasi dan Ilmu Komputer (JTIIK)',
    publisher: 'Universitas Brawijaya', field: 'Informatika',
    index_type: 'Sinta', sinta_rank: 'S2', status: 'Aktif',
    issn: '2355-7699', eissn: '2528-6579',
    url: 'https://jtiik.ub.ac.id', apc_cost: 1000000, currency: 'IDR',
    publish_weeks: 12, acceptance_rate: 35, is_free: 0,
    notes: 'Review berkala, terbit tiap bulan.', source: 'manual'
  },
  {
    name: 'Jurnal Ilmu Komputer dan Informasi (JIKI)',
    publisher: 'Universitas Indonesia', field: 'Computer Science',
    index_type: 'Sinta & Scopus', sinta_rank: 'S1', scopus_quartile: 'Q3',
    status: 'Aktif', eissn: '2502-9274',
    url: 'https://jiki.cs.ui.ac.id', apc_cost: 0, currency: 'IDR',
    publish_weeks: 20, acceptance_rate: 25, is_free: 1,
    notes: 'Tidak memungut APC.', source: 'manual'
  },
  {
    name: 'TELKOMNIKA Telecommunication Computing Electronics and Control',
    publisher: 'Universitas Ahmad Dahlan', field: 'Electrical & Electronics',
    index_type: 'Sinta & Scopus', sinta_rank: 'S1', scopus_quartile: 'Q2',
    status: 'Aktif', issn: '1693-6930', eissn: '2302-9293',
    url: 'https://telkomnika.uad.ac.id', apc_cost: 350, currency: 'USD',
    publish_weeks: 16, acceptance_rate: 30, is_free: 0,
    notes: 'APC dalam USD untuk penulis internasional.', source: 'manual'
  },
  {
    name: 'Jurnal Pendidikan Indonesia',
    publisher: 'Universitas Pendidikan Ganesha', field: 'Pendidikan',
    index_type: 'Sinta', sinta_rank: 'S2', status: 'Aktif',
    eissn: '2541-7207', apc_cost: 500000, currency: 'IDR',
    publish_weeks: 10, acceptance_rate: 40, is_free: 0, source: 'manual'
  },
  {
    name: 'Heliyon',
    publisher: 'Elsevier', field: 'Multidisciplinary',
    index_type: 'Scopus', scopus_quartile: 'Q1', status: 'Aktif',
    issn: '2405-8440', url: 'https://www.cell.com/heliyon',
    apc_cost: 2070, currency: 'USD', publish_weeks: 8, acceptance_rate: 50,
    is_free: 0, notes: 'Open access, APC tinggi.', source: 'manual'
  },
  {
    name: 'Register: Jurnal Ilmiah Teknologi Sistem Informasi',
    publisher: 'Universitas Pesantren Tinggi Darul Ulum', field: 'Sistem Informasi',
    index_type: 'Sinta & Scopus', sinta_rank: 'S1', scopus_quartile: 'Q3',
    status: 'Aktif', issn: '2502-3357', eissn: '2503-0477',
    apc_cost: 0, currency: 'IDR', publish_weeks: 14, is_free: 1, source: 'manual'
  },
  {
    name: 'Jurnal Kajian Sastra dan Budaya',
    publisher: 'Universitas Airlangga', field: 'Humaniora',
    index_type: 'Sinta', sinta_rank: 'S4', status: 'Aktif',
    apc_cost: 300000, currency: 'IDR', publish_weeks: 8, is_free: 0, source: 'manual'
  },
  {
    name: 'International Journal of Electrical and Computer Engineering (IJECE)',
    publisher: 'IAES', field: 'Electrical Engineering',
    index_type: 'Scopus', scopus_quartile: 'Q2', status: 'Aktif',
    issn: '2088-8708', url: 'https://ijece.iaescore.com',
    apc_cost: 250, currency: 'USD', publish_weeks: 24, acceptance_rate: 28,
    is_free: 0, source: 'manual'
  }
];

if (stats().total > 0) {
  console.log(`Database sudah berisi ${stats().total} jurnal. Lewati seeding.`);
} else {
  for (const s of samples) createJournal(s);
  console.log(`Berhasil menambahkan ${samples.length} jurnal contoh.`);
}
