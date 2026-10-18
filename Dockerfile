# Jurnal Collector — image produksi untuk Coolify
# node:sqlite tersedia di Node 22.5+ (dipakai tanpa flag di Node 24)
FROM node:24-alpine

WORKDIR /app

# Install dependency produksi saja (manfaatkan layer cache)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Salin seluruh kode aplikasi (termasuk seed/jurnal.db berisi ~45.000 jurnal)
COPY . .

# Folder data dibuat kosong; diisi dari seed saat boot pertama via entrypoint.
RUN rm -rf /app/data && mkdir -p /app/data && chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
