# Jurnal Collector — Sinta & Scopus

Aplikasi web untuk mengumpulkan dan mengelola data jurnal (Sinta & Scopus) beserta
**status indeksasi, biaya (APC), lama publish, acceptance rate**, dan catatan lainnya.

Dibangun dengan **Node.js + Express** dan **SQLite bawaan Node** (`node:sqlite`) — tanpa
kompilasi native, tanpa database eksternal.

## Fitur

- 📋 **Daftar & filter** jurnal: cari teks, filter indeks (Sinta/Scopus), peringkat Sinta
  (S1–S6), quartile Scopus (Q1–Q4), **bidang ilmu**, status, "gratis saja", dan urutkan
  berdasarkan biaya / lama publish / terbaru.
- ➕ **CRUD manual**: tambah, edit, hapus jurnal lewat form.
- ⬇ **Scrape Sinta**: mengambil data indeksasi jurnal langsung dari direktori Sinta
  (nama, penerbit, peringkat, URL). Biaya & lama publish tetap diisi manual.
- 🔄 **Perbarui Data** (admin): tombol untuk menyegarkan **indeks, peringkat Sinta,
  status, dan bidang** seluruh jurnal dari portal Sinta. Berjalan sebagai job latar
  belakang dengan bilah progres; dapat ditutup/dibuka kembali dan dihentikan. Biaya
  (APC), lama publish, serta status Scopus (SCImago) tidak ditimpa/diturunkan.
- 📁 **Impor CSV** & ⬆ **Ekspor CSV**.
- 📊 Ringkasan statistik (total, Sinta, Scopus, gratis).
- ⭐ **Rating ganda tiap jurnal**:
  - **Rating kualitas (otomatis)** — bintang 1–5 dihitung dari quartile Scopus (Q1 terbaik)
    & peringkat Sinta (S1 terbaik), terisi untuk semua jurnal.
  - **Rating komunitas** — pengunjung memberi bintang 1–5 + ulasan; rata-rata & jumlah
    penilai ditampilkan. Dibatasi rate-limit untuk mencegah spam.
- 🔐 **Akses berbasis peran**: hanya **admin** yang dapat mengedit/menambah/menghapus
  data. **Pengunjung** hanya dapat melihat, namun boleh **mengajukan edit** per jurnal
  dan **mengajukan jurnal baru** — usulan masuk antrean dan ditinjau admin (setujui/tolak).

## Cakupan: Jurnal Nasional & Internasional

Database mencakup dua cakupan, dibedakan lewat kolom `scope` dan filter **"Cakupan"**:

- **Nasional (Indonesia)** — ±16.300 jurnal dari Sinta + Scopus Indonesia (SCImago).
- **Internasional** — ±29.000 jurnal Scopus global, bertanda badge **🌐 Int'l**:
  - ±1.390 dari **Top Jurnal Finder** (lengkap dengan APC, acceptance rate, turnaround).
  - ±27.900 dari **SCImago/Scopus** (seluruh jurnal terindeks Scopus; quartile, penerbit,
    negara, bidang — tanpa APC karena tidak tersedia di SCImago).

Total ±45.000 jurnal. Impor jurnal internasional:

```bash
node import-topjurnal.js   # ~1.390 jurnal kurasi (APC/accept/turnaround)
node import-scimago.js     # ~28.000 jurnal Scopus global dari parquet SCImago
```

`import-scimago.js` membaca file `data/sjr-2025.parquet` (ekspor SJR dari
github.com/ikashnitsky/sjrdata), memfilter tahun terbaru & tipe journal, lalu dedup via
ISSN/nama. Jurnal yang sudah ada diperkaya (quartile/penerbit diisi) tanpa menimpa data.

## Deploy ke Coolify / Docker

Aplikasi siap di-deploy sebagai container. Lihat **[DEPLOY.md](DEPLOY.md)** untuk panduan
langkah demi langkah ke **Coolify** (Dockerfile + volume persisten + variabel lingkungan).

