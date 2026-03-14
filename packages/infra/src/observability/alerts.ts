/**
 * Alert threshold definitions and SLO configuration.
 * SOC II CC7.2: Monitoring activities include detection of anomalies.
 *
 * These thresholds define when alerting should trigger. They are consumed by:
 * - Cloudflare Logpush alert rules
 * - Application-level health check logic
 * - External monitoring integrations (Datadog, PagerDuty, etc.)
 */

// ── Severity Levels ─────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low";

export interface AlertThreshold {
  name: string;
  description: string;
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==";
  threshold: number;
  windowSeconds: number;
  severity: Severity;
  responseMinutes: number;
}

// ── Service Level Objectives ────────────────────────────────

export interface SLO {
  name: string;
  target: number; // percentage (e.g., 99.9)
  metric: string;
  windowDays: number;
}

export const SERVICE_LEVEL_OBJECTIVES: SLO[] = [
  {
    name: "Availability",
    target: 99.9,
    metric: "success_rate",
    windowDays: 30,
  },
  {
    name: "Auth Latency (p95)",
    target: 95,
    metric: "response_time_ms < 500",
    windowDays: 30,
  },
  {
    name: "Token Endpoint Latency (p99)",
    target: 99,
    metric: "token_response_time_ms < 2000",
    windowDays: 30,
  },
];

// ── Alert Thresholds ────────────────────────────────────────

export const ALERT_THRESHOLDS: AlertThreshold[] = [
  // ── Authentication ──────────────────────────────
  {
    name: "High Auth Failure Rate",
    description: "Failed authentication rate exceeds 5% of requests",
    metric: "auth_failure_rate_percent",
    operator: ">",
    threshold: 5,
    windowSeconds: 300,
    severity: "high",
    responseMinutes: 60,
  },
  {
    name: "Token Endpoint Errors",
    description: "Token endpoint error rate exceeds 1%",
    metric: "token_error_rate_percent",
    operator: ">",
    threshold: 1,
    windowSeconds: 300,
    severity: "high",
    responseMinutes: 60,
  },
  {
    name: "Authorization Code Replay Attempts",
    description: "Multiple auth code reuse attempts detected",
    metric: "auth_code_replay_count",
    operator: ">",
    threshold: 5,
    windowSeconds: 60,
    severity: "high",
    responseMinutes: 60,
  },

  // ── Infrastructure ──────────────────────────────
  {
    name: "Worker Error Rate",
    description: "Overall Worker error rate exceeds 1%",
    metric: "worker_error_rate_percent",
    operator: ">",
    threshold: 1,
    windowSeconds: 300,
    severity: "high",
    responseMinutes: 60,
  },
  {
    name: "Response Time p95",
    description: "p95 response time exceeds 2 seconds",
    metric: "response_time_p95_ms",
    operator: ">",
    threshold: 2000,
    windowSeconds: 300,
    severity: "medium",
    responseMinutes: 240,
  },
  {
    name: "Database Connection Failures",
    description: "Database connection failures exceed 3 in 1 minute",
    metric: "db_connection_failure_count",
    operator: ">",
    threshold: 3,
    windowSeconds: 60,
    severity: "critical",
    responseMinutes: 15,
  },
  {
    name: "Queue Dead Letters",
    description: "Dead letter messages detected in any queue",
    metric: "queue_dead_letter_count",
    operator: ">",
    threshold: 0,
    windowSeconds: 300,
    severity: "medium",
    responseMinutes: 240,
  },
  {
    name: "Key Rotation Cron Failure",
    description: "JWKS rotation cron failed 2+ consecutive times",
    metric: "key_rotation_consecutive_failures",
    operator: ">=",
    threshold: 2,
    windowSeconds: 7200,
    severity: "high",
    responseMinutes: 60,
  },

  // ── MFA ─────────────────────────────────────────
  {
    name: "TOTP Brute Force",
    description: "More than 10 TOTP failures per minute per user",
    metric: "totp_failure_per_user_per_minute",
    operator: ">",
    threshold: 10,
    windowSeconds: 60,
    severity: "high",
    responseMinutes: 60,
  },
  {
    name: "SMS OTP Delivery Failures",
    description: "SMS delivery failure rate exceeds 5%",
    metric: "sms_delivery_failure_rate_percent",
    operator: ">",
    threshold: 5,
    windowSeconds: 600,
    severity: "medium",
    responseMinutes: 240,
  },

  // ── Data & Privacy ──────────────────────────────
  {
    name: "PII Decryption Errors",
    description: "Any PII decryption failure indicates key mismatch",
    metric: "pii_decryption_error_count",
    operator: ">",
    threshold: 0,
    windowSeconds: 300,
    severity: "high",
    responseMinutes: 60,
  },

  // ── Rate Limiting / Abuse ───────────────────────
  {
    name: "Rate Limit Violations Spike",
    description: "Excessive rate limit violations from a single IP",
    metric: "rate_limit_violations_per_ip_per_minute",
    operator: ">",
    threshold: 100,
    windowSeconds: 60,
    severity: "medium",
    responseMinutes: 240,
  },
];

// ── Health Check Configuration ──────────────────────────────

export interface HealthCheckConfig {
  service: string;
  endpoint: string;
  intervalSeconds: number;
  timeoutMs: number;
  unhealthyThreshold: number;
}

export const HEALTH_CHECKS: HealthCheckConfig[] = [
  {
    service: "auth-core",
    endpoint: "/health",
    intervalSeconds: 30,
    timeoutMs: 5000,
    unhealthyThreshold: 3,
  },
  {
    service: "mfa",
    endpoint: "/health",
    intervalSeconds: 30,
    timeoutMs: 5000,
    unhealthyThreshold: 3,
  },
  {
    service: "account",
    endpoint: "/health",
    intervalSeconds: 30,
    timeoutMs: 5000,
    unhealthyThreshold: 3,
  },
  {
    service: "admin",
    endpoint: "/health",
    intervalSeconds: 60,
    timeoutMs: 5000,
    unhealthyThreshold: 3,
  },
  {
    service: "saml-bridge",
    endpoint: "/health",
    intervalSeconds: 30,
    timeoutMs: 5000,
    unhealthyThreshold: 3,
  },
  {
    service: "identity-proofing",
    endpoint: "/health",
    intervalSeconds: 60,
    timeoutMs: 5000,
    unhealthyThreshold: 3,
  },
  {
    service: "security-events",
    endpoint: "/health",
    intervalSeconds: 60,
    timeoutMs: 5000,
    unhealthyThreshold: 3,
  },
];
