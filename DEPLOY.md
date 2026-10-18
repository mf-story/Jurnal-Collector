# Deploy ke Coolify

Panduan men-deploy **Jurnal Collector** ke server Coolify Anda. Aplikasi di-build
sebagai image Docker (Node 24 + SQLite bawaan) dengan **volume persisten** agar data
~45.000 jurnal tidak hilang saat redeploy.

## Ringkasan arsitektur

- **Runtime**: Node 24 Alpine, server Express pada port `3000`.
- **Database**: SQLite (`node:sqlite`), file tunggal di `/app/data/jurnal.db`.
- **Data awal**: `seed/jurnal.db` (±19 MB, ~45.000 jurnal) di-bundle ke image dan
  disalin ke volume saat **boot pertama** (lihat `docker-entrypoint.sh`).
- **Persistensi**: volume Coolify di-mount ke `/app/data`. Sesi admin, rating, usulan,
  dan perubahan data tersimpan di sini — aman lintas redeploy.

## Langkah 1 — Push ke Git

Coolify men-deploy dari repository Git. Bila belum, inisialisasi dan push:

```bash
cd jurnal-collector
git init
git add .
git commit -m "Jurnal Collector siap deploy"
git branch -M main
git remote add origin <URL-REPO-ANDA>   # GitHub/GitLab/Gitea
git push -u origin main
```

> **Penting**: file `seed/jurnal.db` (±19 MB) sengaja ikut di-commit sebagai data awal.
> Pastikan tidak terblokir .gitignore (sudah diatur). Jika memakai GitHub, ukuran ini
> masih di bawah batas 100 MB per file — aman.

## Langkah 2 — Buat aplikasi di Coolify

1. **New Resource → Application**.
2. Pilih **sumber Git** Anda (hubungkan GitHub/GitLab/private repo), pilih repo & branch `main`.
3. **Build Pack**: pilih **Dockerfile** (Coolify otomatis mendeteksi `Dockerfile`).
4. **Port**: `3000` (Ports Exposes).
5. Deploy pertama boleh dijalankan setelah langkah 3–4 di bawah diisi.

## Langkah 3 — Volume persisten (WAJIB)

Agar data tidak hilang saat redeploy:

1. Buka tab **Storages / Persistent Storage** pada aplikasi.
2. Tambah volume:
   - **Name**: `jurnal-data` (bebas)
   - **Mount Path**: `/app/data`
3. Simpan.

Tanpa volume ini, setiap redeploy akan mengulang dari seed (perubahan runtime hilang).

## Langkah 4 — Environment variables

Tab **Environment Variables**:

| Variable | Nilai | Keterangan |
|---|---|---|
| `ADMIN_PASSWORD` | `<kata-sandi-kuat-anda>` | Kata sandi admin awal. **Wajib diganti** dari default `admin123`. Hanya berlaku saat DB admin belum diset. |
| `PORT` | `3000` | Opsional (default sudah 3000). |
| `NODE_ENV` | `production` | Opsional. |

> Catatan: `ADMIN_PASSWORD` hanya dipakai untuk menetapkan sandi **pertama kali**.
> Setelah itu, ubah sandi lewat tombol **🔑 Ganti Sandi** di aplikasi. Karena seed DB
> sudah berisi sandi `admin123`, segera ganti setelah deploy pertama.

## Langkah 5 — Deploy & domain

1. Klik **Deploy**. Coolify akan build image & menjalankan container.
2. Pada log boot, Anda akan melihat:
   `[entrypoint] Database belum ada di volume — menyalin seed (~45k jurnal)...`
3. Setelah sehat, set **Domain** (FQDN) pada aplikasi; Coolify mengurus SSL (Let's Encrypt) otomatis.

## Pasca-deploy

- **Ganti kata sandi admin** segera (tombol 🔑 Ganti Sandi).
- Health check: Coolify bisa diarahkan ke `GET /api/stats` (mengembalikan JSON 200).
- **Memperbarui data** nanti cukup klik tombol **🔄 Perbarui Data** di UI (butuh akses
  internet dari container ke portal Sinta).

## Memperbarui seed (opsional)

Bila ingin data awal terbaru untuk deployment baru, perbarui seed dari DB lokal:

```bash
# hentikan server lokal, lalu:
node -e "import('./db.js').then(m=>{m.default.exec('PRAGMA wal_checkpoint(TRUNCATE)')})"
cp data/jurnal.db seed/jurnal.db
git add seed/jurnal.db && git commit -m "Perbarui seed data" && git push
```

## Troubleshooting

- **Data hilang setelah redeploy** → volume `/app/data` belum terpasang (Langkah 3).
- **`exec /app/docker-entrypoint.sh: no such file or directory`** → file entrypoint
  ter-commit dengan CRLF. Pastikan `.gitattributes` aktif (`*.sh eol=lf`) lalu commit ulang.
- **Port tidak terbuka** → set Ports Exposes ke `3000` di Coolify.
- **node:sqlite error** → pastikan base image Node ≥ 22.5 (Dockerfile memakai `node:24-alpine`).
