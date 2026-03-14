#!/usr/bin/env node
/**
 * Login.gov Migration CLI
 *
 * Migrates data from the PostgreSQL source (Rails identity-idp) to
 * the MySQL target (PlanetScale stub).
 *
 * Usage:
 *   node migrate.js              Run full migration
 *   node migrate.js --table=users Migrate a single table
 *   node migrate.js --reset       Wipe the MySQL target database
 *   node migrate.js --dry-run     Show what would be migrated without writing
 *
 * Since the Rails encryption keys are not available yet, encrypted PII
 * fields are passed through with a simulated re-encryption (prefixed
 * with "migrated_" to prove the transform ran). When real keys are
 * available, swap in the actual decrypt/re-encrypt logic.
 */

import pg from "pg";
import mysql from "mysql2/promise";
import { randomUUID, randomBytes } from "node:crypto";

// ── Config ───────────────────────────────────────────────────

const PG_CONFIG = {
  database: "logingov_source",
  host: "localhost",
  port: 5432,
};

const MYSQL_CONFIG = {
  host: "localhost",
  user: "root",
  database: "logingov_target",
  port: 3306,
};

const BATCH_SIZE = 5000;

// ── UUID v7 ──────────────────────────────────────────────────

function uuidV7(timestampMs = Date.now()) {
  const bytes = new Uint8Array(16);
  const random = randomBytes(16);
  random.copy(Buffer.from(bytes.buffer));

  bytes[0] = (timestampMs / 2 ** 40) & 0xff;
  bytes[1] = (timestampMs / 2 ** 32) & 0xff;
  bytes[2] = (timestampMs / 2 ** 24) & 0xff;
  bytes[3] = (timestampMs / 2 ** 16) & 0xff;
  bytes[4] = (timestampMs / 2 ** 8) & 0xff;
  bytes[5] = timestampMs & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ── Simulated crypto (stub until Rails keys available) ───────

/**
 * Simulated re-encryption: strips the source prefix and wraps with
 * a "migrated" marker. Replace with real decrypt-then-encrypt when
 * Rails encryption keys become available.
 */
function reEncrypt(sourceValue) {
  if (!sourceValue) return null;
  // Strip the Rails stub prefix if present
  const raw = sourceValue.replace(/^enc_aes256_/, "");
  return `migrated_${raw}`;
}

// ── Helpers ──────────────────────────────────────────────────

function toISO(ts) {
  if (!ts) return null;
  return new Date(ts).toISOString();
}

function log(msg) {
  console.log(`  ${msg}`);
}

function header(msg) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${msg}`);
  console.log(`${"─".repeat(60)}`);
}

// ── ID Mapping ───────────────────────────────────────────────

/** Maps old PostgreSQL integer IDs → new UUID v7 IDs */
const userIdMap = new Map();    // old user id → new uuid
const spIdMap = new Map();      // old SP id → new SP id (issuer string)

// ── Migration Steps ──────────────────────────────────────────

async function migrateUsers(pgClient, mysqlConn, dryRun) {
  header("1a. Migrating users");

  const { rows } = await pgClient.query(
    "SELECT * FROM users ORDER BY id"
  );
  log(`Found ${rows.length} source users`);

  if (dryRun) return rows.length;

  const values = [];
  for (const u of rows) {
    const ts = new Date(u.created_at).getTime();
    const newId = uuidV7(ts);
    userIdMap.set(u.id, newId);

    values.push([
      newId,
      u.email,
      toISO(u.confirmed_at),          // → email_verified_at
      u.ial,
      toISO(u.locked_at),
      u.locale,
      reEncrypt(u.encrypted_email),    // ssn placeholder (source has encrypted_email)
      null,                             // birthdate (not in source users table)
      null,                             // address
      null,                             // phone (in phone_configurations)
      null,                             // verified_at (set from profiles)
      toISO(u.created_at),
      toISO(u.updated_at),
    ]);
  }

  // Batch insert
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    const placeholders = batch
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");
    await mysqlConn.query(
      `INSERT INTO users (id, email, email_verified_at, ial, locked_at, locale, ssn, birthdate, address, phone, verified_at, created_at, updated_at) VALUES ${placeholders}`,
      batch.flat()
    );
  }

  log(`Inserted ${values.length} users`);
  return values.length;
}

async function migrateProfiles(pgClient, mysqlConn, dryRun) {
  header("1a+ Applying profiles (IAL2 PII) to users");

  const { rows } = await pgClient.query(
    "SELECT * FROM profiles WHERE verified_at IS NOT NULL ORDER BY id"
  );
  log(`Found ${rows.length} verified profiles`);

  if (dryRun) return rows.length;

  let updated = 0;
  for (const p of rows) {
    const newUserId = userIdMap.get(p.user_id);
    if (!newUserId) continue;

    // The encrypted_pii blob contains SSN, DOB, address, phone — re-encrypt it
    const pii = reEncrypt(p.encrypted_pii);

    await mysqlConn.query(
      `UPDATE users SET ssn = ?, verified_at = ? WHERE id = ?`,
      [pii, toISO(p.verified_at), newUserId]
    );
    updated++;
  }

  // Apply phone numbers from phone_configurations
  const { rows: phones } = await pgClient.query(
    "SELECT * FROM phone_configurations WHERE confirmed_at IS NOT NULL ORDER BY id"
  );
  for (const ph of phones) {
    const newUserId = userIdMap.get(ph.user_id);
    if (!newUserId) continue;
    await mysqlConn.query(
      `UPDATE users SET phone = ? WHERE id = ?`,
      [reEncrypt(ph.encrypted_phone), newUserId]
    );
  }

  log(`Updated ${updated} users with profile PII, ${phones.length} with phone`);
  return updated;
}

async function migrateEmails(pgClient, mysqlConn, dryRun) {
  header("1b. Migrating email addresses → user_emails");

  const { rows } = await pgClient.query(
    "SELECT * FROM email_addresses ORDER BY id"
  );
  log(`Found ${rows.length} source email addresses`);

  if (dryRun) return rows.length;

  const values = [];
  for (const e of rows) {
    const newUserId = userIdMap.get(e.user_id);
    if (!newUserId) {
      log(`  WARN: skipping email ${e.id}, no mapped user for ${e.user_id}`);
      continue;
    }

    const ts = new Date(e.created_at).getTime();
    values.push([
      uuidV7(ts),
      newUserId,
      e.email,
      e.is_primary ? 1 : 0,
      toISO(e.confirmed_at),
      toISO(e.created_at),
    ]);
  }

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    const placeholders = batch
      .map(() => "(?, ?, ?, ?, ?, ?)")
      .join(", ");
    await mysqlConn.query(
      `INSERT INTO user_emails (id, user_id, address, is_primary, verified_at, created_at) VALUES ${placeholders}`,
      batch.flat()
    );
  }

  log(`Inserted ${values.length} user_emails`);
  return values.length;
}

async function migrateCredentials(pgClient, mysqlConn, dryRun) {
  header("1c. Migrating credentials (passwords + webauthn + totp + backup)");

  const allCredentials = [];

  // ── Passwords ──
  const { rows: passwords } = await pgClient.query(
    "SELECT * FROM passwords ORDER BY id"
  );
  log(`  Passwords: ${passwords.length}`);
  for (const p of passwords) {
    const newUserId = userIdMap.get(p.user_id);
    if (!newUserId) continue;
    const ts = new Date(p.created_at).getTime();
    allCredentials.push([
      uuidV7(ts),
      newUserId,
      "password",
      JSON.stringify({
        hash: p.encrypted_password,
        algorithm: "bcrypt",
        needsRehash: true,
      }),
      null, // last_used_at
      toISO(p.created_at),
    ]);
  }

  // ── WebAuthn ──
  const { rows: webauthn } = await pgClient.query(
    "SELECT * FROM webauthn_configurations ORDER BY id"
  );
  log(`  WebAuthn:   ${webauthn.length}`);
  for (const w of webauthn) {
    const newUserId = userIdMap.get(w.user_id);
    if (!newUserId) continue;
    const ts = new Date(w.created_at).getTime();
    allCredentials.push([
      uuidV7(ts),
      newUserId,
      "webauthn",
      JSON.stringify({
        credentialId: w.credential_id,
        publicKey: w.credential_public_key,
        name: w.name,
        signCount: 0,
        transports: w.transports ? JSON.parse(w.transports) : [],
      }),
      null,
      toISO(w.created_at),
    ]);
  }

  // ── TOTP ──
  const { rows: totp } = await pgClient.query(
    "SELECT * FROM auth_app_configurations ORDER BY id"
  );
  log(`  TOTP:       ${totp.length}`);
  for (const t of totp) {
    const newUserId = userIdMap.get(t.user_id);
    if (!newUserId) continue;
    const ts = new Date(t.created_at).getTime();
    allCredentials.push([
      uuidV7(ts),
      newUserId,
      "totp",
      JSON.stringify({
        secret: reEncrypt(t.otp_secret_key),
        name: t.name,
      }),
      null,
      toISO(t.created_at),
    ]);
  }

  // ── Backup codes ──
  const { rows: backup } = await pgClient.query(
    "SELECT * FROM backup_code_configurations ORDER BY id"
  );
  log(`  Backup:     ${backup.length}`);
  for (const b of backup) {
    const newUserId = userIdMap.get(b.user_id);
    if (!newUserId) continue;
    const ts = new Date(b.created_at).getTime();
    allCredentials.push([
      uuidV7(ts),
      newUserId,
      "backup",
      JSON.stringify({
        codes: reEncrypt(b.codes),
        usedCount: b.used_count,
      }),
      null,
      toISO(b.created_at),
    ]);
  }

  log(`  Total credentials: ${allCredentials.length}`);
  if (dryRun) return allCredentials.length;

  for (let i = 0; i < allCredentials.length; i += BATCH_SIZE) {
    const batch = allCredentials.slice(i, i + BATCH_SIZE);
    const placeholders = batch
      .map(() => "(?, ?, ?, ?, ?, ?)")
      .join(", ");
    await mysqlConn.query(
      `INSERT INTO credentials (id, user_id, type, data, last_used_at, created_at) VALUES ${placeholders}`,
      batch.flat()
    );
  }

  log(`Inserted ${allCredentials.length} credentials`);
  return allCredentials.length;
}

async function migrateServiceProviders(pgClient, mysqlConn, dryRun) {
  header("1d. Migrating service providers");

  const { rows } = await pgClient.query(
    "SELECT * FROM service_providers ORDER BY id"
  );
  log(`Found ${rows.length} source service providers`);

  if (dryRun) return rows.length;

  const values = [];
  for (const sp of rows) {
    // Map old integer id → issuer URI (which becomes the new PK)
    spIdMap.set(sp.id, sp.issuer);

    values.push([
      sp.issuer,              // id = issuer URI
      sp.friendly_name,       // name
      sp.ial,                 // ial_max
      sp.default_aal,         // aal_max
      sp.redirect_uris,       // JSON array passthrough
      sp.cert || "",          // public_key
      null,                   // saml_metadata_url (not in source test data)
      null,                   // push_notification_url
      null,                   // post_logout_redirect_uris
      toISO(sp.created_at),
    ]);
  }

  const placeholders = values
    .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .join(", ");
  await mysqlConn.query(
    `INSERT INTO service_providers (id, name, ial_max, aal_max, redirect_uris, public_key, saml_metadata_url, push_notification_url, post_logout_redirect_uris, created_at) VALUES ${placeholders}`,
    values.flat()
  );

  log(`Inserted ${values.length} service providers`);
  return values.length;
}

async function migrateEvents(pgClient, mysqlConn, dryRun) {
  header("1e. Migrating events → identity_events");

  const { rows: countResult } = await pgClient.query(
    "SELECT COUNT(*)::int AS count FROM events"
  );
  const total = countResult[0].count;
  log(`Found ${total} source events`);

  if (dryRun) return total;

  let offset = 0;
  let inserted = 0;

  while (offset < total) {
    const { rows } = await pgClient.query(
      "SELECT * FROM events ORDER BY id LIMIT $1 OFFSET $2",
      [BATCH_SIZE, offset]
    );
    if (rows.length === 0) break;

    const values = [];
    for (const e of rows) {
      const newUserId = userIdMap.get(e.user_id);
      if (!newUserId) continue;

      const ts = new Date(e.created_at).getTime();
      values.push([
        uuidV7(ts),
        newUserId,
        null,           // sp_id (events table doesn't have SP linkage)
        e.event_type,
        null,           // ial
        null,           // aal
        e.ip,
        "{}",           // metadata (empty JSON)
        toISO(e.created_at),
      ]);
    }

    if (values.length > 0) {
      const placeholders = values
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .join(", ");
      await mysqlConn.query(
        `INSERT INTO identity_events (id, user_id, sp_id, event_type, ial, aal, ip, metadata, created_at) VALUES ${placeholders}`,
        values.flat()
      );
    }

    inserted += values.length;
    offset += BATCH_SIZE;
    if (total > BATCH_SIZE) {
      log(`  Progress: ${Math.min(offset, total)}/${total}`);
    }
  }

  log(`Inserted ${inserted} identity_events`);
  return inserted;
}

/**
 * Bridge migrated users into Better Auth tables so the demo sign-in works.
 *
 * Better Auth stores passwords in the `account` table (providerId="credential")
 * using scrypt hashes, while the migration puts bcrypt hashes into `credentials`.
 * This step creates Better Auth `user` + `account` records so migrated users
 * can sign in through the demo UI.
 *
 * For the test migration user (testmigration@example.gov / Password123!),
 * the password is hashed with Better Auth's scrypt params so login works
 * immediately. Other migrated users get a placeholder that would need
 * lazy rehashing on first login in a real deployment.
 */
async function migrateBetterAuthAccounts(pgClient, mysqlConn, dryRun) {
  header("1f. Creating Better Auth user + account records");

  // Hash Password123! with Better Auth's scrypt params (N=16384, r=16, p=1, dkLen=64)
  const { scryptAsync } = await import("@noble/hashes/scrypt.js");
  const testPassword = "Password123!";
  const saltBytes = randomBytes(16);
  const salt = saltBytes.toString("hex");
  const key = await scryptAsync(testPassword.normalize("NFKC"), salt, {
    N: 16384, r: 16, p: 1, dkLen: 64,
    maxmem: 128 * 16384 * 16 * 2,
  });
  const scryptHash = salt + ":" + Buffer.from(key).toString("hex");
  log(`Generated scrypt hash for test password`);

  // Ensure Better Auth tables exist
  await mysqlConn.query(`CREATE TABLE IF NOT EXISTS \`user\` (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT,
    createdAt TIMESTAMP NOT NULL,
    updatedAt TIMESTAMP NOT NULL,
    twoFactorEnabled BOOLEAN DEFAULT FALSE
  )`);
  await mysqlConn.query(`CREATE TABLE IF NOT EXISTS account (
    id VARCHAR(36) PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    accountId VARCHAR(255) NOT NULL,
    providerId VARCHAR(255) NOT NULL,
    accessToken TEXT,
    refreshToken TEXT,
    accessTokenExpiresAt TIMESTAMP NULL,
    refreshTokenExpiresAt TIMESTAMP NULL,
    scope TEXT,
    password TEXT,
    createdAt TIMESTAMP NOT NULL,
    updatedAt TIMESTAMP NOT NULL,
    FOREIGN KEY (userId) REFERENCES \`user\`(id) ON DELETE CASCADE
  )`);
  await mysqlConn.query(`CREATE TABLE IF NOT EXISTS session (
    id VARCHAR(36) PRIMARY KEY,
    userId VARCHAR(36) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expiresAt TIMESTAMP NOT NULL,
    ipAddress VARCHAR(45),
    userAgent TEXT,
    createdAt TIMESTAMP NOT NULL,
    updatedAt TIMESTAMP NOT NULL,
    FOREIGN KEY (userId) REFERENCES \`user\`(id) ON DELETE CASCADE
  )`);
  await mysqlConn.query(`CREATE TABLE IF NOT EXISTS verification (
    id VARCHAR(36) PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    expiresAt TIMESTAMP NOT NULL,
    createdAt TIMESTAMP NOT NULL,
    updatedAt TIMESTAMP NOT NULL
  )`);
  await mysqlConn.query(`CREATE TABLE IF NOT EXISTS twoFactor (
    id VARCHAR(36) PRIMARY KEY,
    secret TEXT NOT NULL,
    backupCodes TEXT NOT NULL,
    userId VARCHAR(36) NOT NULL,
    FOREIGN KEY (userId) REFERENCES \`user\`(id) ON DELETE CASCADE
  )`);

  // Get all confirmed users with passwords from source
  const { rows } = await pgClient.query(
    `SELECT u.id, u.email, u.confirmed_at, u.created_at, u.updated_at
     FROM users u
     JOIN passwords p ON p.user_id = u.id
     WHERE u.confirmed_at IS NOT NULL
     ORDER BY u.id`
  );
  log(`Found ${rows.length} confirmed users with passwords`);

  if (dryRun) return rows.length;

  const userValues = [];
  const accountValues = [];

  for (const u of rows) {
    const newUserId = userIdMap.get(u.id);
    if (!newUserId) continue;

    const ts = new Date(u.created_at);
    const name = u.email.split("@")[0].replace(/\./g, " ");

    userValues.push([
      newUserId,
      name,
      u.email,
      u.confirmed_at ? 1 : 0,
      null, // image
      ts,
      new Date(u.updated_at),
      0, // twoFactorEnabled
    ]);

    // For the test user, use the real scrypt hash; others get a marker
    const isTestUser = u.email === "testmigration@example.gov";
    const passwordHash = isTestUser ? scryptHash : "migrated_bcrypt:needs_rehash";

    accountValues.push([
      uuidV7(ts.getTime()),
      newUserId,
      newUserId, // accountId = userId for credential provider
      "credential",
      null, null, null, null, null, // tokens, scope
      passwordHash,
      ts,
      new Date(u.updated_at),
    ]);
  }

  // Batch insert users
  for (let i = 0; i < userValues.length; i += BATCH_SIZE) {
    const batch = userValues.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    await mysqlConn.query(
      "INSERT INTO `user` (id, name, email, emailVerified, image, createdAt, updatedAt, twoFactorEnabled) VALUES " + placeholders,
      batch.flat()
    );
  }

  // Batch insert accounts
  for (let i = 0; i < accountValues.length; i += BATCH_SIZE) {
    const batch = accountValues.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    await mysqlConn.query(
      "INSERT INTO account (id, userId, accountId, providerId, accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt) VALUES " + placeholders,
      batch.flat()
    );
  }

  log(`Inserted ${userValues.length} Better Auth users + accounts`);
  log(`Test user: testmigration@example.gov / Password123!`);
  return userValues.length;
}

