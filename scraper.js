import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SINTA_BASE = 'https://sinta.kemdiktisaintek.go.id/journals';

async function fetchHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      redirect: 'follow'
    });
  } catch (e) {
    const code = e?.cause?.code || '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new Error('Tidak dapat menjangkau situs Sinta (DNS gagal). Pastikan komputer terhubung internet dan tidak memblokir sinta.kemdiktisaintek.go.id.');
    }
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error('Koneksi ke Sinta timeout. Coba lagi beberapa saat.');
    }
    throw new Error('Gagal menghubungi Sinta: ' + e.message);
  }
  if (!res.ok) throw new Error(`Situs Sinta membalas HTTP ${res.status}.`);
  return await res.text();
}

function formatIssn(raw) {
  if (!raw) return null;
  const s = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (s.length !== 8) return raw.trim() || null;
  return s.slice(0, 4) + '-' + s.slice(4);
}

// Parse semua .list-item jurnal pada satu halaman Sinta.
function parseListItems($) {
  const results = [];
  $('.list-item').each((_, el) => {
    const $el = $(el);
    const nameEl = $el.find('.affil-name a').first();
    let name = nameEl.text().replace(/\s+/g, ' ').trim();
    if (!name) return;

    // Jurnal yang dinonaktifkan di Sinta diberi prefix "--disable--".
    const disabled = /^--disable--/i.test(name);
    if (disabled) name = name.replace(/^--disable--\s*/i, '').trim();

    const text = $el.text().replace(/\s+/g, ' ').trim();

    // URL website jurnal (bukan Google Scholar / Editor URL)
    let url = null;
    $el.find('.affil-abbrev a').each((__, a) => {
      const $a = $(a);
      if (/website/i.test($a.text()) && !url) url = $a.attr('href') || null;
    });

    const publisher = $el.find('.affil-loc a').first().text().replace(/\s+/g, ' ').trim() || null;

    // ISSN & E-ISSN dari ".profile-id": "P-ISSN : 23391286 | E-ISSN : 20894392"
    const pissn = (text.match(/P-ISSN\s*:\s*([0-9Xx]{8})/i) || [])[1];
    const eissnRaw = (text.match(/E-ISSN\s*:\s*([0-9Xx]{8})/i) || [])[1];

    // Bidang (antara "Subject Area :" dan penanda berikutnya)
    const field = (text.match(/Subject Area\s*:\s*(.+?)(?:\s+S[1-6]\s+Accredited|\s+Scopus\s+Indexed|\s+Garuda|\s+Google|$)/i) || [])[1];

    // Peringkat Sinta & status Scopus
    const rankMatch = text.match(/\bS([1-6])\s+Accredited/);
    const sinta_rank = rankMatch ? `S${rankMatch[1]}` : null;
    const isScopus = /Scopus\s+Indexed/i.test(text);

    const index_type = isScopus ? 'Sinta & Scopus' : 'Sinta';

    results.push({
      name,
      publisher,
      issn: formatIssn(pissn),
      eissn: formatIssn(eissnRaw),
      url,
      field: field ? field.trim() : null,
      index_type,
      sinta_rank,
      scopus_quartile: null,
      status: disabled ? 'Discontinued' : 'Terindeks',
      source: 'scraped'
    });
  });
  return results;
}

/**
 * Scrape satu halaman daftar jurnal Sinta.
 * @param {object} opts { page, q }
 */
export async function scrapeSinta({ page = 1, q = '' } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (q) params.set('q', q);
  const html = await fetchHtml(`${SINTA_BASE}?${params.toString()}`);
  return parseListItems(cheerio.load(html));
}

/**
 * Cari jurnal di Sinta (untuk pengayaan). Mengembalikan array item atau null.
 * @param {string} query  ISSN tanpa strip / nama jurnal
 */
export async function searchSinta(query) {
  if (!query) return null;
  const html = await fetchHtml(`${SINTA_BASE}?q=${encodeURIComponent(query)}`);
  const items = parseListItems(cheerio.load(html));
  return items.length ? items : null;
}

export async function scrapeScopus() {
  throw new Error(
    'Scopus tidak menyediakan direktori terbuka. Status Scopus diambil dari penanda ' +
    '"Scopus Indexed" di Sinta, atau isi manual / impor CSV.'
  );
}
