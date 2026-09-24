import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "../config.mjs";
import { UsageError } from "../errors.mjs";
import * as login from "./login.mjs";
import * as logout from "./logout.mjs";
import * as status from "./status.mjs";

export const knownFlags = new Set(["email", "password", "password-stdin", "refresh"]);

export async function run(positionals, flags) {
  const provider = positionals[0];
  const action = positionals[1] || "status";
  if (provider === "openrouter") {
    if (action !== "status") throw new UsageError("OpenRouter supports only: kcal provider openrouter status");
    return {
      ok: true,
      operation: "provider.openrouter.status",
      configured: Boolean(OPENROUTER_API_KEY),
      model: OPENROUTER_MODEL,
    };
  }
  if (provider !== "yazio") throw new UsageError("usage: kcal provider <yazio|openrouter> <login|status|logout>");
  if (action === "login") return { ...(await login.run(positionals.slice(2), flags)), operation: "provider.yazio.login" };
  if (action === "status") return { ...(await status.run(positionals.slice(2), flags)), operation: "provider.yazio.status" };
  if (action === "logout") return { ...(await logout.run()), operation: "provider.yazio.logout" };
  throw new UsageError(`unknown YAZIO provider action: ${action}`);
}
