/**
 * Migration Viewer — Dual-database browser for testing the Login.gov migration.
 *
 * Shows the PostgreSQL source DB and MySQL (PlanetScale) target DB side by side.
 * Usage: node server.js
 * Then open http://localhost:4321
 */

import { createServer } from "node:http";
import pg from "pg";
import mysql from "mysql2/promise";

const PORT = 4321;

// ── PostgreSQL (source) ──────────────────────────────────────
const pgPool = new pg.Pool({
  database: "logingov_source",
  host: "localhost",
  port: 5432,
});

// ── MySQL (target — PlanetScale stub) ────────────────────────
const mysqlPool = mysql.createPool({
  host: "localhost",
  user: "root",
  database: "logingov_target",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 5,
});

// ── API handlers ─────────────────────────────────────────────

const SOURCE_TABLES = [
  "users",
  "email_addresses",
  "passwords",
  "webauthn_configurations",
  "auth_app_configurations",
  "backup_code_configurations",
  "phone_configurations",
  "service_providers",
  "identities",
  "profiles",
  "events",
];

const TARGET_TABLES = [
  "users",
  "user_emails",
  "credentials",
  "service_providers",
  "auth_codes",
  "identity_events",
];

/** Query PostgreSQL source and return table summaries */
async function querySource() {
  const client = await pgPool.connect();
  try {
    const result = {};
    for (const table of SOURCE_TABLES) {
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS count FROM ${table}`
      );
      const rowsRes = await client.query(
        `SELECT * FROM ${table} ORDER BY id LIMIT 50`
      );
      result[table] = {
        count: countRes.rows[0].count,
        columns: rowsRes.fields.map((f) => f.name),
        rows: rowsRes.rows,
      };
    }
    return { ok: true, tables: result };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
}

/** Query MySQL target and return table summaries */
async function queryTarget() {
  let conn;
  try {
    conn = await mysqlPool.getConnection();
    const result = {};
    for (const table of TARGET_TABLES) {
      try {
        const [[countRow]] = await conn.query(
          `SELECT COUNT(*) AS count FROM \`${table}\``
        );
        // Determine ORDER BY column — use 'id' if available, else first column
        const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
        const columnNames = cols.map((c) => c.Field);
        const orderCol = columnNames.includes("id")
          ? "id"
          : columnNames.includes("code")
            ? "code"
            : columnNames[0];
        const [rows] = await conn.query(
          `SELECT * FROM \`${table}\` ORDER BY \`${orderCol}\` LIMIT 50`
        );
        result[table] = {
          count: Number(countRow.count),
          columns: columnNames,
          rows,
        };
      } catch (tableErr) {
        result[table] = {
          count: 0,
          columns: [],
          rows: [],
          error: tableErr.message,
        };
      }
    }
    return { ok: true, tables: result };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (conn) conn.release();
  }
}

// ── HTTP Server ──────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/source") {
    const data = await querySource();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  if (url.pathname === "/api/target") {
    const data = await queryTarget();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return;
  }

  if (url.pathname === "/database.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(DATABASE_HTML);
    return;
  }

  // Serve the HTML page
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log(`\n  Migration Viewer running at http://localhost:${PORT}\n`);
  console.log(`  Source: PostgreSQL  logingov_source @ localhost:5432`);
  console.log(`  Target: MySQL      logingov_target @ localhost:3306\n`);
});

