/* ==========================================================================
   BantayKo Munidad - SQL database server (SQLite)
   - No npm install needed. Needs Node.js 22.13 or newer.
   - Run:  node server.js     (or double-click start.bat on Windows)
   - Open: http://localhost:3000
   - All data is saved in the file  bantayko.db  (next to this file).
   ========================================================================== */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let DatabaseSync;
try {
    ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
    console.error("\nERROR: This Node.js version has no built-in SQLite.");
    console.error("Please install Node.js 22.13 or newer from https://nodejs.org (LTS version).\n");
    process.exit(1);
}

const PORT = process.env.PORT || 3000;
const HOST = "127.0.0.1";               // only this computer can connect
const DB_FILE = path.join(__dirname, "bantayko.db");
const HTML_FILE = "BantayKoMunidad.html";

const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

/* ---------------------------- SQL TABLES ---------------------------- */
db.exec(`
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    module    TEXT NOT NULL,
    ip        TEXT,
    diff      TEXT
);

CREATE TABLE IF NOT EXISTS serial_logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    serial   TEXT NOT NULL,
    type     TEXT NOT NULL,
    resident TEXT NOT NULL,
    date     TEXT,
    issuer   TEXT,
    status   TEXT DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS vetting_requests (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    date     TEXT,
    purok    TEXT,
    docs     TEXT,
    status   TEXT NOT NULL DEFAULT 'Pending',
    id_photo TEXT,
    notes    TEXT
);

CREATE TABLE IF NOT EXISTS emergencies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    house        INTEGER NOT NULL,
    name         TEXT,
    triggered_at TEXT NOT NULL,
    handled_by   TEXT,
    status       TEXT NOT NULL DEFAULT 'ACTIVE',
    cleared_at   TEXT,
    cleared_by   TEXT
);

CREATE TABLE IF NOT EXISTS community_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    severity    TEXT NOT NULL,
    target_zone TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    escalated   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    created_by  TEXT
);

CREATE TABLE IF NOT EXISTS feed_posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    description  TEXT,
    category     TEXT NOT NULL,
    event_status TEXT NOT NULL DEFAULT 'pending',
    time_label   TEXT,
    created_at   TEXT NOT NULL,
    created_by   TEXT
);

CREATE TABLE IF NOT EXISTS aid_listings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    type        TEXT NOT NULL,
    category    TEXT NOT NULL,
    target_zone TEXT NOT NULL,
    contact     TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TEXT NOT NULL,
    created_by  TEXT
);
`);

const TABLES = ["audit_logs", "serial_logs", "vetting_requests", "emergencies",
                "community_alerts", "feed_posts", "aid_listings", "meta"];

/* ---------------------------- HELPERS ---------------------------- */
const now = () => new Date().toISOString();
const str = (v, max = 5000) => (v === undefined || v === null) ? null : String(v).slice(0, max);

