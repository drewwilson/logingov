/**
 * Better Auth instance configuration.
 * Central auth configuration shared by auth-core and other Workers.
 */
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { oidcProvider } from "better-auth/plugins/oidc-provider";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@logingov/shared/db";
import type { Env } from "@logingov/shared";
import * as schema from "./schema.js";

/**
 * Create a Better Auth instance bound to the current request's env.
 * Called per-request because env bindings are request-scoped in Workers.
 */
export function createAuth(env: Env) {
  const db = getDb(env);

  return betterAuth({
    baseURL: env.BASE_URL || "http://localhost:8787",
    basePath: "/api/auth",

    database: drizzleAdapter(db, { provider: "mysql", schema }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
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
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
