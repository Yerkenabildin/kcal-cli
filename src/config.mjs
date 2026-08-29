import os from "node:os";
import path from "node:path";

const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");

export const API_URL = process.env.YAZIO_API_URL || "https://yzapi.yazio.com";
export const API_VERSION = "v22";

// The OAuth client credentials the YAZIO mobile app ships with. They identify the *app*,
// not the user — every install sends the same pair — so they are not a secret and belong
// in source rather than in the environment. They are published as `example` values in the
// community API specification for exactly that reason. The user's own password never
// appears here or anywhere else on disk.
export const CLIENT_ID = process.env.YAZIO_CLIENT_ID || "3_5rbw4kehpugw8ogsc8ck8oo4ogswgckcskc04gcg8kk8k48ssw";
export const CLIENT_SECRET = process.env.YAZIO_CLIENT_SECRET || "25gdtt1hvdi8gwowoww4oo88sgsw0oo04o0og0kkgwwks8k0k";

// The API refuses any request whose client version it does not recognise, answering
// 403 {"error":"version_blocked"} on every endpoint except the token exchange — and the
// version rides in the User-Agent rather than a header of its own. This is the string a
// captured app sent; it needs bumping whenever YAZIO retires that version, which is the
// single most likely reason this CLI stops working.
export const USER_AGENT = process.env.YAZIO_USER_AGENT
  || "YAZIO/26.30.1 (com.yazio.ios.YAZIO; build:2607271240; iOS 27.0.0) Ktor";

// Product search is ranked by this header, so it decides whether searching "kwark"
// answers with Dutch products or English ones.
export const ACCEPT_LANGUAGE = process.env.YAZIO_ACCEPT_LANGUAGE || "nl-NL,nl;q=0.9,en;q=0.8";

// Normally both are taken from the authenticated profile; these only override it.
export const COUNTRIES = process.env.YAZIO_COUNTRIES || null;
export const LOCALES = process.env.YAZIO_LOCALES || null;

export const TOKEN_FILE = process.env.YAZIO_TOKEN_FILE || path.join(configHome, "yazio-cli", "token.json");
export const STATE_DIR = process.env.YAZIO_STATE_DIR || path.join(stateHome, "yazio-cli");
export const TIMEOUT_MS = Number(process.env.YAZIO_TIMEOUT_MS || 30000);
export const RETRIES = Number(process.env.YAZIO_RETRIES || 2);

export function defaultHeaders() {
  return {
    "User-Agent": USER_AGENT,
    "Accept-Language": ACCEPT_LANGUAGE,
    Accept: "application/json",
  };
}