Ringkas:

```bash
docker build -t jurnal-collector .
docker run -p 3000:3000 -v jurnal-data:/app/data -e ADMIN_PASSWORD=rahasia jurnal-collector
```

Database awal (~45.000 jurnal) tersedia di `seed/jurnal.db` dan otomatis disalin ke volume
`/app/data` saat boot pertama (lihat `docker-entrypoint.sh`).

## Autentikasi Admin & Usulan Pengunjung

- **Login admin**: klik "🔑 Masuk Admin". Kata sandi awal **`admin123`** (dapat diatur
  lewat variabel lingkungan `ADMIN_PASSWORD` saat pertama kali dijalankan, atau diubah
  dari dalam aplikasi lewat tombol **"🔑 Ganti Sandi"** / endpoint `POST /api/auth/change-password`).
- **Pengunjung** melihat tombol "+ Ajukan Jurnal" dan ikon ✏️ "Ajukan edit" pada tiap
  baris. Usulan disimpan di tabel `submissions` dengan status `pending`. Pengiriman usulan
  dibatasi **maks. 10 per 10 menit per IP** (rate limit) untuk mencegah spam.
- **Admin** melihat tombol "📥 Usulan" dengan jumlah usulan tertunda; dari sana dapat
  meninjau rincian perubahan, lalu **Setujui** (langsung diterapkan ke data) atau **Tolak**.
- **Ekspor CSV** kini hanya tersedia untuk admin (endpoint `GET /api/export/csv` diproteksi).
- Endpoint tulis (`POST/PUT/DELETE /api/journals`, scrape, impor, ekspor) diproteksi
  middleware admin. Sesi menggunakan cookie bertanda tangan (HMAC) yang bertahan lintas restart.

## Cara Menjalankan

```bash
npm install        # sekali saja
npm run seed       # (opsional) isi 8 jurnal contoh
npm start          # jalankan server
```

Lalu buka **http://localhost:3000**

Mengubah port: `set PORT=4000 && npm start` (Windows) atau `PORT=4000 npm start`.

## Validasi Ulang Data (Re-validation)

Untuk menyegarkan data terhadap sumber terbaru (peringkat/status/bidang berubah
karena re-akreditasi Sinta berkala):

```bash
node revalidate-sinta.js            # lanjut dari progres terakhir
node revalidate-sinta.js --restart  # mulai dari halaman 1
```

Berbeda dengan `scrape:all` (yang hanya mengisi field kosong), skrip ini **membandingkan
dan memperbarui** peringkat Sinta (S1–S6), status, dan bidang bila berbeda dari Sinta.
Aman & cermat:

- **Tidak menurunkan status Scopus** yang bersumber dari SCImago/Scopus (lebih
  otoritatif untuk Scopus daripada penanda Sinta).
- **Mempertahankan data manual**: biaya (APC), lama publish, catatan, dan quartile.
- **Resumable** via tabel `scrape_state` (kunci `reval_page`).

> Catatan: APC & lama publish tidak tersedia di Sinta, sehingga tidak divalidasi massal —
> hanya jurnal kurasi yang punya nilai ini (verifikasi manual di situs jurnal).

## Scrape Seluruh Direktori Sinta (~16.000 jurnal)

Untuk mengisi **seluruh jurnal terakreditasi Sinta** (bukan hanya open access):

```bash
npm run scrape:all
```

Skrip ini menelusuri semua halaman direktori Sinta (±1.678 halaman), mengambil nama,
penerbit, ISSN, URL, bidang, **peringkat Sinta (S1–S6)**, dan status **Scopus**.
Fitur penting:

- **Dedup via ISSN/nama** — tidak menduplikasi jurnal yang sudah ada; data manual
  (biaya, lama publish) tidak tertimpa.
- **Resumable** — progres halaman disimpan di tabel `scrape_state`. Bila terputus
  (Sinta sesekali membalas error sementara), jalankan ulang untuk melanjutkan dari
  halaman terakhir. Pakai `node scrape-all-sinta.js --restart` untuk mulai dari awal.