// ── HTML Page ────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Login.gov — Migration Viewer</title>
  <style>
    :root {
      --navy: #112e51;
      --blue: #0071bc;
      --red: #e31c3d;
      --green: #2e8540;
      --gold: #fdb81e;
      --gray-lightest: #f1f1f1;
      --gray-light: #d6d7d9;
      --gray: #5b616b;
      --white: #fff;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --mono: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: var(--gray-lightest); color: #212121; }

    header {
      background: var(--navy); color: var(--white);
      padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem;
    }
    header h1 { font-size: 1.3rem; font-weight: 600; }
    .badge {
      padding: 0.2rem 0.6rem; border-radius: 4px;
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
    }
    .badge-gold { background: var(--gold); color: var(--navy); }

    .panels {
      display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
      padding: 1rem; max-width: 1800px; margin: 0 auto;
    }
    @media (max-width: 1000px) { .panels { grid-template-columns: 1fr; } }

    .panel {
      background: var(--white); border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1); overflow: hidden;
      display: flex; flex-direction: column;
    }
    .panel-header {
      padding: 0.75rem 1rem; display: flex; align-items: center;
      justify-content: space-between; gap: 0.5rem; flex-shrink: 0;
    }
    .panel-header h2 { font-size: 0.95rem; }
    .panel-header .subtitle { font-size: 0.7rem; font-weight: 400; }

    .panel-source .panel-header { background: #1b4332; color: var(--white); }
    .panel-target .panel-header { background: #1a237e; color: var(--white); }
    .panel-source .panel-header .subtitle { color: #95d5b2; }
    .panel-target .panel-header .subtitle { color: #9fa8da; }

    .panel-body {
      padding: 0.75rem; overflow-y: auto; max-height: calc(100vh - 140px);
      flex: 1;
    }

    button {
      font-family: var(--font); font-size: 0.75rem; font-weight: 600;
      padding: 0.4rem 0.75rem; border: none; border-radius: 4px;
      cursor: pointer; transition: all 0.15s;
    }
    button:hover { opacity: 0.85; }
    .btn-refresh { background: rgba(255,255,255,0.2); color: var(--white); }
    .btn-refresh:hover { background: rgba(255,255,255,0.3); }
    .btn-refresh.loading { opacity: 0.5; cursor: wait; }

    .table-section { margin-bottom: 1rem; }
    .table-section summary {
      cursor: pointer; font-size: 0.8rem; font-weight: 600;
      padding: 0.5rem 0.75rem; background: var(--gray-lightest);
      border-radius: 4px; display: flex; align-items: center; gap: 0.5rem;
      user-select: none; list-style: none;
    }
    .table-section summary::-webkit-details-summary-arrow,
    .table-section summary::marker { display: none; content: ''; }
    .table-section summary .arrow { transition: transform 0.15s; font-size: 0.6rem; }
    .table-section[open] summary .arrow { transform: rotate(90deg); }
    .table-section summary .count {
      margin-left: auto; padding: 0.1rem 0.5rem; border-radius: 10px;
      font-size: 0.7rem; color: var(--white);
    }
    .panel-source .table-section summary .count { background: #1b4332; }
    .panel-target .table-section summary .count { background: #1a237e; }

    table {
      width: 100%; border-collapse: collapse; font-size: 0.7rem;
      margin-top: 0.5rem;
    }
    th {
      text-align: left; padding: 0.4rem 0.5rem;
      color: var(--white);
      font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em;
      position: sticky; top: 0; white-space: nowrap;
    }
    .panel-source th { background: #1b4332; }
    .panel-target th { background: #1a237e; }
    td {
      padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--gray-light);
      max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: var(--mono); font-size: 0.65rem;
    }
    tr:hover td { background: #f7f7ff; }

    .empty-state {
      text-align: center; padding: 2rem; color: var(--gray);
      font-size: 0.85rem;
    }
    .empty-state .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .error-state { color: var(--red); }

    .stats {
      display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem;
    }
    .stat {
      background: var(--gray-lightest); padding: 0.4rem 0.75rem;
      border-radius: 4px; font-size: 0.7rem;
    }
    .stat strong { font-size: 1.1rem; display: block; }

    .loading-spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: var(--white);
      border-radius: 50%; animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <header>
    <h1>Login.gov Migration Viewer</h1>
    <span class="badge badge-gold">Dev Tool</span>
    <nav style="margin-left:auto;display:flex;gap:0.5rem">
      <a href="/" style="color:var(--white);text-decoration:none;font-size:0.75rem;padding:0.35rem 0.75rem;border-radius:4px;background:rgba(255,255,255,0.15);font-weight:600">Data Viewer</a>
      <a href="/database.html" style="color:var(--white);text-decoration:none;font-size:0.75rem;padding:0.35rem 0.75rem;border-radius:4px;background:rgba(255,255,255,0.15);font-weight:600">Schema Map</a>
    </nav>
  </header>

  <div class="panels">
    <!-- Source (PostgreSQL) -->
    <div class="panel panel-source">
      <div class="panel-header">
        <div>
          <h2>Source Database</h2>
          <div class="subtitle">PostgreSQL &middot; logingov_source</div>
        </div>
        <button class="btn-refresh" onclick="loadSource()" id="btn-source">
          Refresh
        </button>
      </div>
      <div class="panel-body" id="source-body">
        <div class="empty-state"><div class="icon">&#9881;</div>Click Refresh to load</div>
      </div>
    </div>

    <!-- Target (MySQL / PlanetScale) -->
    <div class="panel panel-target">
      <div class="panel-header">
        <div>
          <h2>Target Database</h2>
          <div class="subtitle">MySQL (PlanetScale) &middot; logingov_target</div>
        </div>
        <button class="btn-refresh" onclick="loadTarget()" id="btn-target">
          Refresh
        </button>
      </div>
      <div class="panel-body" id="target-body">
        <div class="empty-state"><div class="icon">&#9881;</div>Click Refresh to load</div>
      </div>
    </div>
  </div>

  <script>
    function escapeHtml(str) {
      if (str == null) return '<span style="color:#aaa">NULL</span>';
      const s = typeof str === 'object' ? JSON.stringify(str) : String(str);
      if (s.length > 80) return s.slice(0, 77).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '&hellip;';
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    function renderData(data, panelId) {
      const body = document.getElementById(panelId);

      if (!data.ok) {
        body.innerHTML = '<div class="empty-state error-state"><div class="icon">&#9888;</div>' + escapeHtml(data.error) + '</div>';
        return;
      }

      const tables = data.tables;
      const tableNames = Object.keys(tables);
      const totalRows = tableNames.reduce((sum, t) => sum + tables[t].count, 0);

      let html = '<div class="stats">';
      html += '<div class="stat"><strong>' + totalRows + '</strong>total rows</div>';
      html += '<div class="stat"><strong>' + tableNames.length + '</strong>tables</div>';
      html += '</div>';

      for (const name of tableNames) {
        const t = tables[name];
        if (t.error) {
          html += '<details class="table-section"><summary><span class="arrow">&#9654;</span> ' + name + ' <span style="color:var(--red);font-size:0.7rem">(error)</span><span class="count">0</span></summary>';
          html += '<div style="padding:0.5rem;color:var(--red);font-size:0.75rem">' + escapeHtml(t.error) + '</div></details>';
          continue;
        }

        const open = t.count > 0 && t.count <= 10 ? ' open' : '';
        html += '<details class="table-section"' + open + '><summary>';
        html += '<span class="arrow">&#9654;</span> ' + name;
        html += '<span class="count">' + t.count + '</span></summary>';

        if (t.rows.length === 0) {
          html += '<div style="padding:0.75rem;color:var(--gray);font-size:0.75rem;font-style:italic">Empty table</div>';
        } else {
          html += '<div style="overflow-x:auto"><table><thead><tr>';
          for (const col of t.columns) {
            html += '<th>' + col + '</th>';
          }
          html += '</tr></thead><tbody>';
          for (const row of t.rows) {
            html += '<tr>';
            for (const col of t.columns) {
              const val = row[col];
              const valStr = val != null && typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
              html += '<td title="' + valStr.replace(/"/g, '&quot;').slice(0, 300) + '">' + escapeHtml(val) + '</td>';
            }
            html += '</tr>';
          }
          html += '</tbody></table></div>';
        }

        if (t.count > t.rows.length) {
          html += '<div style="padding:0.4rem 0.75rem;font-size:0.65rem;color:var(--gray)">Showing ' + t.rows.length + ' of ' + t.count + ' rows</div>';
        }

        html += '</details>';
      }

      body.innerHTML = html;
    }

    async function loadSource() {
      const btn = document.getElementById('btn-source');
      btn.classList.add('loading');
      btn.innerHTML = '<span class="loading-spinner"></span>';
      try {
        const res = await fetch('/api/source');
        const data = await res.json();
        renderData(data, 'source-body');
      } catch (err) {
        renderData({ ok: false, error: err.message }, 'source-body');
      }
      btn.classList.remove('loading');
      btn.textContent = 'Refresh';
    }

    async function loadTarget() {
      const btn = document.getElementById('btn-target');
      btn.classList.add('loading');
      btn.innerHTML = '<span class="loading-spinner"></span>';
      try {
        const res = await fetch('/api/target');
        const data = await res.json();
        renderData(data, 'target-body');
      } catch (err) {
        renderData({ ok: false, error: err.message }, 'target-body');
      }
      btn.classList.remove('loading');
      btn.textContent = 'Refresh';
    }

    // Auto-load both on page load
    loadSource();
    loadTarget();
  </script>
</body>
</html>`;

// ── Schema Mapping Page ──────────────────────────────────────

const DATABASE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Login.gov — Schema Mapping</title>
  <style>
    :root {
      --navy: #112e51;
      --blue: #0071bc;
      --red: #e31c3d;
      --green: #2e8540;
      --gold: #fdb81e;
      --orange: #e27600;
      --gray-lightest: #f1f1f1;
      --gray-light: #d6d7d9;
      --gray: #5b616b;
      --white: #fff;
      --source: #1b4332;
      --target: #1a237e;
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --mono: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); background: var(--gray-lightest); color: #212121; }

    header {
      background: var(--navy); color: var(--white);
      padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem;
    }
    header h1 { font-size: 1.3rem; font-weight: 600; }
    header nav { margin-left: auto; display: flex; gap: 0.5rem; }
    header nav a {
      color: var(--white); text-decoration: none; font-size: 0.75rem;
      padding: 0.35rem 0.75rem; border-radius: 4px;
      background: rgba(255,255,255,0.15); font-weight: 600;
    }
    header nav a:hover { background: rgba(255,255,255,0.25); }
    .badge {
      padding: 0.2rem 0.6rem; border-radius: 4px;
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
    }
    .badge-gold { background: var(--gold); color: var(--navy); }

    .container { max-width: 1400px; margin: 0 auto; padding: 1.5rem; }

    .legend {
      display: flex; gap: 1.5rem; flex-wrap: wrap;
      margin-bottom: 1.5rem; font-size: 0.75rem; align-items: center;
    }
    .legend-item { display: flex; align-items: center; gap: 0.4rem; }
    .legend-dot {
      width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0;
    }

    .mapping-group {
      background: var(--white); border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      margin-bottom: 1.5rem; overflow: hidden;
    }
    .mapping-group-header {
      padding: 0.75rem 1rem; font-size: 0.85rem; font-weight: 700;
      display: flex; align-items: center; gap: 0.75rem;
      background: var(--navy); color: var(--white);
    }
    .mapping-group-header .step {
      background: var(--gold); color: var(--navy);
      padding: 0.15rem 0.5rem; border-radius: 4px;
      font-size: 0.65rem; font-weight: 800;
    }
    .mapping-group-header .note {
      margin-left: auto; font-weight: 400; font-size: 0.7rem;
      opacity: 0.7;
    }

    .mapping-body { padding: 1rem; }

    .schema-row {
      display: grid; grid-template-columns: 1fr 60px 1fr;
      gap: 0; align-items: stretch; margin-bottom: 2px;
    }
    .schema-row:last-child { margin-bottom: 0; }

    .col-source, .col-target {
      font-family: var(--mono); font-size: 0.75rem;
      padding: 0.4rem 0.75rem; display: flex; align-items: center; gap: 0.5rem;
      border-radius: 4px;
    }
    .col-source {
      background: #e8f5e9; justify-content: flex-end; text-align: right;
    }
    .col-target {
      background: #e8eaf6; text-align: left;
    }
    .col-source.table-name {
      background: var(--source); color: var(--white);
      font-weight: 700; font-size: 0.8rem; border-radius: 4px 4px 0 0;
    }
    .col-target.table-name {
      background: var(--target); color: var(--white);
      font-weight: 700; font-size: 0.8rem; border-radius: 4px 4px 0 0;
    }
    .col-source.multi-source {
      background: #c8e6c9; font-style: italic; font-size: 0.7rem;
    }

    .col-arrow {
      display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem; color: var(--gray); min-height: 32px;
    }

    .col-type {
      font-size: 0.6rem; color: var(--gray); font-family: var(--font);
      margin-left: 0.25rem;
    }
    .col-source .col-type { margin-left: 0; margin-right: 0.25rem; }

    .transform-tag {
      font-family: var(--font); font-size: 0.55rem; font-weight: 700;
      padding: 0.1rem 0.35rem; border-radius: 3px; text-transform: uppercase;
      letter-spacing: 0.03em; white-space: nowrap;
    }
    .tag-direct { background: #c8e6c9; color: #1b5e20; }
    .tag-rename { background: #fff3e0; color: #e65100; }
    .tag-transform { background: #e3f2fd; color: #0d47a1; }
    .tag-generate { background: #f3e5f5; color: #6a1b9a; }
    .tag-encrypt { background: #fce4ec; color: #b71c1c; }
    .tag-merge { background: #fff9c4; color: #f57f17; }
    .tag-drop { background: #efebe9; color: #795548; }
    .tag-json { background: #e0f7fa; color: #006064; }

    .col-empty {
      background: transparent;
    }

    .not-migrated {
      padding: 0.5rem 0.75rem; font-size: 0.75rem; color: var(--gray);
      font-style: italic;
    }

    .merge-label {
      grid-column: 1 / -1; padding: 0.4rem 0.75rem;
      font-size: 0.7rem; color: var(--gray); font-style: italic;
      background: #fffde7; border-left: 3px solid var(--gold);
      margin: 0.25rem 0;
    }

    .separator {
      grid-column: 1 / -1; height: 1px;
      background: var(--gray-light); margin: 0.5rem 0;
    }

    .info-box {
      background: #e3f2fd; border-left: 3px solid var(--blue);
      padding: 0.6rem 0.75rem; font-size: 0.7rem; color: #0d47a1;
      margin-top: 0.75rem; border-radius: 0 4px 4px 0;
      line-height: 1.5;
    }

    .tables-not-migrated {
      background: var(--white); border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      padding: 1rem; margin-bottom: 1.5rem;
    }
    .tables-not-migrated h3 {
      font-size: 0.85rem; margin-bottom: 0.5rem; color: var(--gray);
    }
    .skip-list {
      display: flex; gap: 0.5rem; flex-wrap: wrap;
    }
    .skip-item {
      font-family: var(--mono); font-size: 0.7rem;
      background: #efebe9; padding: 0.3rem 0.6rem; border-radius: 4px;
      color: #795548;
    }
  </style>
</head>
<body>
  <header>
    <h1>Schema Mapping</h1>
    <span class="badge badge-gold">Dev Tool</span>
    <nav>
      <a href="/">Data Viewer</a>
      <a href="/database.html">Schema Map</a>
    </nav>
  </header>

  <div class="container">
    <div class="legend">
      <strong style="font-size:0.8rem">Transform types:</strong>
      <div class="legend-item"><span class="transform-tag tag-direct">direct</span> Column copied as-is</div>
      <div class="legend-item"><span class="transform-tag tag-rename">rename</span> Column renamed</div>
      <div class="legend-item"><span class="transform-tag tag-transform">transform</span> Value converted</div>
      <div class="legend-item"><span class="transform-tag tag-generate">generate</span> New value created</div>
      <div class="legend-item"><span class="transform-tag tag-encrypt">re-encrypt</span> Decrypt &amp; re-encrypt</div>
      <div class="legend-item"><span class="transform-tag tag-merge">merge</span> Multiple sources combined</div>
      <div class="legend-item"><span class="transform-tag tag-json">json</span> Packed into JSON blob</div>
      <div class="legend-item"><span class="transform-tag tag-drop">drop</span> Not migrated</div>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- 1a. users -->
    <!-- ════════════════════════════════════════════════════════ -->
    <div class="mapping-group">
      <div class="mapping-group-header">
        <span class="step">1a</span>
        users + profiles + phone_configurations &rarr; users
        <span class="note">3 source tables merge into 1</span>
      </div>
      <div class="mapping-body">
        <div class="schema-row">
          <div class="col-source table-name">users <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name">users <span class="col-type">MySQL</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">id <span class="col-type">BIGINT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">id <span class="col-type">VARCHAR(36)</span></div>
        </div>
        <div class="info-box">Old integer ID &rarr; new UUID v7 (timestamp-ordered). Old ID stored in mapping table for FK resolution.</div>

        <div class="schema-row">
          <div class="col-source">email <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">email <span class="col-type">VARCHAR(255)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">confirmed_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">email_verified_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">ial <span class="col-type">INTEGER</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">ial <span class="col-type">INT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">locked_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">locked_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">locale <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">locale <span class="col-type">VARCHAR(10)</span></div>
        </div>

        <div class="separator"></div>
        <div class="merge-label">The following target columns are populated from the <strong>profiles</strong> table (IAL2 verified users):</div>

        <div class="schema-row">
          <div class="col-source multi-source">profiles.encrypted_pii <span class="col-type">TEXT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-encrypt">re-encrypt</span></div>
          <div class="col-target">ssn <span class="col-type">TEXT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source multi-source">profiles.encrypted_pii <span class="col-type">TEXT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-encrypt">re-encrypt</span></div>
          <div class="col-target">birthdate <span class="col-type">TEXT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source multi-source">profiles.encrypted_pii <span class="col-type">TEXT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-encrypt">re-encrypt</span></div>
          <div class="col-target">address <span class="col-type">TEXT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source multi-source">profiles.verified_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">verified_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="separator"></div>
        <div class="merge-label">Phone is populated from the <strong>phone_configurations</strong> table:</div>

        <div class="schema-row">
          <div class="col-source multi-source">phone_configurations.encrypted_phone <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-encrypt">re-encrypt</span></div>
          <div class="col-target">phone <span class="col-type">TEXT</span></div>
        </div>

        <div class="separator"></div>

        <div class="schema-row">
          <div class="col-source">created_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">created_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">updated_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">updated_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="separator"></div>
        <div class="not-migrated">
          Dropped: <code>uuid</code> (superseded by UUID v7), <code>encrypted_email</code> / <code>encrypted_email_iv</code> (plaintext email used instead), <code>otp_required_for_login</code> (derived from credentials)
        </div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- 1b. email_addresses -->
    <!-- ════════════════════════════════════════════════════════ -->
    <div class="mapping-group">
      <div class="mapping-group-header">
        <span class="step">1b</span>
        email_addresses &rarr; user_emails
      </div>
      <div class="mapping-body">
        <div class="schema-row">
          <div class="col-source table-name">email_addresses <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name">user_emails <span class="col-type">MySQL</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">id <span class="col-type">BIGINT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">id <span class="col-type">VARCHAR(36)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">user_id <span class="col-type">BIGINT FK</span></div>
          <div class="col-arrow"><span class="transform-tag tag-transform">transform</span></div>
          <div class="col-target">user_id <span class="col-type">VARCHAR(36)</span></div>
        </div>
        <div class="info-box">Resolved via ID mapping table: old integer FK &rarr; new UUID v7</div>

        <div class="schema-row">
          <div class="col-source">email <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">address <span class="col-type">VARCHAR(255)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">is_primary <span class="col-type">BOOLEAN</span></div>
          <div class="col-arrow"><span class="transform-tag tag-transform">transform</span></div>
          <div class="col-target">is_primary <span class="col-type">BOOLEAN</span></div>
        </div>
        <div class="info-box">PostgreSQL BOOLEAN (true/false) &rarr; MySQL BOOLEAN</div>

        <div class="schema-row">
          <div class="col-source">confirmed_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">verified_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">created_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">created_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="separator"></div>
        <div class="not-migrated">
          Dropped: <code>encrypted_email</code> / <code>encrypted_email_iv</code>, <code>updated_at</code>
        </div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- 1c. credentials (merged from 4 tables) -->
    <!-- ════════════════════════════════════════════════════════ -->
    <div class="mapping-group">
      <div class="mapping-group-header">
        <span class="step">1c</span>
        passwords + webauthn + totp + backup &rarr; credentials
        <span class="note">4 source tables &rarr; 1 unified table</span>
      </div>
      <div class="mapping-body">
        <div class="schema-row">
          <div class="col-source table-name">passwords <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name">credentials <span class="col-type">MySQL</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">id <span class="col-type">BIGINT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">id <span class="col-type">VARCHAR(36)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">user_id <span class="col-type">BIGINT FK</span></div>
          <div class="col-arrow"><span class="transform-tag tag-transform">transform</span></div>
          <div class="col-target">user_id <span class="col-type">VARCHAR(36)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">type = "password" <span class="col-type">VARCHAR(20)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">encrypted_password <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-json">json</span></div>
          <div class="col-target">data <span class="col-type">TEXT</span></div>
        </div>
        <div class="info-box">Packed into JSON: <code>{"hash": "$2a$12$...", "algorithm": "bcrypt", "needsRehash": true}</code><br>On next login, the hash is verified and re-hashed with the preferred algorithm.</div>

        <div class="schema-row">
          <div class="col-source">created_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">created_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="separator"></div>

        <div class="schema-row">
          <div class="col-source table-name">webauthn_configurations <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name" style="opacity:0.5">credentials <span class="col-type">(same table)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">type = "webauthn" <span class="col-type">VARCHAR(20)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">credential_id <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow" style="grid-row: span 4"><span class="transform-tag tag-json">json</span></div>
          <div class="col-target" style="grid-row: span 4">data <span class="col-type">TEXT</span></div>
        </div>
        <div class="schema-row">
          <div class="col-source">credential_public_key <span class="col-type">TEXT</span></div>
        </div>
        <div class="schema-row">
          <div class="col-source">name <span class="col-type">VARCHAR</span></div>
        </div>
        <div class="schema-row">
          <div class="col-source">transports <span class="col-type">TEXT</span></div>
        </div>
        <div class="info-box">All WebAuthn fields packed into JSON: <code>{"credentialId", "publicKey", "name", "signCount", "transports"}</code></div>

        <div class="separator"></div>

        <div class="schema-row">
          <div class="col-source table-name">auth_app_configurations <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name" style="opacity:0.5">credentials <span class="col-type">(same table)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">type = "totp" <span class="col-type">VARCHAR(20)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">otp_secret_key <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-encrypt">re-encrypt</span></div>
          <div class="col-target" rowspan="2">data <span class="col-type">TEXT</span></div>
        </div>
        <div class="info-box">Decrypt TOTP secret with Rails key, re-encrypt with new key, pack as JSON: <code>{"secret": "...", "name": "Google Authenticator"}</code></div>

        <div class="separator"></div>

        <div class="schema-row">
          <div class="col-source table-name">backup_code_configurations <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name" style="opacity:0.5">credentials <span class="col-type">(same table)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">type = "backup" <span class="col-type">VARCHAR(20)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">codes <span class="col-type">TEXT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-encrypt">re-encrypt</span></div>
          <div class="col-target">data <span class="col-type">TEXT</span></div>
        </div>
        <div class="info-box">Decrypt backup codes, re-encrypt, pack as JSON: <code>{"codes": "...", "usedCount": 2}</code></div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- 1d. service_providers -->
    <!-- ════════════════════════════════════════════════════════ -->
    <div class="mapping-group">
      <div class="mapping-group-header">
        <span class="step">1d</span>
        service_providers &rarr; service_providers
      </div>
      <div class="mapping-body">
        <div class="schema-row">
          <div class="col-source table-name">service_providers <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name">service_providers <span class="col-type">MySQL</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">issuer <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">id <span class="col-type">VARCHAR(255)</span></div>
        </div>
        <div class="info-box">The issuer URI becomes the primary key (e.g., <code>urn:gov:gsa:....:dhs:cbp-portal</code>)</div>

        <div class="schema-row">
          <div class="col-source">friendly_name <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">name <span class="col-type">VARCHAR(255)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">ial <span class="col-type">INTEGER</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">ial_max <span class="col-type">INT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">default_aal <span class="col-type">INTEGER</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">aal_max <span class="col-type">INT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">redirect_uris <span class="col-type">TEXT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">redirect_uris <span class="col-type">TEXT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">cert <span class="col-type">TEXT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-rename">rename</span></div>
          <div class="col-target">public_key <span class="col-type">TEXT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">created_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">created_at <span class="col-type">VARCHAR(30)</span></div>
        </div>

        <div class="separator"></div>
        <div class="not-migrated">
          Dropped: <code>id</code> (integer PK, replaced by issuer), <code>agency</code><br>
          New nullable columns: <code>saml_metadata_url</code>, <code>push_notification_url</code>, <code>post_logout_redirect_uris</code>
        </div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- 1e. events -->
    <!-- ════════════════════════════════════════════════════════ -->
    <div class="mapping-group">
      <div class="mapping-group-header">
        <span class="step">1e</span>
        events &rarr; identity_events
      </div>
      <div class="mapping-body">
        <div class="schema-row">
          <div class="col-source table-name">events <span class="col-type">PostgreSQL</span></div>
          <div class="col-arrow"></div>
          <div class="col-target table-name">identity_events <span class="col-type">MySQL</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">id <span class="col-type">BIGINT</span></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">id <span class="col-type">VARCHAR(36)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source">user_id <span class="col-type">BIGINT FK</span></div>
          <div class="col-arrow"><span class="transform-tag tag-transform">transform</span></div>
          <div class="col-target">user_id <span class="col-type">VARCHAR(36)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">sp_id <span class="col-type">VARCHAR(255)</span></div>
        </div>
        <div class="info-box">Source events table has no SP linkage &mdash; set to NULL. Could be enriched from identities table in a future pass.</div>

        <div class="schema-row">
          <div class="col-source">event_type <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">event_type <span class="col-type">VARCHAR(100)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">ial <span class="col-type">INT</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">aal <span class="col-type">INT</span></div>
        </div>
        <div class="info-box">IAL/AAL not tracked per-event in the source &mdash; set to NULL. Could be inferred from event_type in a future enrichment step.</div>

        <div class="schema-row">
          <div class="col-source">ip <span class="col-type">VARCHAR</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">ip <span class="col-type">VARCHAR(45)</span></div>
        </div>

        <div class="schema-row">
          <div class="col-source col-empty"></div>
          <div class="col-arrow"><span class="transform-tag tag-generate">generate</span></div>
          <div class="col-target">metadata <span class="col-type">TEXT</span></div>
        </div>
        <div class="info-box">Source events have no structured metadata &mdash; set to empty <code>{}</code></div>

        <div class="schema-row">
          <div class="col-source">created_at <span class="col-type">TIMESTAMP</span></div>
          <div class="col-arrow"><span class="transform-tag tag-direct">direct</span></div>
          <div class="col-target">created_at <span class="col-type">VARCHAR(30)</span></div>
        </div>
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- Tables NOT migrated -->
    <!-- ════════════════════════════════════════════════════════ -->
    <div class="tables-not-migrated">
      <h3>Source tables not migrated</h3>
      <div class="skip-list">
        <div class="skip-item">identities &mdash; user&harr;SP linkages rebuilt at runtime on next login</div>
      </div>
      <h3 style="margin-top:0.75rem">Target tables not populated by migration</h3>
      <div class="skip-list">
        <div class="skip-item">auth_codes &mdash; ephemeral, created at runtime</div>
      </div>
    </div>

  </div>
</body>
</html>`;
