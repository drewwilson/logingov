#!/usr/bin/env node
/**
 * Generate an RSA-2048 keypair for the demo agency worker.
 *
 * Usage:
 *   node scripts/gen-demo-agency-keypair.mjs
 *
 * Then set the private key as a Wrangler secret:
 *   cat private.pem | wrangler secret put DEMO_SP_PRIVATE_KEY --config packages/demo-agency/wrangler.toml
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

console.log("=== PUBLIC KEY (for reference) ===\n");
console.log(publicKey);

console.log("=== PRIVATE KEY ===\n");
console.log(privateKey);

console.log("=== Next steps ===");
console.log("1. Save the private key to a file:");
console.log("   (copy the PRIVATE KEY block above into private.pem)\n");
console.log("2. Set as Wrangler secret:");
console.log("   cat private.pem | wrangler secret put DEMO_SP_PRIVATE_KEY --config packages/demo-agency/wrangler.toml\n");
console.log("3. Set the admin API key:");
console.log("   wrangler secret put ADMIN_API_KEY --config packages/demo-agency/wrangler.toml\n");
console.log("4. Deploy:");
console.log("   wrangler deploy --config packages/demo-agency/wrangler.toml\n");
console.log("5. Visit /setup to register the service provider, then / to test the flow.");
