// Base de données SQLite (fichier unique, aucune installation nécessaire).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function openDb(file) {
  const target = file || process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'chauffapp.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    company_name TEXT NOT NULL,
    owner_name TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT,
    sms_sender TEXT,
    city TEXT,
    zone TEXT,
    services TEXT,
    about TEXT,
    siret TEXT,
    address TEXT,
    google_review_url TEXT,
    booking_url TEXT,
    primary_color TEXT DEFAULT '#d9480f',
    webhook_token TEXT UNIQUE NOT NULL,
    settings TEXT DEFAULT '{}',
    is_admin INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    plan TEXT DEFAULT 'complet',
    monthly_price INTEGER DEFAULT 99,
    last_report_month TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    first_name TEXT, last_name TEXT, phone TEXT, email TEXT,
    address TEXT, postal_code TEXT, city TEXT,
    work_type TEXT, message TEXT, preferred_slot TEXT,
    source TEXT DEFAULT 'formulaire',
    status TEXT DEFAULT 'nouveau',
    quote_ref TEXT, quote_amount REAL,
    quote_sent_at TEXT, decided_at TEXT, completed_at TEXT,
    review_requested_at TEXT, review_clicked_at TEXT,
    client_response TEXT,
    consent INTEGER DEFAULT 0,
    opt_out_sms INTEGER DEFAULT 0, opt_out_email INTEGER DEFAULT 0,
    token TEXT UNIQUE NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_leads_account ON leads(account_id, status);
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(account_id, phone);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    channel TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT, body TEXT NOT NULL, html TEXT,
    respect_window INTEGER DEFAULT 1,
    scheduled_at TEXT NOT NULL,
    status TEXT DEFAULT 'en_attente',
    sent_at TEXT, error TEXT, provider_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_due ON messages(status, scheduled_at);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL, detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    admin_id INTEGER,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_usage (account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, task TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS opt_outs (
    phone TEXT, email TEXT, account_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  `);
  // Colonnes ajoutées après la première version (les bases existantes sont mises à jour automatiquement).
  addColumns(db, 'accounts', { country: "TEXT DEFAULT 'BE'", is_demo: 'INTEGER DEFAULT 0' });
  addColumns(db, 'leads', { visit_at: 'TEXT', ai_summary: 'TEXT', ai_draft: 'TEXT', lang: "TEXT DEFAULT 'fr'" }); // début du créneau de visite choisi (UTC)
}

function addColumns(db, table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, def] of Object.entries(cols)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}

module.exports = { openDb };
