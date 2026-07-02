// Pako An Namiroh - Inbox  (Fase 0.5)
// Backend minimal: ingest pesan WhatsApp dari Evolution API, simpan ke Postgres
// (DB annamiroh), cocokkan kode unik -> ambil fbc/fbp/utm dari mapping_klik,
// dan layani UI inbox (daftar chat, detail chat, kirim balasan).

const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const crypto = require("crypto");

const {
  PORT = 3100,
  DB_HOST = "postgres",
  DB_PORT = 5432,
  DB_NAME = "annamiroh",
  DB_USER = "annamiroh_app",
  DB_PASSWORD = "",
  EVOLUTION_URL = "http://evolution-api:8080",
  EVOLUTION_APIKEY = "",
  EVOLUTION_INSTANCE = "cs-pako",
  WEBHOOK_TOKEN = "",          // opsional: proteksi endpoint webhook
  UI_USER = "",                 // opsional: Basic Auth utk UI
  UI_PASS = "",
  CAPI_TOKEN = "",              // Token Meta Conversions API
  CAPI_DATASET_ID = "",         // ID Dataset Meta Pixel
  CAPI_TEST_CODE = "",          // Test event code (isi saat uji, kosongkan di produksi)
} = process.env;

const pool = new Pool({
  host: DB_HOST, port: Number(DB_PORT), database: DB_NAME,
  user: DB_USER, password: DB_PASSWORD, max: 5,
});

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---- Basic Auth opsional untuk UI & API (single-user Owner) ----
app.use((req, res, next) => {
  if (!UI_USER) return next();                       // auth dimatikan
  if (req.path.startsWith("/webhook")) return next(); // webhook pakai token sendiri
  const h = req.headers.authorization || "";
  const [u, p] = Buffer.from(h.split(" ")[1] || "", "base64").toString().split(":");
  if (u === UI_USER && p === UI_PASS) return next();
  res.set("WWW-Authenticate", 'Basic realm="Inbox"').status(401).send("Auth diperlukan");
});

// ---------- Helper ----------
const onlyDigits = s => String(s || "").replace(/\D/g, "");
const jidToPhone = jid => onlyDigits(String(jid || "").split("@")[0]);
function extractKode(text) {
  if (!text) return null;
  const m = String(text).match(/kode[\s:#-]*([A-Za-z0-9]{3,12})/i);
  return m ? m[1].toUpperCase() : null;
}
const fmtTime = d => d ? new Date(d).toLocaleString("id-ID",
  { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit", timeZone:"Asia/Jakarta" }) : "";
const fmtClock = d => d ? new Date(d).toLocaleTimeString("id-ID",
  { hour:"2-digit", minute:"2-digit", timeZone:"Asia/Jakarta" }) : "";

// Helper: hash SHA256
function sha256(val) {
  if (!val) return undefined;
  return crypto.createHash("sha256").update(String(val).trim().toLowerCase()).digest("hex");
}

// Helper: normalisasi nomor HP ke E.164 lalu hash
function hashPhone(no_hp) {
  const digits = String(no_hp || "").replace(/\D/g, "");
  if (!digits) return undefined;
  const e164 = digits.startsWith("0") ? "62" + digits.slice(1) : digits;
  return sha256(e164);
}

// Helper: kirim event ke Meta Conversions API
async function sendCapiEvent({ eventName, eventId, no_hp, nama, fbc, fbp, customData }) {
  if (!CAPI_TOKEN || !CAPI_DATASET_ID) throw new Error("CAPI_TOKEN atau CAPI_DATASET_ID belum diisi di .env");
  const parts = (nama || "").trim().split(/\s+/);
  const userData = {
    ph: hashPhone(no_hp) ? [hashPhone(no_hp)] : undefined,
    fn: sha256(parts[0]),
    ln: parts.length > 1 ? sha256(parts.slice(1).join(" ")) : undefined,
    fbc: fbc || undefined,
    fbp: fbp || undefined,
  };
  Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);
  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      user_data: userData,
      custom_data: customData || {},
    }],
    access_token: CAPI_TOKEN,
  };
  if (CAPI_TEST_CODE) payload.test_event_code = CAPI_TEST_CODE;
  const url = `https://graph.facebook.com/v20.0/${CAPI_DATASET_ID}/events`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await r.json();
  if (!r.ok || result.error) throw new Error(JSON.stringify(result.error || result));
  return result;
}

