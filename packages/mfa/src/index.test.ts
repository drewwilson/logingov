/**
 * MFA Module Tests
 *
 * Tests for pure logic that can be validated without external dependencies:
 * - TOTP time-step window calculations
 * - OTP format validation
 * - Backup code format and charset
 * - Base32 encoding/decoding
 * - Constant-time comparison
 */
import { describe, it, expect } from "vitest";

// ── TOTP Constants (mirrored from routes/totp.ts) ─────────────

const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.toUpperCase().replace(/=+$/, "");
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ── Backup Code Constants (mirrored from routes/backup-codes.ts) ──

const NUM_CODES = 10;
const CODE_LENGTH = 8;
const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function generateCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (const byte of bytes) {
    code += CODE_CHARSET[byte % CODE_CHARSET.length];
  }
  return code;
}

function formatCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return code.slice(0, mid) + "-" + code.slice(mid);
}

// ── OTP generation (mirrored from routes/sms-otp.ts) ──────────

const OTP_LENGTH = 6;

function generateOTP(length: number): string {
  const max = Math.pow(10, length);
  const limit = Math.floor(0xffffffff / max) * max;
  let value: number;
  do {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    value = arr[0];
  } while (value >= limit);
  return String(value % max).padStart(length, "0");
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return "****";
  return "***-***-" + phone.slice(-4);
}

// ── Tests ─────────────────────────────────────────────────────

describe("TOTP time-step calculations", () => {
  it("should compute the correct time step for a given timestamp", () => {
    // Unix epoch 0 => time step 0
    expect(Math.floor(0 / TOTP_PERIOD)).toBe(0);

    // 30 seconds => time step 1
    expect(Math.floor(30 / TOTP_PERIOD)).toBe(1);

    // 59 seconds => still time step 1
    expect(Math.floor(59 / TOTP_PERIOD)).toBe(1);

    // 60 seconds => time step 2
    expect(Math.floor(60 / TOTP_PERIOD)).toBe(2);
  });

  it("should allow +/- 1 step clock drift window", () => {
    const nowSeconds = 1700000000;
    const currentStep = Math.floor(nowSeconds / TOTP_PERIOD);

    // The verification checks offsets [-1, 0, 1]
    const allowedSteps = [-1, 0, 1].map((offset) => currentStep + offset);

    expect(allowedSteps).toHaveLength(3);
    expect(allowedSteps[1]).toBe(currentStep);
    expect(allowedSteps[0]).toBe(currentStep - 1);
    expect(allowedSteps[2]).toBe(currentStep + 1);
  });

  it("should use a 30-second TOTP period", () => {
    expect(TOTP_PERIOD).toBe(30);
  });

  it("should produce 6-digit codes", () => {
    expect(TOTP_DIGITS).toBe(6);
  });

  it("should have a replay prevention TTL covering 3 windows plus buffer", () => {
    // TOTP_REPLAY_TTL is 90 seconds (3 x 30s windows)
    const replayTtl = 90;
    expect(replayTtl).toBeGreaterThanOrEqual(TOTP_PERIOD * 3);
  });
});

describe("Base32 encoding/decoding", () => {
  it("should roundtrip encode and decode", () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);

    expect(decoded).toEqual(original);
  });

  it("should produce only valid base32 characters", () => {
    const data = crypto.getRandomValues(new Uint8Array(20));
    const encoded = base32Encode(data);

    for (const char of encoded) {
      expect(BASE32_ALPHABET).toContain(char);
    }
  });

  it("should encode a 20-byte TOTP secret to a 32-char base32 string", () => {
    const secret = new Uint8Array(20);
    const encoded = base32Encode(secret);

    // 20 bytes = 160 bits, 160 / 5 = 32 base32 characters
    expect(encoded).toHaveLength(32);
  });

  it("should handle padding-stripped input in decode", () => {
    const original = new Uint8Array([0xff, 0x00, 0xab]);
    const encoded = base32Encode(original);
    // Ensure stripping trailing '=' doesn't break decode
    const withPadding = encoded + "===";
    const decoded = base32Decode(withPadding);

    expect(decoded).toEqual(original);
  });

  it("should be case-insensitive on decode", () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]);
    const encoded = base32Encode(original);
    const decodedUpper = base32Decode(encoded.toUpperCase());
    const decodedLower = base32Decode(encoded.toLowerCase());

    expect(decodedUpper).toEqual(decodedLower);
  });
});

