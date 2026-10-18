#!/bin/sh
set -e

DATA_DIR="/app/data"
DB="$DATA_DIR/jurnal.db"
SEED="/app/seed/jurnal.db"

mkdir -p "$DATA_DIR"

# Pada boot pertama (volume kosong), salin database awal berisi ~45.000 jurnal.
if [ ! -f "$DB" ] && [ -f "$SEED" ]; then
  echo "[entrypoint] Database belum ada di volume — menyalin seed (~45k jurnal)..."
  cp "$SEED" "$DB"
  echo "[entrypoint] Selesai menyalin database awal."
fi

echo "[entrypoint] Menjalankan Jurnal Collector pada port ${PORT:-3000}..."
exec node server.js