function tx(fn) {
    db.exec("BEGIN");
    try { const r = fn(); db.exec("COMMIT"); return r; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
}

function insertAudit(e) {
    return db.prepare(
        "INSERT INTO audit_logs (timestamp, actor, action, module, ip, diff) VALUES (?,?,?,?,?,?)"
    ).run(str(e.timestamp) || now(), str(e.actor) || "System", str(e.action) || "", str(e.module) || "",
          str(e.ip), str(e.diff));
}
function insertSerial(s) {
    return db.prepare(
        "INSERT INTO serial_logs (serial, type, resident, date, issuer, status) VALUES (?,?,?,?,?,?)"
    ).run(str(s.serial), str(s.type), str(s.resident), str(s.date), str(s.issuer), str(s.status) || "Active");
}
function upsertVetting(r) {
    return db.prepare(`
        INSERT INTO vetting_requests (id, name, date, purok, docs, status, id_photo, notes)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, date=excluded.date, purok=excluded.purok,
            docs=excluded.docs, status=excluded.status, id_photo=excluded.id_photo, notes=excluded.notes
    `).run(str(r.id), str(r.name), str(r.date), str(r.purok), JSON.stringify(r.docs || []),
           str(r.status) || "Pending", str(r.idPhoto), str(r.notes));
}

function counts() {
    const c = {};
    let total = 0;
    for (const t of TABLES.filter(t => t !== "meta")) {
        c[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
        total += c[t];
    }
    c.total = total;
    return c;
}

function fullState() {
    const initialized = !!db.prepare("SELECT 1 FROM meta WHERE key='initialized'").get();
    const audit = db.prepare("SELECT timestamp, actor, action, module, ip, diff FROM audit_logs ORDER BY id DESC").all();
    const serial = db.prepare("SELECT serial, type, resident, date, issuer, status FROM serial_logs ORDER BY id DESC").all();
    const vetting = db.prepare("SELECT * FROM vetting_requests ORDER BY rowid").all().map(r => ({
        id: r.id, name: r.name, date: r.date, purok: r.purok, docs: JSON.parse(r.docs || "[]"),
        status: r.status, idPhoto: r.id_photo, notes: r.notes
    }));
    const active = db.prepare("SELECT id, house, name FROM emergencies WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1").get() || null;
    return {
        initialized, audit, serial, vetting, active_emergency: active,
        alerts: db.prepare("SELECT * FROM community_alerts ORDER BY id DESC").all(),
        feed:   db.prepare("SELECT * FROM feed_posts ORDER BY id DESC").all(),
        aid:    db.prepare("SELECT * FROM aid_listings ORDER BY id DESC").all(),
        counts: counts()
    };
}

/* ---------------------------- ROUTES ---------------------------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp("^" + pattern + "$"), handler });

route("GET", "/api/state", () => fullState());
route("GET", "/api/health", () => ({ ok: true, counts: counts() }));

route("POST", "/api/seed", (m, body) => {
    tx(() => {
        if (db.prepare("SELECT 1 FROM meta WHERE key='initialized'").get()) return;
        // arrays arrive newest-first; insert oldest-first so ids ascend
        for (const e of [...(body.audit || [])].reverse()) insertAudit(e);
        for (const s of [...(body.serial || [])].reverse()) insertSerial(s);
        for (const r of (body.vetting || [])) upsertVetting(r);
        db.prepare("INSERT INTO meta (key, value) VALUES ('initialized', ?)").run(now());
    });
    return { ok: true, counts: counts() };
});

route("POST", "/api/audit",  (m, b) => ({ id: Number(insertAudit(b).lastInsertRowid) }));
route("POST", "/api/serial", (m, b) => ({ id: Number(insertSerial(b).lastInsertRowid) }));

route("PUT", "/api/vetting/([^/]+)", (m, b) => {
    const allowed = ["Pending", "Under Review", "Approved", "Rejected"];
    if (!allowed.includes(b.status)) throw httpError(400, "Invalid status");
    const r = db.prepare("UPDATE vetting_requests SET status=? WHERE id=?").run(b.status, decodeURIComponent(m[1]));
    if (!r.changes) throw httpError(404, "Request not found");
    return { ok: true };
});

route("POST", "/api/emergencies", (m, b) => {
    const house = parseInt(b.house, 10);
    if (!Number.isInteger(house)) throw httpError(400, "house must be a number");
    return tx(() => {
        db.prepare("UPDATE emergencies SET status='SUPERSEDED' WHERE status='ACTIVE'").run();
        const r = db.prepare(
            "INSERT INTO emergencies (house, name, triggered_at, handled_by, status) VALUES (?,?,?,?, 'ACTIVE')"
        ).run(house, str(b.name), now(), str(b.handled_by));
        return { id: Number(r.lastInsertRowid) };
    });
});
route("POST", "/api/emergencies/clear-active", (m, b) => {
    const r = db.prepare(
        "UPDATE emergencies SET status='CLEARED', cleared_at=?, cleared_by=? WHERE status='ACTIVE'"
    ).run(now(), str(b.cleared_by));
    return { cleared: r.changes };
});

route("POST", "/api/alerts", (m, b) => {
    if (!b.title || !b.message || !b.severity || !b.target_zone) throw httpError(400, "Missing fields");
    const r = db.prepare(
        "INSERT INTO community_alerts (title, message, severity, target_zone, status, escalated, created_at, created_by) VALUES (?,?,?,?, 'active', 0, ?, ?)"
    ).run(str(b.title, 300), str(b.message), str(b.severity, 20), str(b.target_zone, 100), now(), str(b.created_by));
    return { id: Number(r.lastInsertRowid), created_at: now() };
});
route("PUT", "/api/alerts/(\\d+)", (m, b) => {
    if (!["active", "resolved"].includes(b.status)) throw httpError(400, "Invalid status");
    db.prepare("UPDATE community_alerts SET status=?, escalated=? WHERE id=?").run(b.status, b.escalated ? 1 : 0, Number(m[1]));
    return { ok: true };
});

route("POST", "/api/feed", (m, b) => {
    if (!b.title || !b.category) throw httpError(400, "Missing fields");
    const r = db.prepare(
        "INSERT INTO feed_posts (title, description, category, event_status, time_label, created_at, created_by) VALUES (?,?,?,?,?,?,?)"
    ).run(str(b.title, 300), str(b.description), str(b.category, 50), str(b.event_status, 20) || "pending",
          str(b.time_label, 200), now(), str(b.created_by));
    return { id: Number(r.lastInsertRowid), created_at: now() };
});
route("PUT", "/api/feed/(\\d+)", (m, b) => {
    if (!["pending", "ongoing", "completed"].includes(b.event_status)) throw httpError(400, "Invalid status");
    db.prepare("UPDATE feed_posts SET event_status=? WHERE id=?").run(b.event_status, Number(m[1]));
    return { ok: true };
});

route("POST", "/api/aid", (m, b) => {
    if (!b.title || !b.description || !b.type || !b.category || !b.target_zone) throw httpError(400, "Missing fields");
    const r = db.prepare(
        "INSERT INTO aid_listings (title, description, type, category, target_zone, contact, status, created_at, created_by) VALUES (?,?,?,?,?,?, 'active', ?, ?)"
    ).run(str(b.title, 300), str(b.description), str(b.type, 20), str(b.category, 100), str(b.target_zone, 100),
          str(b.contact, 200), now(), str(b.created_by));
    return { id: Number(r.lastInsertRowid), created_at: now() };
});
route("PUT", "/api/aid/(\\d+)", (m, b) => {
    if (!["active", "fulfilled"].includes(b.status)) throw httpError(400, "Invalid status");
    db.prepare("UPDATE aid_listings SET status=? WHERE id=?").run(b.status, Number(m[1]));
    return { ok: true };
});

route("GET", "/api/export", () => {
    const out = { app: "BantayKoMunidad", version: 2, exportedAt: now(), tables: {} };
    for (const t of TABLES) out.tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    return { __download: "BantayKo-backup-" + now().slice(0, 10) + ".json", body: out };
});
route("POST", "/api/import", (m, b) => {
    if (b.app !== "BantayKoMunidad" || !b.tables) throw httpError(400, "Not a BantayKo backup file");
    tx(() => {
        for (const t of TABLES) {
            db.exec(`DELETE FROM ${t}`);
            const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
            for (const row of (b.tables[t] || [])) {
                const use = cols.filter(c => c in row);
                if (!use.length) continue;
                db.prepare(`INSERT INTO ${t} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`)
                  .run(...use.map(c => row[c]));
            }
        }
    });
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('initialized', ?)").run(now());
    return { ok: true };
});
route("POST", "/api/reset", () => {
    // empty every table, but remember the setup is done so demo data does NOT come back
    tx(() => { for (const t of TABLES.filter(t => t !== "meta")) db.exec(`DELETE FROM ${t}`); });
    return { ok: true };
});
route("POST", "/api/clear/([a-z_]+)", (m) => {
    const t = m[1];
    if (!TABLES.includes(t) || t === "meta") throw httpError(400, "Unknown table");
    db.exec(`DELETE FROM ${t}`);
    return { ok: true };
});

/* ---------------------------- HTTP SERVER ---------------------------- */
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

const MIME = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp" };

function send(res, status, data, headers = {}) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
    res.writeHead(status, { "Content-Length": body.length, ...headers });
    res.end(body);
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on("data", c => { size += c.length; if (size > 10 * 1024 * 1024) { reject(httpError(413, "Too large")); req.destroy(); } else chunks.push(c); });
        req.on("end", () => {
            if (!chunks.length) return resolve({});
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { reject(httpError(400, "Invalid JSON")); }
        });
        req.on("error", reject);
    });
}