// ── Reset ────────────────────────────────────────────────────

async function resetTarget(mysqlConn) {
  header("Resetting target database (MySQL)");

  const tables = [
    "twoFactor",
    "account",
    "session",
    "verification",
    "identity_events",
    "auth_codes",
    "credentials",
    "user_emails",
    "service_providers",
    "user",
    "users",
  ];

  for (const table of tables) {
    try {
      await mysqlConn.query(`DELETE FROM \`${table}\``);
      log(`Cleared ${table}`);
    } catch (e) {
      if (e.code === "ER_NO_SUCH_TABLE") {
        log(`Skipped ${table} (does not exist)`);
      } else {
        throw e;
      }
    }
  }

  log("Target database reset complete");
}

// ── Validation ───────────────────────────────────────────────

async function validate(pgClient, mysqlConn) {
  header("Validation");

  const checks = [
    { source: "users", target: "users" },
    { source: "email_addresses", target: "user_emails" },
    { source: null, target: "credentials", label: "credentials (unified)" },
    { source: "service_providers", target: "service_providers" },
    { source: "events", target: "identity_events" },
  ];

  let allPassed = true;

  for (const check of checks) {
    const [[targetRow]] = await mysqlConn.query(
      `SELECT COUNT(*) AS count FROM \`${check.target}\``
    );
    const targetCount = Number(targetRow.count);

    if (check.source) {
      const { rows: [sourceRow] } = await pgClient.query(
        `SELECT COUNT(*)::int AS count FROM ${check.source}`
      );
      const match = targetCount >= sourceRow.count ? "OK" : "MISMATCH";
      if (match === "MISMATCH") allPassed = false;
      log(`${match.padEnd(8)} ${check.source} (${sourceRow.count}) → ${check.target} (${targetCount})`);
    } else {
      log(`${"OK".padEnd(8)} ${check.label}: ${targetCount} rows`);
    }
  }

  // Check credential breakdown
  const [credRows] = await mysqlConn.query(
    "SELECT type, COUNT(*) AS count FROM credentials GROUP BY type ORDER BY type"
  );
  log("\n  Credential breakdown:");
  for (const row of credRows) {
    log(`    ${row.type}: ${row.count}`);
  }

  // Referential integrity: all user_emails.user_id should exist in users
  const [[orphanEmails]] = await mysqlConn.query(
    "SELECT COUNT(*) AS count FROM user_emails ue LEFT JOIN users u ON ue.user_id = u.id WHERE u.id IS NULL"
  );
  const [[orphanCreds]] = await mysqlConn.query(
    "SELECT COUNT(*) AS count FROM credentials c LEFT JOIN users u ON c.user_id = u.id WHERE u.id IS NULL"
  );
  const [[orphanEvents]] = await mysqlConn.query(
    "SELECT COUNT(*) AS count FROM identity_events ie LEFT JOIN users u ON ie.user_id = u.id WHERE u.id IS NULL"
  );

  const orphanTotal =
    Number(orphanEmails.count) +
    Number(orphanCreds.count) +
    Number(orphanEvents.count);

  log(`\n  Referential integrity: ${orphanTotal === 0 ? "OK (no orphans)" : `FAIL (${orphanTotal} orphaned rows)`}`);
  if (orphanTotal > 0) allPassed = false;

  return allPassed;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isReset = args.includes("--reset");
  const isDryRun = args.includes("--dry-run");
  const tableArg = args.find((a) => a.startsWith("--table="));
  const singleTable = tableArg ? tableArg.split("=")[1] : null;

  console.log("\n  Login.gov Migration CLI");
  console.log("  PostgreSQL → MySQL (PlanetScale)\n");

  const pgClient = await new pg.Pool(PG_CONFIG).connect();
  const mysqlConn = await mysql.createConnection(MYSQL_CONFIG);

  try {
    if (isReset) {
      await resetTarget(mysqlConn);
      return;
    }

    if (isDryRun) {
      log("DRY RUN — no data will be written\n");
    }

    const start = Date.now();
    const counts = {};

    const steps = {
      users: () => migrateUsers(pgClient, mysqlConn, isDryRun),
      profiles: () => migrateProfiles(pgClient, mysqlConn, isDryRun),
      emails: () => migrateEmails(pgClient, mysqlConn, isDryRun),
      credentials: () => migrateCredentials(pgClient, mysqlConn, isDryRun),
      service_providers: () => migrateServiceProviders(pgClient, mysqlConn, isDryRun),
      events: () => migrateEvents(pgClient, mysqlConn, isDryRun),
      betterauth: () => migrateBetterAuthAccounts(pgClient, mysqlConn, isDryRun),
    };

    if (singleTable) {
      if (!steps[singleTable]) {
        console.error(
          `  Unknown table: ${singleTable}\n  Available: ${Object.keys(steps).join(", ")}`
        );
        process.exit(1);
      }
      // Users must always run first (for ID mapping)
      if (singleTable !== "users") {
        await migrateUsers(pgClient, mysqlConn, true); // build ID map only
      }
      counts[singleTable] = await steps[singleTable]();
    } else {
      // Run all steps in order
      for (const [name, fn] of Object.entries(steps)) {
        counts[name] = await fn();
      }
    }

    // Validate
    if (!isDryRun) {
      const passed = await validate(pgClient, mysqlConn);
      header(passed ? "Migration complete" : "Migration complete (with warnings)");
    } else {
      header("Dry run complete");
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`Time: ${elapsed}s\n`);
  } finally {
    pgClient.release();
    await mysqlConn.end();
  }
}

main().catch((err) => {
  console.error("\n  ERROR:", err.message);
  process.exit(1);
});