- **Sopan** — jeda 400 ms antar halaman dengan retry berbackoff.

Proses penuh memakan ±20–40 menit. Setelah selesai, jalankan `npm run dedupe` untuk
merapikan sisa duplikat lintas-sumber.

## Pengayaan Indeks dari Sinta

Jurnal hasil impor DOAJ tidak memuat status Sinta/Scopus. Untuk mengisinya otomatis:

```bash
npm run enrich:sinta
```

Skrip ini mencari tiap jurnal yang indeksnya kosong di portal Sinta (berdasarkan
ISSN, lalu nama), lalu mengisi **peringkat Sinta (S1–S6)** dan menandai **Scopus**
bila jurnal bertanda "Scopus Indexed". Aman dijalankan berkali-kali (hanya memproses
yang masih kosong) — berguna bila sempat terputus karena Sinta sesekali membalas
error sementara. Jurnal yang tidak ditemukan di Sinta tetap ditandai sebagai
"DOAJ / Open Access".

### Quartile Scopus (Q1–Q4)

Quartile Scopus diisi dari **SCImago (SJR)** — turunan resmi data Scopus — dengan
mengambil quartile **tahun terbaru** per jurnal (dicocokkan berdasarkan ISSN). Karena
SCImago dilindungi Cloudflare, pengambilannya dilakukan sekali lewat browser dan
hasilnya disimpan ke database. Nilai bisa berubah tiap tahun; verifikasi di
scimagojr.com bila perlu.

## Impor Massal dari DOAJ

Untuk mengisi daftar dengan **semua jurnal Indonesia** dari DOAJ (Directory of
Open Access Journals) — lengkap dengan URL laman jurnal (bisa diklik) dan biaya APC:

```bash
npm run import:doaj
```

Skrip ini menarik ~400+ jurnal Indonesia via API resmi DOAJ, mengisi nama, penerbit,
ISSN, URL, bidang, dan biaya (APC). Biaya & lama publish dikosongkan bila tidak
tersedia. Jurnal yang sudah ada akan diperbarui (tidak menimpa data manual Anda).

> Catatan: DOAJ hanya memuat jurnal **open access** dan tidak menyediakan status
> peringkat Sinta/Scopus, sehingga kolom indeks untuk jurnal hasil impor ini kosong
> dan bisa Anda lengkapi manual.

## Impor CSV

Gunakan header kolom sesuai `contoh-template.csv`. Kolom wajib hanya `name`.
Baris dengan nama jurnal yang sudah ada akan **diperbarui** (field indeksasi diisi,
tanpa menimpa biaya/lama publish yang sudah Anda masukkan manual).

Kolom yang didukung:
`name, publisher, issn, eissn, url, field, index_type, sinta_rank, scopus_quartile,
status, apc_cost, currency, is_free, publish_weeks, acceptance_rate, notes`

## Catatan Sumber Data

- **Sinta**: data indeksasi di-scrape dari situs resmi Sinta. Struktur situs dapat
  berubah sewaktu-waktu; bila gagal, aplikasi menampilkan pesan yang jelas dan Anda
  tetap bisa input manual / impor CSV.
- **Scopus**: tidak memiliki direktori terbuka tanpa API key Elsevier. Data Scopus
  (quartile, biaya, dll.) diisi manual atau via impor CSV.
- **Biaya (APC) & lama publish**: informasi ini umumnya tidak tersedia resmi dari
  Sinta/Scopus, sehingga diisi manual berdasarkan informasi dari penerbit/komunitas.

## Struktur Proyek

```
jurnal-collector/
├── server.js          # Express + REST API
├── db.js              # Skema & query SQLite
├── scraper.js         # Scraper Sinta (+ placeholder Scopus)
├── seed.js            # Data contoh
├── public/            # Antarmuka web (HTML/CSS/JS)
└── data/jurnal.db     # Database (dibuat otomatis)
```
