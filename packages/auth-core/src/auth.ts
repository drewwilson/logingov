/**
 * Better Auth instance configuration.
 * Central auth configuration shared by auth-core and other Workers.
 *
 * Includes lazy password rehashing for migrated users: bcrypt hashes from the
 * old Rails system are verified and then re-hashed with scrypt on first login.
 */
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { oidcProvider } from "better-auth/plugins/oidc-provider";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { compare as bcryptCompare } from "bcrypt-ts";
import { getDb } from "@logingov/shared/db";
import { sql } from "drizzle-orm";
import type { Env } from "@logingov/shared";
import * as schema from "./schema.js";

const BCRYPT_MIGRATED_PREFIX = "migrated_bcrypt:";

/**
 * Create a Better Auth instance bound to the current request's env.
 * Called per-request because env bindings are request-scoped in Workers.
 */
export function createAuth(env: Env) {
  const db = getDb(env);

  return betterAuth({
    secret: env.JWT_SIGNING_KEY,
    baseURL: env.BASE_URL || "http://localhost:8787",
    basePath: "/api/auth",

    database: drizzleAdapter(db, { provider: "mysql", schema }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      password: {
        async verify({ password, hash }) {
          if (!hash.startsWith(BCRYPT_MIGRATED_PREFIX)) {
            // Not a migrated hash — verify with Better Auth's native scrypt
            return verifyPassword({ password, hash });
          }

          // Migrated user: verify against the bcrypt hash
          const bcryptHash = hash.slice(BCRYPT_MIGRATED_PREFIX.length);
          const valid = await bcryptCompare(password, bcryptHash);

          if (valid) {
            // Lazy rehash: replace bcrypt with scrypt so future logins are native.
            const scryptHash = await hashPassword(password);
            db.execute(
              sql`UPDATE account SET password = ${scryptHash} WHERE password = ${hash}`
            ).catch(() => {
              // Non-critical: rehash will succeed on next login
            });
          }

          return valid;
        },
      },
    },

    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "microsoft"],
      },
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      microsoft: {
        clientId: env.MICROSOFT_CLIENT_ID,
        clientSecret: env.MICROSOFT_CLIENT_SECRET,
      },
    },

    session: {
      expiresIn: 15 * 60, // 15 min for auth flows
      updateAge: 60, // refresh session every 60s
    },

    advanced: {
      database: {
        generateId: () => crypto.randomUUID(), // UUID v4 for Better Auth internals
      },
    },

    plugins: [
      twoFactor({
        issuer: "Login.gov",
        otpOptions: {
          digits: 6,
          period: 30,
        },
        backupCodes: {
          length: 10,
          characters: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", // no ambiguous chars
        },
      }),

      oidcProvider({
        // OIDC Provider configuration
        // Login.gov acts as an OpenID Provider for Service Providers (RPs)
        loginPage: "/sign-in",
      }),
    ],

    trustedOrigins: [
      "https://secure.login.gov",
      "https://idp.int.identitysandbox.gov",
      "http://localhost:8787",
      "http://localhost:8788",
      env.BASE_URL || "",
      ...(env.ALLOWED_ORIGINS?.split(",") ?? []),
    ].filter(Boolean),
  });
}

export type Auth = ReturnType<typeof createAuth>;
