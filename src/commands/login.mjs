// yazio login --email <address> [--password-stdin]
//
// Exchanges the account credentials for a token pair. The password arrives either from a hidden
// TTY prompt or, for a session with no terminal of its own, on stdin. It is never accepted as a
// flag: argv is world-readable in /proc/PID/cmdline, whereas a pipe is not readable at all and
// /proc/PID/environ is at least restricted to the owner.
import { exchangePassword, saveTokens, tokenFilePath } from "../auth.mjs";
import { UsageError } from "../errors.mjs";
import { promptHidden } from "../prompt.mjs";
import { toStringFlag } from "../util.mjs";
import { invoke } from "./_shared.mjs";

// Only one trailing newline is stripped — the one an editor or `echo` adds. Anything else,
// including a trailing space, is treated as part of the password: trimming further would
// silently try a different password than the one on disk and report it as a bad login.
export function stripTrailingNewline(text) {
  return text.replace(/\r?\n$/, "");
}

async function readPasswordFromStdin() {
  if (process.stdin.isTTY) {
    throw new UsageError("--password-stdin expects the password on stdin, but stdin is a terminal", {
      hint: "yazio login --email <address> --password-stdin < /path/to/password-file",
    });
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return stripTrailingNewline(Buffer.concat(chunks).toString("utf8"));
}

// `password` is listed as known only so that the dispatcher hands it to run(), which refuses
// it with an explanation. Leaving it out would answer the vaguer "unknown flag" instead, and
// the reason for the refusal is the point.
export const knownFlags = new Set(["email", "password", "password-stdin"]);

export async function run(positionals, flags) {
  if (flags.password !== undefined) {
    throw new UsageError("--password is not supported: a password given on the command line is visible in `ps`", {
      hint: "run `yazio login --email <address>` and type the password at the hidden prompt",
    });
  }

  const email = toStringFlag(flags.email, "--email") || positionals[0];
  if (!email) throw new UsageError("usage: yazio login --email <address>");
  if (!email.includes("@")) throw new UsageError(`--email must be an email address, got: ${email}`);

  const password = flags["password-stdin"]
    ? await readPasswordFromStdin()
    : await promptHidden(`YAZIO password for ${email}: `);
  if (!password) throw new UsageError("no password provided");

  const tokens = await exchangePassword(email, password);
  const stored = saveTokens(tokens);

  // The profile answers the `sex` and `countries` that product search refuses to run without,
  // so it is fetched once here and cached beside the token rather than on every search.
  let profile = null;
  try {
    profile = await invoke("user.get");
  } catch {
    // A failure here costs a lookup later, not the login itself.
  }
  // Rewritten with the expiry the exchange actually granted, so caching the profile does not
  // quietly move the token's deadline.
  if (profile) {
    saveTokens(tokens, {
      user: summariseProfile(profile),
      expires_at: stored.expires_at,
      obtained_at: stored.obtained_at,
    });
  }

  return {
    ok: true,
    operation: "login",
    authenticated: true,
    email: profile?.email || email,
    token_file: tokenFilePath(),
    profile: profile ? summariseProfile(profile) : null,
  };
}

export function summariseProfile(profile) {
  return {
    uuid: profile?.uuid ?? null,
    email: profile?.email ?? null,
    sex: profile?.sex ?? null,
    country: profile?.country ?? null,
    food_database_country: profile?.food_database_country ?? null,
    language: profile?.language ?? null,
    unit_energy: profile?.unit_energy ?? null,
    unit_mass: profile?.unit_mass ?? null,
  };
}