const CORS = {
    "Access-Control-Allow-Origin": "*",          // lets the HTML work when opened directly as a file
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, "http://localhost");
        const pathname = url.pathname;

        if (req.method === "OPTIONS") return send(res, 204, "", CORS);

        if (pathname.startsWith("/api/")) {
            for (const r of routes) {
                const m = r.method === req.method && pathname.match(r.re);
                if (!m) continue;
                const body = (req.method === "POST" || req.method === "PUT") ? await readBody(req) : {};
                const result = r.handler(m, body);
                if (result && result.__download) {
                    return send(res, 200, JSON.stringify(result.body, null, 2), {
                        ...CORS, "Content-Type": "application/json",
                        "Content-Disposition": `attachment; filename="${result.__download}"`
                    });
                }
                return send(res, 200, result, { ...CORS, "Content-Type": "application/json" });
            }
            throw httpError(404, "Unknown API route");
        }

        // static files (only the HTML page and its images - never the .db or server files)
        let file = pathname === "/" ? HTML_FILE : decodeURIComponent(pathname.slice(1));
        const full = path.resolve(__dirname, file);
        const ext = path.extname(full).toLowerCase();
        if (!full.startsWith(__dirname + path.sep) || !MIME[ext] || !fs.existsSync(full)) throw httpError(404, "Not found");
        send(res, 200, fs.readFileSync(full), { "Content-Type": MIME[ext] });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error(err);
        send(res, status, { error: err.message }, { ...CORS, "Content-Type": "application/json" });
    }
}).listen(PORT, HOST, () => {
    console.log("==============================================");
    console.log(" BantayKo SQL database server is running");
    console.log(" Open this in Chrome or Edge:  http://localhost:" + PORT);
    console.log(" Database file: " + DB_FILE);
    console.log(" Keep this window open. Press Ctrl+C to stop.");
    console.log("==============================================");
});
