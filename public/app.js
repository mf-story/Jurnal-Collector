const $ = (s) => document.querySelector(s);
const tbody = $('#tbody');

const PAGE_SIZE = 25;
let pageData = { items: [], total: 0, totalPages: 1 };
let page = 1;

const state = {
  q: '', index_type: '', sinta_rank: '', scopus_quartile: '',
  status: '', is_free: '', sort: 'name', field: '', scope: '', min_rating: ''
};

const auth = { admin: false, pending: 0 };

async function loadAuth() {
  try {
    const s = await (await fetch('/api/auth/status')).json();
    auth.admin = !!s.admin;
    auth.pending = s.pending || 0;
  } catch { auth.admin = false; }
  applyAuthUI();
}

function applyAuthUI() {
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', !auth.admin));
  document.querySelectorAll('.visitor-only').forEach((el) => el.classList.toggle('hidden', auth.admin));
  const badge = $('#pendingBadge');
  if (badge) {
    badge.textContent = auth.pending;
    badge.classList.toggle('hidden', !auth.pending);
  }
}

async function loadFields() {
  try {
    const fields = await (await fetch('/api/fields')).json();
    const dd = $('#fField');
    dd.insertAdjacentHTML('beforeend', fields.map((f) =>
      `<option value="${esc(f.field)}">${esc(f.field)} (${f.count})</option>`).join(''));
  } catch { /* abaikan */ }
}

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  setTimeout(() => t.classList.add('hidden'), 3200);
}

function fmtMoney(v, cur) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (n === 0) return 'Gratis';
  return new Intl.NumberFormat('id-ID').format(n) + ' ' + (cur || 'IDR');
}

function fmtPublish(w) {
  if (!w) return '—';
  if (w < 4) return `${w} minggu`;
  const m = Math.round((w / 4.345) * 10) / 10;
  return `± ${m} bulan`;
}

function badge(text, cls) {
  return text ? `<span class="badge ${cls}">${text}</span>` : '';
}

// Rating kualitas otomatis (0-5) dari quartile Scopus & peringkat Sinta.
function qualityScore(j) {
  const qMap = { Q1: 5, Q2: 4, Q3: 3, Q4: 2 };
  const sMap = { S1: 4.5, S2: 4, S3: 3.5, S4: 2.5, S5: 2, S6: 1.5 };
  let score = 0;
  if (j.scopus_quartile && qMap[j.scopus_quartile]) score = qMap[j.scopus_quartile];
  if (j.sinta_rank && sMap[j.sinta_rank] > score) score = sMap[j.sinta_rank];
  if (!score) {
    if ((j.index_type || '').includes('Scopus')) score = 3;
    else if ((j.index_type || '').includes('DOAJ')) score = 1.5;
    else score = 1;
  }
  return score;
}

// Render 5 bintang dengan isian parsial (persentase emas).
function starBar(score, cls = '') {
  const pct = Math.max(0, Math.min(100, (score / 5) * 100));
  return `<span class="stars ${cls}" title="${score.toFixed(1)}/5">
    <span class="stars-bg">★★★★★</span>
    <span class="stars-fg" style="width:${pct}%">★★★★★</span>
  </span>`;
}

function ratingCell(j) {
  const q = qualityScore(j);
  const quality = `<div class="rate-quality">${starBar(q)}<span class="rate-num">${q.toFixed(1)}</span></div>`;
  const community = (j.rating_count > 0)
    ? `<div class="rate-community" title="Rating pengunjung">👥 ${Number(j.rating_avg).toFixed(1)} <span class="rate-count">(${j.rating_count})</span></div>`
    : '';
  return `<div class="rate-cell">${quality}${community}
    <button class="rate-btn" data-rate="${j.id}" title="Beri penilaian">☆ Nilai</button>
  </div>`;
}

function indexBadges(j) {
  let out = '';
  if (j.index_type && j.index_type.includes('Sinta')) out += badge('Sinta', 'badge-sinta');
  if (j.index_type && j.index_type.includes('Scopus')) out += badge('Scopus', 'badge-scopus');
  if (j.index_type && j.index_type.includes('DOAJ')) out += badge('DOAJ', 'badge-doaj');
  if (j.scope === 'Internasional') out += badge('🌐 Int\'l', 'badge-intl');
  return out ? `<span class="badge-gap">${out}</span>` : '—';
}