// ---------- Migrasi idempoten (aman dijalankan berulang) ----------
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kontak (
      id SERIAL PRIMARY KEY,
      jid TEXT UNIQUE,
      no_hp TEXT,
      nama TEXT,
      status_lead TEXT,
      skor_lead INTEGER,
      sumber_iklan TEXT,
      fbc TEXT, fbp TEXT,
      utm_source TEXT, utm_campaign TEXT,
      kode TEXT,
      ai_aktif BOOLEAN DEFAULT true,
      dibuat TIMESTAMPTZ DEFAULT now(),
      diperbarui TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS percakapan (
      id SERIAL PRIMARY KEY,
      kontak_id INTEGER REFERENCES kontak(id) ON DELETE CASCADE,
      jid TEXT,
      arah TEXT,               -- 'masuk' | 'keluar'
      pesan TEXT,
      tipe TEXT DEFAULT 'text',
      wa_message_id TEXT,
      waktu TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS log_event (
      id SERIAL PRIMARY KEY,
      kontak_id INTEGER REFERENCES kontak(id) ON DELETE CASCADE,
      jenis TEXT,
      kualitas TEXT,
      nilai_order NUMERIC,
      status_bayar TEXT,
      catatan TEXT,
      event_id TEXT,
      status TEXT,
      pesan_error TEXT,
      waktu TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_percakapan_kontak ON percakapan(kontak_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_percakapan_waid
      ON percakapan(wa_message_id) WHERE wa_message_id IS NOT NULL;
  `);
  // Guard kolom (kalau tabel sudah ada versi lama)
  const cols = {
    kontak: ["jid TEXT","no_hp TEXT","nama TEXT","status_lead TEXT","skor_lead INTEGER",
      "sumber_iklan TEXT","fbc TEXT","fbp TEXT","utm_source TEXT","utm_campaign TEXT",
      "kode TEXT","ai_aktif BOOLEAN DEFAULT true",
      "dibuat TIMESTAMPTZ DEFAULT now()","diperbarui TIMESTAMPTZ DEFAULT now()"],
    percakapan: ["kontak_id INTEGER","jid TEXT","arah TEXT","pesan TEXT",
      "tipe TEXT","wa_message_id TEXT","waktu TIMESTAMPTZ DEFAULT now()"],
    log_event: ["kontak_id INTEGER","jenis TEXT","kualitas TEXT","nilai_order NUMERIC",
      "status_bayar TEXT","catatan TEXT",
      "event_id TEXT","status TEXT","pesan_error TEXT","waktu TIMESTAMPTZ DEFAULT now()"],
  };
  for (const [tbl, defs] of Object.entries(cols))
    for (const d of defs)
      await pool.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${d}`);
  console.log("[migrate] tabel kontak & percakapan siap");
}

// ---------- Upsert kontak + pencocokan kode -> fbc ----------
async function upsertKontak(jid, nama) {
  const phone = jidToPhone(jid);
  const { rows } = await pool.query(
    `INSERT INTO kontak (jid, no_hp, nama)
     VALUES ($1,$2,$3)
     ON CONFLICT (jid) DO UPDATE SET
       nama = COALESCE(NULLIF(EXCLUDED.nama,''), kontak.nama),
       diperbarui = now()
     RETURNING *`, [jid, phone, nama || null]);
  return rows[0];
}

async function cocokkanKode(kontak, teks) {
  if (kontak.fbc) return kontak;               // sudah punya fbc, lewati
  const kode = extractKode(teks);
  if (!kode) return kontak;
  const { rows } = await pool.query(
    `SELECT * FROM mapping_klik WHERE kode = $1 ORDER BY waktu DESC LIMIT 1`, [kode]
  ).catch(() => ({ rows: [] }));
  if (!rows.length) {
    await pool.query(`UPDATE kontak SET kode=$1, diperbarui=now() WHERE id=$2`, [kode, kontak.id]);
    return { ...kontak, kode };
  }
  const m = rows[0];
  const src = m.utm_source ? `${m.utm_source}${m.utm_campaign ? " - " + m.utm_campaign : ""}` : kontak.sumber_iklan;
  const { rows: up } = await pool.query(
    `UPDATE kontak SET kode=$1, fbc=$2, fbp=$3, utm_source=$4, utm_campaign=$5,
       sumber_iklan=COALESCE($6, sumber_iklan), diperbarui=now()
     WHERE id=$7 RETURNING *`,
    [kode, m.fbc || null, m.fbp || null, m.utm_source || null, m.utm_campaign || null, src, kontak.id]);
  console.log(`[kode] ${kode} -> fbc ${m.fbc ? "OK" : "kosong"} utk kontak ${kontak.id}`);
  return up[0];
}

// ---------- Webhook Evolution: MESSAGES_UPSERT ----------
app.post("/webhook/wa-masuk", async (req, res) => {
  try {
    if (WEBHOOK_TOKEN && req.query.token !== WEBHOOK_TOKEN) return res.status(401).end();
    const b = req.body || {};
    const data = b.data || {};
    const jid = data.key?.remoteJid;
    if (!jid || jid.endsWith("@g.us")) return res.json({ ok: true, skip: "grup/kosong" });
    const fromMe = !!data.key?.fromMe;
    const teks = data.message?.conversation
      || data.message?.extendedTextMessage?.text
      || data.message?.imageMessage?.caption || "";
    const tipe = data.message?.conversation || data.message?.extendedTextMessage ? "text"
      : data.message?.imageMessage ? "image" : "other";

    const waId = data.key?.id || null;
    // Dedup: pesan yang kita kirim sendiri lewat API sudah tersimpan; Evolution
    // ikut mengirim balik event yang sama (fromMe) -> jangan simpan dua kali.
    if (waId) {
      const { rows } = await pool.query(
        `SELECT 1 FROM percakapan WHERE wa_message_id=$1 LIMIT 1`, [waId]);
      if (rows.length) return res.json({ ok: true, dup: true });
    }

    let kontak = await upsertKontak(jid, data.pushName);
    if (!fromMe) kontak = await cocokkanKode(kontak, teks);

    await pool.query(
      `INSERT INTO percakapan (kontak_id, jid, arah, pesan, tipe, wa_message_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [kontak.id, jid, fromMe ? "keluar" : "masuk", teks, tipe, waId]);

    res.json({ ok: true, kontak_id: kontak.id, fbc: !!kontak.fbc });
  } catch (e) {
    console.error("[webhook]", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- API untuk UI ----------
app.get("/api/chats", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT k.*,
        p.pesan AS last, p.waktu AS last_waktu
      FROM kontak k
      LEFT JOIN LATERAL (
        SELECT pesan, waktu FROM percakapan WHERE kontak_id = k.id
        ORDER BY waktu DESC LIMIT 1
      ) p ON true
      ORDER BY COALESCE(p.waktu, k.diperbarui) DESC`);
    res.json(rows.map(r => ({
      id: r.id, nama: r.nama, no_hp: r.no_hp, status_lead: r.status_lead,
      skor_lead: r.skor_lead, ai_aktif: r.ai_aktif !== false,
      sumber_iklan: r.sumber_iklan, fbc: r.fbc, fbp: r.fbp, kode: r.kode,
      last: r.last, last_time: fmtClock(r.last_waktu),
      first: fmtTime(r.dibuat),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/chats/:id/messages", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT arah, pesan, waktu FROM percakapan WHERE kontak_id=$1 ORDER BY waktu ASC LIMIT 500`,
      [req.params.id]);
    res.json(rows.map(r => ({ arah: r.arah, pesan: r.pesan, t: fmtClock(r.waktu) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/chats/:id/send", async (req, res) => {
  try {
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "teks kosong" });
    const { rows } = await pool.query(`SELECT * FROM kontak WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "kontak tidak ada" });
    const kontak = rows[0];
    const number = jidToPhone(kontak.jid || kontak.no_hp);

    const r = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_APIKEY },
      body: JSON.stringify({ number, text }),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: "Evolution gagal: " + t.slice(0, 200) });
    }
    const sent = await r.json().catch(() => ({}));
    await pool.query(
      `INSERT INTO percakapan (kontak_id, jid, arah, pesan, tipe, wa_message_id)
       VALUES ($1,$2,'keluar',$3,'text',$4)`,
      [kontak.id, kontak.jid, text, sent?.key?.id || null]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Fase 1: Kirim sinyal Lead Warm/Hot ke Meta CAPI ---
app.post("/api/signal", async (req, res) => {
  try {
    const { kontak_id, kualitas } = req.body || {};
    if (!kontak_id || !["warm","hot"].includes(kualitas))
      return res.status(400).json({ error: "kontak_id dan kualitas (warm/hot) wajib diisi" });
    const { rows } = await pool.query("SELECT * FROM kontak WHERE id=$1", [kontak_id]);
    if (!rows.length) return res.status(404).json({ error: "kontak tidak ditemukan" });
    const k = rows[0];
    const eventId = `lead-${kontak_id}-${kualitas}-${Date.now()}`;
    let capiResult = null, capiError = null;
    try {
      capiResult = await sendCapiEvent({ eventName: "Lead", eventId, no_hp: k.no_hp, nama: k.nama, fbc: k.fbc, fbp: k.fbp, customData: { lead_quality: kualitas } });
    } catch (e) { capiError = e.message; }
    await pool.query("UPDATE kontak SET status_lead=$1, diperbarui=now() WHERE id=$2", [kualitas, kontak_id]);
    await pool.query(
      "INSERT INTO log_event (kontak_id, jenis, kualitas, event_id, status, pesan_error) VALUES ($1,'Lead',$2,$3,$4,$5)",
      [kontak_id, kualitas, eventId, capiError ? "gagal" : "terkirim", capiError || null]
    );
    if (capiError) return res.json({ ok: false, error: capiError });
    res.json({ ok: true, events_received: capiResult?.events_received });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Fase 1: Kirim event Purchase ke Meta CAPI ---
app.post("/api/purchase", async (req, res) => {
  try {
    const { kontak_id, nilai_order, status, catatan } = req.body || {};
    if (!kontak_id) return res.status(400).json({ error: "kontak_id wajib diisi" });
    const { rows } = await pool.query("SELECT * FROM kontak WHERE id=$1", [kontak_id]);
    if (!rows.length) return res.status(404).json({ error: "kontak tidak ditemukan" });
    const k = rows[0];
    const eventId = `purchase-${kontak_id}-${Date.now()}`;
    const customData = { currency: "IDR" };
    if (nilai_order && Number(nilai_order) > 0) customData.value = Number(nilai_order);
    let capiResult = null, capiError = null;
    try {
      capiResult = await sendCapiEvent({ eventName: "Purchase", eventId, no_hp: k.no_hp, nama: k.nama, fbc: k.fbc, fbp: k.fbp, customData });
    } catch (e) { capiError = e.message; }
    await pool.query(
      "INSERT INTO log_event (kontak_id, jenis, nilai_order, status_bayar, catatan, event_id, status, pesan_error) VALUES ($1,'Purchase',$2,$3,$4,$5,$6,$7)",
      [kontak_id, nilai_order || null, status || null, catatan || null, eventId, capiError ? "gagal" : "terkirim", capiError || null]
    );
    if (capiError) return res.json({ ok: false, error: capiError });
    res.json({ ok: true, events_received: capiResult?.events_received });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Fase 1: Ambil log sinyal CAPI per kontak ---
app.get("/api/signals/:kontakId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM log_event WHERE kontak_id=$1 ORDER BY waktu DESC LIMIT 20",
      [req.params.kontakId]
    );
    res.json(rows.map(r => ({
      id: r.id, jenis: r.jenis, kualitas: r.kualitas,
      nilai_order: r.nilai_order, status: r.status,
      pesan_error: r.pesan_error, waktu: fmtTime(r.waktu),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Fase 1: Update status lead manual ---
app.patch("/api/chats/:id/lead", async (req, res) => {
  try {
    const { status_lead } = req.body || {};
    await pool.query("UPDATE kontak SET status_lead=$1, diperbarui=now() WHERE id=$2", [status_lead || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/health", (_r, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, "public")));

migrate()
  .then(() => app.listen(PORT, () => console.log(`[inbox] jalan di :${PORT}`)))
  .catch(e => { console.error("[migrate] gagal:", e.message); process.exit(1); });
