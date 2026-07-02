# Pako An Namiroh - Inbox (Fase 0.5)

Inbox WhatsApp custom-code untuk CRM An Namiroh. Menyambungkan gateway
WhatsApp (Evolution API) ke UI inbox, menampilkan daftar & detail chat,
dan mencocokkan **kode unik** dari pesan masuk -> mengambil `fbc/fbp/utm`
dari tabel `mapping_klik` ke `kontak`.

## Isi
- `server.js`        Backend (Express + Postgres) + webhook Evolution
- `public/index.html`UI inbox (1 file, tanpa build step)
- `Dockerfile`       Image Node
- `docker-compose.yml` Jalankan sebagai container, nyambung ke network `namiroh_default`
- `.env.example`     Contoh konfigurasi (salin jadi `.env`)

## Jalankan (di VPS)
```bash
cp .env.example .env   # lalu isi DB_PASSWORD, EVOLUTION_INSTANCE, UI_PASS
docker compose up -d --build
curl -s http://127.0.0.1:3100/health   # {"ok":true}
```

## Endpoint
- `POST /webhook/wa-masuk`  <- diarahkan dari Evolution (event MESSAGES_UPSERT)
- `GET  /api/chats`         daftar kontak + pesan terakhir
- `GET  /api/chats/:id/messages`
- `POST /api/chats/:id/send`  { text }
- `GET  /`                  UI inbox

Backend menjalankan migrasi tabel otomatis (aman & idempoten).
Panduan lengkap langkah-demi-langkah ada di halaman Notion Fase 0.5.
