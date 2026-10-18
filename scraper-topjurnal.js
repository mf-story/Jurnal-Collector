import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://top-jurnal.kelasinovatif.com/jurnal/x-';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseDetail(html) {
  const $ = cheerio.load(html);
  const name = $('h1').first().text().trim();
  if (!name) return null;

  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };

  // Penerbit: paragraf tepat setelah h1
  let publisher = $('h1').first().nextAll('p').first().text().trim() || null;
  if (!publisher) publisher = grab(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(.+?)\\s+(?:Tambah ke Shortlist|Scopus|Scimago)'));

  const quartile = grab(/\b(Q[1-4])\b/);
  const apcRaw = grab(/APC\s*Rp\s*([\d.]+)/i);
  const apc = apcRaw ? Number(apcRaw.replace(/\./g, '')) : null;
  const acceptance = grab(/ACCEPTANCE\s*(\d+)\s*%/i);
  const turnaround = grab(/TURNAROUND\s*(\d+)\s*mgg/i);
  const issnPrintRaw = grab(/ISSN Print\s*([\dxX-]+|—)/i);
  const issnOnlineRaw = grab(/ISSN Online\s*([\dxX-]+|—)/i);
  const subjectArea = grab(/Subject Area\s*(.+?)\s*(?:Subject Category|ISSN|Status)/i);
  const country = grab(/Negara Publisher\s*(.+?)\s*Bahasa/i);
  const extraIndex = grab(/Indexing Tambahan\s*(.+?)\s*Subject/i);
  const openAccess = /Open Access/i.test(text);
  const scopusActive = /Status Scopus\s*Active/i.test(text);
  const scopusId = ($('a[href*="/sourceid/"]').attr('href') || '').match(/sourceid\/(\d+)/)?.[1] || null;

  const cleanIssn = (s) => (s && s !== '—' && /\d{4}-?\d{3}[\dxX]/.test(s)) ? s : null;

  return {
    name,
    publisher,
    issn: cleanIssn(issnPrintRaw),
    eissn: cleanIssn(issnOnlineRaw),
    url: scopusId ? `https://www.scopus.com/sourceid/${scopusId}` : null,
    field: subjectArea,
    index_type: 'Scopus',
    scopus_quartile: quartile,
    status: scopusActive ? 'Aktif' : 'Terindeks',
    apc_cost: apc,
    currency: apc ? 'IDR' : null,
    is_free: apc === 0 ? 1 : 0,
    publish_weeks: turnaround ? Number(turnaround) : null,
    acceptance_rate: acceptance ? Number(acceptance) : null,
    notes: `Sumber: Top Jurnal Finder. Negara: ${country || '-'}${extraIndex ? '. Indexing: ' + extraIndex : ''}${openAccess ? '. Open Access' : ''}.`,
    scope: 'Internasional',
    source: 'topjurnal'
  };
}

export async function fetchJournal(id, retries = 2) {
  for (let a = 0; a <= retries; a++) {
    try {
      const r = await fetch(BASE + id, { headers: { 'User-Agent': UA } });
      if (r.status !== 200) return null;
      return parseDetail(await r.text());
    } catch (e) {
      if (a < retries) { await sleep(1000 * (a + 1)); continue; }
      throw e;
    }
  }
  return null;
}

export { parseDetail, sleep };