function rankBadges(j) {
  let out = '';
  if (j.sinta_rank) out += badge(j.sinta_rank, 'badge-rank');
  if (j.scopus_quartile) out += badge(j.scopus_quartile, 'badge-q');
  return out ? `<span class="badge-gap">${out}</span>` : '—';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadStats() {
  const s = await (await fetch('/api/stats')).json();
  $('#statTotal').textContent = s.total;
  $('#statSinta').textContent = s.sinta;
  $('#statScopus').textContent = s.scopus;
  renderDist('#distRank', s.rankDist, 'sinta_rank', 'fSinta');
  renderDist('#distQuartile', s.quartileDist, 'scopus_quartile', 'fScopus');
  if (s.scopeDist) {
    $('#scopeCountAll').textContent = fmtNum(s.total);
    $('#scopeCountNas').textContent = fmtNum(s.scopeDist.Nasional);
    $('#scopeCountIntl').textContent = fmtNum(s.scopeDist.Internasional);
  }
}

function fmtNum(n) { return new Intl.NumberFormat('id-ID').format(n); }

function renderDist(sel, dist, stateKey, selectId) {
  const entries = Object.entries(dist || {});
  const max = Math.max(1, ...entries.map(([, n]) => n));
  $(sel).innerHTML = entries.map(([label, n]) => {
    const pct = Math.round((n / max) * 100);
    const active = state[stateKey] === label ? ' active' : '';
    return `<button class="dist-item${active}" data-key="${stateKey}" data-val="${label}" data-sel="${selectId}" title="${label}: ${n} jurnal">
      <span class="dist-label">${label}</span>
      <span class="dist-track"><span class="dist-fill" style="width:${pct}%"></span></span>
      <span class="dist-count">${n}</span>
    </button>`;
  }).join('');
}

async function load(resetPage = true) {
  if (resetPage) page = 1;
  const params = new URLSearchParams();
  Object.entries(state).forEach(([k, v]) => { if (v) params.set(k, v); });
  params.set('page', page);
  params.set('pageSize', PAGE_SIZE);
  pageData = await (await fetch('/api/journals?' + params)).json();
  page = pageData.page;
  renderPage();
  loadStats();
}

function rowHtml(j) {
  const costDisplay = j.is_free ? 'Gratis' : fmtMoney(j.apc_cost, j.currency);
  const costCls = (j.is_free || (j.apc_cost !== null && j.apc_cost !== '' && Number(j.apc_cost) === 0)) ? 'badge-free' : '';
  const name = j.url
    ? `<a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.name)}</a>`
    : esc(j.name);
  const meta = [
    j.publisher ? esc(j.publisher) : '',
    j.issn ? 'ISSN ' + esc(j.issn) : ''
  ].filter(Boolean).join(' · ');
  return `<tr>
    <td data-label="Jurnal"><div class="jname">${name}</div>${meta ? `<div class="jpub">${meta}</div>` : ''}</td>
    <td data-label="Indeks">${indexBadges(j)}</td>
    <td data-label="Peringkat">${rankBadges(j)}</td>
    <td data-label="Rating">${ratingCell(j)}</td>
    <td data-label="Status">${badge(esc(j.status || '—'), 'badge-status')}</td>
    <td data-label="Biaya (APC)">${costCls ? `<span class="badge ${costCls}">${costDisplay}</span>` : esc(costDisplay)}</td>
    <td data-label="Lama Publish">${esc(fmtPublish(j.publish_weeks))}</td>
    <td data-label="Bidang">${esc(j.field || '—')}</td>
    <td data-label="Aksi"><div class="row-actions">
      ${auth.admin
        ? `<button class="icon-btn" data-edit="${j.id}" title="Edit">✏️</button>
           <button class="icon-btn danger" data-del="${j.id}" title="Hapus">🗑️</button>`
        : `<button class="icon-btn" data-propose="${j.id}" title="Ajukan edit">✏️</button>`}
    </div></td>
  </tr>`;
}

function renderPage() {
  const { items, total, totalPages } = pageData;

  $('#empty').classList.toggle('hidden', total > 0);
  tbody.innerHTML = items.map(rowHtml).join('');

  const pag = $('#pagination');
  if (total === 0) { pag.classList.add('hidden'); return; }
  pag.classList.remove('hidden');
  const start = (page - 1) * PAGE_SIZE;
  const from = start + 1;
  const to = Math.min(start + items.length, total);
  $('#pageInfo').textContent = `${from}–${to} dari ${total} jurnal`;
  $('#pageNow').textContent = `Halaman ${page} / ${totalPages}`;
  $('#btnPrev').disabled = page <= 1;
  $('#btnNext').disabled = page >= totalPages;
}

// ---- Filter wiring ----
$('#search').addEventListener('input', debounce((e) => { state.q = e.target.value; load(); }, 300));
$('#fIndex').addEventListener('change', (e) => { state.index_type = e.target.value; load(); });
$('#fSinta').addEventListener('change', (e) => { state.sinta_rank = e.target.value; load(); });
$('#fScopus').addEventListener('change', (e) => { state.scopus_quartile = e.target.value; load(); });
$('#fStatus').addEventListener('change', (e) => { state.status = e.target.value; load(); });
$('#fField').addEventListener('change', (e) => { state.field = e.target.value; load(); });
$('#fScope').addEventListener('change', (e) => { setScope(e.target.value); });
$('#fRating').addEventListener('change', (e) => { state.min_rating = e.target.value; load(); });

// ---- Tab cakupan (Nasional / Internasional) ----
function setScope(scope) {
  state.scope = scope;
  $('#fScope').value = scope;
  document.querySelectorAll('.scope-tab').forEach((t) => t.classList.toggle('active', t.dataset.scope === scope));
  load();
}
document.querySelector('#scopeTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.scope-tab');
  if (tab) setScope(tab.dataset.scope);
});
$('#fSort').addEventListener('change', (e) => { state.sort = e.target.value; load(); });
$('#fFree').addEventListener('change', (e) => { state.is_free = e.target.checked ? 'true' : ''; load(); });

