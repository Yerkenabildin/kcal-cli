// Exit codes 0-5 match kinopub-cli exactly so the two CLIs stay comparable.
// 6 and 7 are a deliberate extension for this API: a write whose outcome could not be
// established is not the same failure as a conflict, and a private API that has moved
// out from under us is not the same failure as a bad request. See AGENTS.md.
export class CliError extends Error {
  constructor(message, { kind = "error", exitCode = 1, details = {} } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.kind = kind;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export class UsageError extends CliError {
  constructor(message, details) { super(message, { kind: "usage_error", exitCode: 2, details }); }
}

export class AuthError extends CliError {
  constructor(message, details) { super(message, { kind: "authentication_required", exitCode: 3, details }); }
}

export class ConfirmationRequiredError extends CliError {
  constructor(message, command) {
    super(message, { kind: "confirmation_required", exitCode: 4, details: { retry_command: command } });
  }
}

export class AmbiguousMatchError extends CliError {
  constructor(message, details) { super(message, { kind: "ambiguous_match", exitCode: 5, details }); }
}

export class ConflictError extends CliError {
  constructor(message, details) { super(message, { kind: "verification_conflict", exitCode: 5, details }); }
}

// Thrown by the client when a non-replay-safe request failed in a way that leaves the
// server-side outcome unknown. Write commands catch this and recover by reading the day
// back; it only reaches the user when that recovery is itself impossible.
export class UnsafeReplayError extends CliError {
  constructor(message, details) { super(message, { kind: "unsafe_replay", exitCode: 6, details }); }
}

export class WriteResultUnknownError extends CliError {
  constructor(message, details) { super(message, { kind: "write_result_unknown", exitCode: 6, details }); }
}

// `version_blocked`, or a response whose shape the registry cannot make sense of.
export class ApiChangedError extends CliError {
  constructor(message, details) { super(message, { kind: "api_changed", exitCode: 7, details }); }
}

export class RateLimitError extends CliError {
  constructor(message, retryAfter) {
    super(message, { kind: "rate_limited", details: { retry_after_seconds: retryAfter } });
    this.retryAfter = retryAfter;
  }
}

export class ApiError extends CliError {
  constructor(message, status, payload) {
    super(message, { kind: "api_error", details: { status, api_error: payload } });
    this.status = status;
    this.payload = payload;
  }
}

// Belt and braces. Nothing is supposed to put a credential into `details` in the first
// place, but an error payload is the one structure that is printed verbatim to a place
// the user may paste elsewhere, so it gets a redaction pass on the way out rather than
// trusting every future call site to have been careful.
const SECRET_KEY = /(^|_)(password|token|secret|authorization|auth|cookie)($|_)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g;

export function redact(value, depth = 0) {
  if (depth > 6) return "[deep]";
  if (typeof value === "string") return value.replace(BEARER, "Bearer [redacted]");
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

export function errorPayload(error) {
  return redact({
    error: error.kind || "error",
    message: error.message || String(error),
    ...(error.details || {}),
  });
}