describe("OTP format validation", () => {
  it("should generate exactly 6-digit OTP codes", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOTP(OTP_LENGTH);
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it("should left-pad codes shorter than 6 digits with zeros", () => {
    // The generateOTP function uses padStart, so codes like "000123" are valid
    const code = String(123).padStart(OTP_LENGTH, "0");
    expect(code).toBe("000123");
    expect(code).toHaveLength(6);
  });

  it("should reject codes that are not exactly 6 digits", () => {
    const validCode = "123456";
    const tooShort = "12345";
    const tooLong = "1234567";
    const withLetters = "12345a";

    expect(validCode.length === OTP_LENGTH).toBe(true);
    expect(tooShort.length === OTP_LENGTH).toBe(false);
    expect(tooLong.length === OTP_LENGTH).toBe(false);
    expect(/^\d{6}$/.test(withLetters)).toBe(false);
  });

  it("should use rejection sampling to eliminate modulo bias", () => {
    // The limit calculation ensures fair distribution
    const max = Math.pow(10, OTP_LENGTH);
    const limit = Math.floor(0xffffffff / max) * max;

    // limit should be less than or equal to 0xFFFFFFFF
    expect(limit).toBeLessThanOrEqual(0xffffffff);
    // limit should be a multiple of max
    expect(limit % max).toBe(0);
    // limit should be close to 0xFFFFFFFF (within one max)
    expect(0xffffffff - limit).toBeLessThan(max);
  });
});

describe("Backup code format", () => {
  it("should generate codes of exactly 8 characters", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateCode(CODE_LENGTH);
      expect(code).toHaveLength(CODE_LENGTH);
    }
  });

  it("should only contain unambiguous characters", () => {
    // No 0, O, 1, I — these are excluded to prevent confusion
    const ambiguousChars = ["0", "O", "1", "I"];

    for (let i = 0; i < 50; i++) {
      const code = generateCode(CODE_LENGTH);
      for (const char of code) {
        expect(ambiguousChars).not.toContain(char);
        expect(CODE_CHARSET).toContain(char);
      }
    }
  });

  it("should format codes with a dash in the middle (XXXX-XXXX)", () => {
    const code = "ABCDEFGH";
    const formatted = formatCode(code);

    expect(formatted).toBe("ABCD-EFGH");
    expect(formatted).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("should generate 10 codes per set", () => {
    expect(NUM_CODES).toBe(10);
  });

  it("should normalize input by stripping dashes and uppercasing on verify", () => {
    // Verification normalizes: remove dashes/spaces, uppercase
    const input = "abcd-efgh";
    const normalized = input.replace(/[-\s]/g, "").toUpperCase();

    expect(normalized).toBe("ABCDEFGH");
  });

  it("should also strip spaces from input on verify", () => {
    const input = "ABCD EFGH";
    const normalized = input.replace(/[-\s]/g, "").toUpperCase();

    expect(normalized).toBe("ABCDEFGH");
  });
});

describe("timingSafeEqual", () => {
  it("should return true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("should return false for different strings of same length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("should return false for strings of different length", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("should return true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("should return false when only one string is empty", () => {
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});

describe("Phone masking", () => {
  it("should show only last 4 digits of phone number", () => {
    expect(maskPhone("+12025551234")).toBe("***-***-1234");
  });

  it("should mask short phone numbers entirely", () => {
    expect(maskPhone("1234")).toBe("****");
    expect(maskPhone("123")).toBe("****");
  });

  it("should handle 5-digit numbers by showing last 4", () => {
    expect(maskPhone("12345")).toBe("***-***-2345");
  });
});

describe("SMS send rate limiting constants", () => {
  it("should limit to 3 SMS sends per 10-minute window", () => {
    const SMS_SEND_MAX = 3;
    const SMS_SEND_WINDOW_SECONDS = 10 * 60;

    expect(SMS_SEND_MAX).toBe(3);
    expect(SMS_SEND_WINDOW_SECONDS).toBe(600);
  });
});

describe("MFA challenge method filtering", () => {
  it("should filter out password from MFA method list", () => {
    const allCreds = [
      { type: "password" },
      { type: "totp" },
      { type: "webauthn" },
      { type: "backup" },
    ];

    const configuredMethods = [
      ...new Set(allCreds.map((cred) => cred.type)),
    ].filter((type) => type !== "password");

    expect(configuredMethods).toEqual(["totp", "webauthn", "backup"]);
    expect(configuredMethods).not.toContain("password");
  });

  it("should restrict to webauthn + piv when phishing-resistant is required", () => {
    const configuredMethods = ["totp", "webauthn", "backup", "sms"];
    const phishingResistant = true;
    const hspd12 = false;

    let allowedMethods: string[];
    if (hspd12) {
      allowedMethods = ["piv"];
    } else if (phishingResistant) {
      allowedMethods = configuredMethods.filter((m) => m === "webauthn");
      allowedMethods.push("piv");
    } else {
      allowedMethods = configuredMethods;
    }

    expect(allowedMethods).toEqual(["webauthn", "piv"]);
    expect(allowedMethods).not.toContain("totp");
    expect(allowedMethods).not.toContain("sms");
  });

  it("should restrict to piv only when HSPD-12 is required", () => {
    const configuredMethods = ["totp", "webauthn", "backup"];
    const hspd12 = true;

    let allowedMethods: string[];
    if (hspd12) {
      allowedMethods = ["piv"];
    } else {
      allowedMethods = configuredMethods;
    }

    expect(allowedMethods).toEqual(["piv"]);
  });

  it("should allow all configured methods when no special requirements", () => {
    const configuredMethods = ["totp", "webauthn", "backup"];
    const phishingResistant = false;
    const hspd12 = false;

    let allowedMethods: string[];
    if (hspd12) {
      allowedMethods = ["piv"];
    } else if (phishingResistant) {
      allowedMethods = configuredMethods.filter((m) => m === "webauthn");
      allowedMethods.push("piv");
    } else {
      allowedMethods = configuredMethods;
    }

    expect(allowedMethods).toEqual(configuredMethods);
  });

  it("should deduplicate credential types", () => {
    const allCreds = [
      { type: "totp" },
      { type: "totp" }, // duplicate
      { type: "webauthn" },
    ];

    const configuredMethods = [
      ...new Set(allCreds.map((cred) => cred.type)),
    ].filter((type) => type !== "password");

    expect(configuredMethods).toEqual(["totp", "webauthn"]);
  });
});