// ---- Distribution bar click -> filter ----
document.querySelector('#dist').addEventListener('click', (e) => {
  const btn = e.target.closest('.dist-item');
  if (!btn) return;
  const { key, val, sel } = btn.dataset;
  state[key] = state[key] === val ? '' : val;
  const dd = document.querySelector('#' + sel);
  if (dd) dd.value = state[key];
  load();
});

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---- Pagination ----
$('#btnPrev').addEventListener('click', () => { if (page > 1) { page--; load(false); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
$('#btnNext').addEventListener('click', () => { if (page < pageData.totalPages) { page++; load(false); window.scrollTo({ top: 0, behavior: 'smooth' }); } });

// ---- Table actions ----
tbody.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  const proposeId = e.target.dataset.propose;
  const rateId = e.target.dataset.rate;
  if (editId) openForm(await (await fetch('/api/journals/' + editId)).json());
  if (proposeId) openForm(await (await fetch('/api/journals/' + proposeId)).json(), true);
  if (rateId) openRate(rateId);
  if (delId && confirm('Hapus jurnal ini?')) {
    const res = await fetch('/api/journals/' + delId, { method: 'DELETE' });
    if (res.ok) { toast('Jurnal dihapus'); load(); }
    else { const err = await res.json(); toast(err.error || 'Gagal menghapus', true); }
  }
});

// ---- Modal Rating ----
const rateModal = $('#rateModal');
let rateJournalId = null;
let rateSelectedStars = 0;

async function openRate(id) {
  rateJournalId = id;
  rateSelectedStars = 0;
  $('#rateReview').value = '';
  $('#rateSubmitter').value = '';
  $('#rateMsg').classList.add('hidden');
  setStarInput(0);
  const j = await (await fetch('/api/journals/' + id)).json();
  $('#rateJournalName').textContent = j.name;
  const q = qualityScore(j);
  $('#rateQualityInfo').innerHTML = `Rating kualitas (otomatis): ${starBar(q)} <b>${q.toFixed(1)}/5</b>` +
    (j.rating_count > 0 ? ` · Komunitas: 👥 ${Number(j.rating_avg).toFixed(1)} dari ${j.rating_count} penilai` : '');
  // daftar ulasan
  const data = await (await fetch(`/api/journals/${id}/ratings`)).json();
  const reviews = (data.ratings || []).filter((r) => r.review);
  $('#rateList').innerHTML = reviews.length
    ? '<div class="rate-list-title">Ulasan pengunjung</div>' + reviews.map((r) =>
        `<div class="rate-review"><span class="rate-review-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span>
         ${r.submitter ? '<b>' + esc(r.submitter) + '</b> ' : ''}<span>${esc(r.review)}</span></div>`).join('')
    : '';
  rateModal.classList.remove('hidden');
}
function closeRate() { rateModal.classList.add('hidden'); }
function setStarInput(n) {
  rateSelectedStars = n;
  document.querySelectorAll('#starInput span').forEach((s) => {
    s.classList.toggle('on', Number(s.dataset.star) <= n);
  });
}
$('#starInput').addEventListener('click', (e) => { if (e.target.dataset.star) setStarInput(Number(e.target.dataset.star)); });
$('#starInput').addEventListener('mouseover', (e) => {
  if (e.target.dataset.star) document.querySelectorAll('#starInput span').forEach((s) => s.classList.toggle('hover', Number(s.dataset.star) <= Number(e.target.dataset.star)));
});
$('#starInput').addEventListener('mouseout', () => document.querySelectorAll('#starInput span').forEach((s) => s.classList.remove('hover')));
$('#rateClose').addEventListener('click', closeRate);
$('#rateCancel').addEventListener('click', closeRate);
rateModal.addEventListener('click', (e) => { if (e.target === rateModal) closeRate(); });

$('#rateSubmit').addEventListener('click', async () => {
  const msg = $('#rateMsg');
  if (!rateSelectedStars) { msg.className = 'msg err'; msg.textContent = 'Pilih jumlah bintang dulu'; msg.classList.remove('hidden'); return; }
  const res = await fetch(`/api/journals/${rateJournalId}/ratings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stars: rateSelectedStars, review: $('#rateReview').value, submitter: $('#rateSubmitter').value })
  });
  if (res.ok) { toast('Terima kasih atas penilaian Anda!'); closeRate(); load(false); }
  else { const err = await res.json(); msg.className = 'msg err'; msg.textContent = err.error || 'Gagal'; msg.classList.remove('hidden'); }
});

// ---- Form modal ----
const modal = $('#modal');
const form = $('#form');
let proposeMode = false; // true = usulan pengunjung

function openForm(data = null, propose = false) {
  form.reset();
  proposeMode = propose;
  const editing = !!data;
  $('#modalTitle').textContent = propose
    ? (editing ? 'Ajukan Edit Jurnal' : 'Ajukan Jurnal Baru')
    : (editing ? 'Edit Jurnal' : 'Tambah Jurnal');
  $('#formSubmitBtn').textContent = propose ? 'Kirim Usulan' : 'Simpan';
  $('#proposeBanner').classList.toggle('hidden', !propose);
  $('#proposeFields').classList.toggle('hidden', !propose);
  form.id.value = data?.id || '';
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
    }
  }
  modal.classList.remove('hidden');
}
function closeForm() { modal.classList.add('hidden'); }

$('#btnAdd').addEventListener('click', () => openForm());
$('#btnProposeNew').addEventListener('click', () => openForm(null, true));
$('#modalClose').addEventListener('click', closeForm);
$('#formCancel').addEventListener('click', closeForm);
modal.addEventListener('click', (e) => { if (e.target === modal) closeForm(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  data.is_free = form.elements.is_free.checked ? 1 : 0;
  if (data.is_free) data.apc_cost = 0;
  const id = data.id;
  delete data.id;
  const submitter = data.submitter; delete data.submitter;
  const submitNote = data.submit_note; delete data.submit_note;

  if (proposeMode) {
    // Kirim sebagai usulan (tidak langsung mengubah data)
    const payload = {
      kind: id ? 'edit' : 'new',
      journal_id: id ? Number(id) : undefined,
      data, note: submitNote, submitter
    };
    const res = await fetch('/api/submissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (res.ok) { toast('Usulan terkirim. Terima kasih! Menunggu tinjauan admin.'); closeForm(); }
    else { const err = await res.json(); toast(err.error || 'Gagal mengirim usulan', true); }
    return;
  }

  const url = id ? '/api/journals/' + id : '/api/journals';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  if (res.ok) { toast(id ? 'Perubahan disimpan' : 'Jurnal ditambahkan'); closeForm(); load(); }
  else { const err = await res.json(); toast(err.error || 'Gagal menyimpan', true); }
});

// ---- Scrape modal ----
const scrapeModal = $('#scrapeModal');
$('#btnScrape').addEventListener('click', () => { $('#scrapeMsg').classList.add('hidden'); scrapeModal.classList.remove('hidden'); });
$('#scrapeClose').addEventListener('click', () => scrapeModal.classList.add('hidden'));
$('#scrapeCancel').addEventListener('click', () => scrapeModal.classList.add('hidden'));
scrapeModal.addEventListener('click', (e) => { if (e.target === scrapeModal) scrapeModal.classList.add('hidden'); });

$('#scrapeRun').addEventListener('click', async () => {
  const msg = $('#scrapeMsg');
  msg.className = 'msg loading'; msg.textContent = 'Sedang mengambil data dari Sinta...';
  msg.classList.remove('hidden');
  try {
    const res = await fetch('/api/scrape/sinta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: $('#scrapeQ').value, pages: Number($('#scrapePages').value) || 1 })
    });
    const data = await res.json();
    if (res.ok) {
      msg.className = 'msg ok';
      msg.textContent = `Selesai. Ditemukan ${data.found}, baru ${data.created}, diperbarui ${data.updated}.`;
      load();
    } else {
      msg.className = 'msg err';
      msg.textContent = data.error || 'Gagal scraping.';
    }
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = 'Kesalahan jaringan: ' + err.message;
  }
});

// ---- Perbarui Data (job latar belakang) ----
const updateModal = $('#updateModal');
let updatePoll = null;

$('#btnUpdate').addEventListener('click', async () => {
  $('#updateMsg').classList.add('hidden');
  updateModal.classList.remove('hidden');
  await refreshUpdateStatus(); // tampilkan status terkini bila sudah berjalan
});
$('#updateClose').addEventListener('click', closeUpdate);
$('#updateCloseBtn').addEventListener('click', closeUpdate);
updateModal.addEventListener('click', (e) => { if (e.target === updateModal) closeUpdate(); });

function closeUpdate() {
  updateModal.classList.add('hidden');
  if (updatePoll) { clearInterval(updatePoll); updatePoll = null; }
}

$('#updateRun').addEventListener('click', async () => {
  const res = await fetch('/api/update-data', { method: 'POST' });
  const data = await res.json();
  if (res.ok || res.status === 409) {
    startPolling();
  } else {
    const m = $('#updateMsg'); m.className = 'msg err'; m.textContent = data.error || 'Gagal memulai'; m.classList.remove('hidden');
  }
});

$('#updateCancelJob').addEventListener('click', async () => {
  await fetch('/api/update-data/cancel', { method: 'POST' });
  toast('Permintaan penghentian dikirim');
});

async function refreshUpdateStatus() {
  try {
    const s = await (await fetch('/api/update-data/status')).json();
    renderUpdate(s);
    if (s.running) startPolling();
  } catch { /* abaikan */ }
}

function startPolling() {
  $('#updateProgress').classList.remove('hidden');
  if (updatePoll) clearInterval(updatePoll);
  updatePoll = setInterval(async () => {
    try {
      const s = await (await fetch('/api/update-data/status')).json();
      renderUpdate(s);
      if (!s.running) { clearInterval(updatePoll); updatePoll = null; load(); }
    } catch { /* abaikan */ }
  }, 2500);
}

function renderUpdate(s) {
  const running = s.running;
  $('#updateRun').disabled = running;
  $('#updateRun').textContent = s.finishedAt ? 'Perbarui Lagi' : 'Mulai Perbarui';
  $('#updateRun').classList.toggle('hidden', running);
  $('#updateCancelJob').classList.toggle('hidden', !running);

  if (!s.startedAt && !running) { $('#updateProgress').classList.add('hidden'); return; }
  $('#updateProgress').classList.remove('hidden');

  const pct = s.maxPage ? Math.min(100, Math.round((s.page / s.maxPage) * 100)) : 0;
  $('#progressFill').style.width = pct + '%';
  const mins = s.elapsedSec ? Math.floor(s.elapsedSec / 60) + 'm ' + (s.elapsedSec % 60) + 's' : '';
  if (running) {
    $('#progressText').textContent = `Halaman ${s.page}/${s.maxPage} (${pct}%) · ${mins}`;
  } else if (s.error) {
    $('#progressText').textContent = `Berhenti: ${s.error}`;
  } else if (s.finishedAt) {
    $('#progressText').textContent = `Selesai dalam ${mins}. ${s.matched} jurnal dicek.`;
  }
  const c = s.changes || {};
  $('#progressChanges').textContent = `Peringkat: ${c.rank || 0} · Status: ${c.status || 0} · Bidang: ${c.field || 0}`;

  if (!running && s.finishedAt && !s.error) {
    const m = $('#updateMsg'); m.className = 'msg ok'; m.textContent = 'Pembaruan selesai.'; m.classList.remove('hidden');
  }
}

// ---- Import CSV ----
$('#btnImport').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const res = await fetch('/api/import/csv', {
    method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text
  });
  const data = await res.json();
  if (res.ok) toast(`Impor selesai: ${data.created} baru, ${data.updated} diperbarui`);
  else toast(data.error || 'Gagal impor', true);
  e.target.value = '';
  load();
});

// ---- Auth: login / logout ----
const loginModal = $('#loginModal');
$('#btnLogin').addEventListener('click', () => { $('#loginMsg').classList.add('hidden'); $('#loginPassword').value = ''; loginModal.classList.remove('hidden'); setTimeout(() => $('#loginPassword').focus(), 50); });
$('#loginClose').addEventListener('click', () => loginModal.classList.add('hidden'));
$('#loginCancel').addEventListener('click', () => loginModal.classList.add('hidden'));
loginModal.addEventListener('click', (e) => { if (e.target === loginModal) loginModal.classList.add('hidden'); });

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('#loginPassword').value })
  });
  if (res.ok) {
    loginModal.classList.add('hidden');
    toast('Berhasil masuk sebagai admin');
    await loadAuth();
    load();
  } else {
    const m = $('#loginMsg'); m.textContent = 'Kata sandi salah'; m.classList.remove('hidden');
  }
});

$('#btnLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  toast('Anda telah keluar');
  await loadAuth();
  load();
});

// ---- Ganti kata sandi ----
const pwModal = $('#pwModal');
$('#btnChangePw').addEventListener('click', () => {
  $('#pwForm').reset();
  $('#pwMsg').classList.add('hidden');
  pwModal.classList.remove('hidden');
  setTimeout(() => $('#pwCurrent').focus(), 50);
});
$('#pwClose').addEventListener('click', () => pwModal.classList.add('hidden'));
$('#pwCancel').addEventListener('click', () => pwModal.classList.add('hidden'));
pwModal.addEventListener('click', (e) => { if (e.target === pwModal) pwModal.classList.add('hidden'); });

$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#pwMsg');
  const current = $('#pwCurrent').value;
  const next = $('#pwNext').value;
  const confirm = $('#pwConfirm').value;
  if (next.length < 4) { msg.className = 'msg err'; msg.textContent = 'Kata sandi baru minimal 4 karakter'; msg.classList.remove('hidden'); return; }
  if (next !== confirm) { msg.className = 'msg err'; msg.textContent = 'Konfirmasi kata sandi tidak cocok'; msg.classList.remove('hidden'); return; }
  const res = await fetch('/api/auth/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, next })
  });
  if (res.ok) { pwModal.classList.add('hidden'); toast('Kata sandi berhasil diubah'); }
  else { const err = await res.json(); msg.className = 'msg err'; msg.textContent = err.error || 'Gagal mengubah'; msg.classList.remove('hidden'); }
});

// ---- Review usulan (admin) ----
const reviewModal = $('#reviewModal');
$('#btnReview').addEventListener('click', openReview);
$('#reviewClose').addEventListener('click', () => reviewModal.classList.add('hidden'));
reviewModal.addEventListener('click', (e) => { if (e.target === reviewModal) reviewModal.classList.add('hidden'); });

const FIELD_LABELS = {
  name: 'Nama', publisher: 'Penerbit', issn: 'ISSN', eissn: 'E-ISSN', url: 'URL',
  field: 'Bidang', index_type: 'Indeks', sinta_rank: 'Peringkat', scopus_quartile: 'Quartile',
  status: 'Status', apc_cost: 'Biaya (APC)', currency: 'Mata Uang', is_free: 'Gratis',
  publish_weeks: 'Lama Publish (minggu)', acceptance_rate: 'Acceptance Rate', notes: 'Catatan'
};

async function openReview() {
  reviewModal.classList.remove('hidden');
  const list = $('#reviewList');
  list.innerHTML = '<p class="hint">Memuat...</p>';
  const subs = await (await fetch('/api/submissions?status=pending')).json();
  $('#reviewCount').textContent = subs.length;
  $('#reviewEmpty').classList.toggle('hidden', subs.length > 0);
  if (!subs.length) { list.innerHTML = ''; return; }

  list.innerHTML = subs.map((s) => {
    const changes = Object.entries(s.data)
      .filter(([k]) => FIELD_LABELS[k])
      .map(([k, v]) => `<div class="chg"><span class="chg-k">${FIELD_LABELS[k]}</span><span class="chg-v">${esc(String(v))}</span></div>`)
      .join('');
    const kindBadge = s.kind === 'new'
      ? '<span class="badge badge-sinta">Jurnal Baru</span>'
      : '<span class="badge badge-doaj">Edit</span>';
    return `<div class="review-item" data-id="${s.id}">
      <div class="review-head">
        ${kindBadge}
        <strong>${esc(s.journal_name || s.data.name || '(tanpa nama)')}</strong>
        <span class="review-meta">${s.submitter ? 'oleh ' + esc(s.submitter) + ' · ' : ''}${esc((s.created_at || '').slice(0, 16))}</span>
      </div>
      ${s.note ? `<div class="review-note">💬 ${esc(s.note)}</div>` : ''}
      <div class="chg-grid">${changes || '<span class="hint">(tidak ada perubahan field)</span>'}</div>
      <div class="review-actions">
        <button class="btn btn-ghost" data-reject="${s.id}">Tolak</button>
        <button class="btn btn-primary" data-approve="${s.id}">Setujui</button>
      </div>
    </div>`;
  }).join('');
}

$('#reviewList').addEventListener('click', async (e) => {
  const ap = e.target.dataset.approve;
  const rj = e.target.dataset.reject;
  if (ap) {
    const res = await fetch(`/api/submissions/${ap}/approve`, { method: 'POST' });
    if (res.ok) { toast('Usulan disetujui & diterapkan'); refreshAfterReview(); }
    else { const err = await res.json(); toast(err.error || 'Gagal menyetujui', true); }
  }
  if (rj) {
    const res = await fetch(`/api/submissions/${rj}/reject`, { method: 'POST' });
    if (res.ok) { toast('Usulan ditolak'); refreshAfterReview(); }
    else { toast('Gagal menolak', true); }
  }
});

async function refreshAfterReview() {
  await loadAuth();
  await openReview();
  load();
}

// ---- Pengunjung ----
function fmtVisit(n) { return new Intl.NumberFormat('id-ID').format(n || 0); }
async function recordVisit() {
  try {
    const s = await (await fetch('/api/visit', { method: 'POST' })).json();
    renderVisit(s);
  } catch { /* abaikan */ }
}
function renderVisit(s) {
  if (!s) return;
  $('#visUnique').textContent = fmtVisit(s.uniqueVisitors);
  $('#visTotal').textContent = fmtVisit(s.totalHits);
  $('#visToday').textContent = fmtVisit(s.todayVisitors);
}

loadAuth();
load();
loadFields();
recordVisit();
