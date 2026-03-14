#!/usr/bin/env node
/**
 * Local PlanetScale HTTP proxy.
 *
 * Emulates the PlanetScale serverless API (/psdb.v1alpha1.Database/Execute)
 * on top of a local MySQL instance so @planetscale/database works in
 * wrangler dev without needing eval or a real PlanetScale connection.
 *
 * Usage:
 *   node scripts/ps-proxy.js
 *
 * Then set DATABASE_URL=http://root@localhost:3900/logingov_target in .dev.vars
 */

import { createServer } from "node:http";
import mysql from "mysql2/promise";

const MYSQL_CONFIG = {
  host: "localhost",
  user: "root",
  database: "logingov_target",
  port: 3306,
};

const PORT = 3900;

const pool = mysql.createPool(MYSQL_CONFIG);

/** Map MySQL field types to PlanetScale type names */
function mysqlTypeToPS(field) {
  // mysql2 field.type constants
  const map = {
    0: "DECIMAL",
    1: "INT8",      // TINY
    2: "INT16",     // SHORT
    3: "INT32",     // LONG
    4: "FLOAT32",
    5: "FLOAT64",
    6: "NULL",
    7: "TIMESTAMP",
    8: "INT64",     // LONGLONG
    9: "INT24",
    10: "DATE",
    11: "TIME",
    12: "DATETIME",
    13: "YEAR",
    15: "VARCHAR",
    16: "BIT",
    245: "JSON",
    246: "DECIMAL",
    249: "TEXT",     // TINYBLOB
    250: "TEXT",     // MEDIUMBLOB
    251: "TEXT",     // LONGBLOB
    252: "BLOB",
    253: "VARCHAR",  // VAR_STRING
    254: "CHAR",
  };
  return map[field.columnType] || "VARCHAR";
}

/**
 * Encode rows in the PlanetScale wire format:
 * Each row has { lengths: string[], values: base64(concatenated values) }
 */
function encodeRows(rows, columns) {
  return rows.map((row) => {
    let values = "";
    const lengths = columns.map((col) => {
      const val = row[col.name];
      if (val === null || val === undefined) return "-1";
      let str;
      if (val instanceof Date) {
        str = val.toISOString().replace("T", " ").replace("Z", "");
      } else {
        str = String(val);
      }
      values += str;
      return String(str.length);
    });
    return { lengths, values: btoa(values) };
  });
}

async function handleExecute(body) {
  const { query } = body;
  if (!query) {
    return { error: { message: "No query provided", code: "invalid" } };
  }

  try {
    const [rows, fields] = await pool.query(query);

    // DDL / DML without result set
    if (!Array.isArray(rows)) {
      return {
        session: body.session || null,
        result: {
          rowsAffected: String(rows.affectedRows ?? 0),
          insertId: String(rows.insertId ?? "0"),
          fields: [],
          rows: [],
        },
        timing: 0,
      };
    }

    const psFields = fields.map((f) => ({
      name: f.name,
      type: mysqlTypeToPS(f),
      table: f.table || "",
    }));

    return {
      session: body.session || null,
      result: {
        fields: psFields,
        rows: encodeRows(rows, fields),
        rowsAffected: "0",
        insertId: "0",
      },
      timing: 0,
    };
  } catch (err) {
    return {
      error: { message: err.message, code: err.code || "UNKNOWN" },
    };
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());

  let result;
  if (req.url.includes("/Execute")) {
    result = await handleExecute(body);
  } else if (req.url.includes("/CreateSession")) {
    result = { session: null };
  } else {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
});

server.listen(PORT, () => {
  console.log(`PlanetScale proxy listening on http://localhost:${PORT}`);
  console.log(`Proxying to MySQL: ${MYSQL_CONFIG.user}@${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`);
});
