import { request } from "../client.mjs";
import { endpoint, expandPath } from "../endpoints.mjs";
import { ConfirmationRequiredError, UsageError } from "../errors.mjs";
import { toBool } from "../util.mjs";

export function requireArg(value, usage) {
  if (value === undefined || value === "") throw new UsageError(usage);
  return value;
}

export function requireYes(flags, command) {
  if (flags.yes === undefined || toBool(flags.yes, "--yes") !== true) {
    throw new ConfirmationRequiredError("destructive operation requires --yes", command);
  }
}

// Commands reach the API through the registry, never by handing a raw path to request().
// That is what keeps `replaySafe` and `destructive` a property of the operation rather than
// something each call site has to remember.
export async function invoke(name, { path = {}, query = {}, json, raw = false } = {}) {
  const op = endpoint(name);
  if (!op) throw new Error(`unknown endpoint registry operation: ${name}`);
  return request(expandPath(op.path, path), {
    method: op.method,
    query,
    json,
    auth: op.auth,
    replaySafe: op.replaySafe,
    raw,
  });
}
