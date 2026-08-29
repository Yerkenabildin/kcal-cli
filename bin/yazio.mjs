#!/usr/bin/env node
import { parseArgs, printJson } from "../src/util.mjs";
import { errorPayload, UsageError } from "../src/errors.mjs";

// Lazily loaded so that `yazio --help` and a usage error never pay for importing the
// HTTP client, and so a broken command module cannot take the whole CLI down with it.
const COMMANDS = {
  login: () => import("../src/commands/login.mjs"),
  status: () => import("../src/commands/status.mjs"),
  logout: () => import("../src/commands/logout.mjs"),
};

const HELP = `yazio — CLI facade for the private YAZIO food-diary API

Usage:
  yazio <command> [args] [flags]

Auth:
  login --email <address>   sign in; the password is typed at a hidden prompt
  status [--refresh]        what the stored credentials are good for
  logout                    forget the stored tokens

All successful command output is JSON on stdout. Errors are JSON on stderr.

Exit codes:
  0 success            4 confirmation required
  1 api/runtime        5 ambiguous match or verification conflict
  2 usage/validation   6 write result unknown
  3 auth required      7 api changed (version_blocked or unrecognised shape)`;

function checkFlags(mod, flags, command) {
  if (!(mod.knownFlags instanceof Set)) return;
  for (const key of Object.keys(flags)) {
    if (!mod.knownFlags.has(key)) {
      throw new UsageError(`unknown flag for "${command}": --${key}`, {
        known_flags: [...mod.knownFlags].sort(),
      });
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || ["help", "-h", "--help"].includes(cmd)) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  const loader = COMMANDS[cmd];
  if (!loader) throw new UsageError(`unknown command: ${cmd}`, { known_commands: Object.keys(COMMANDS).sort() });
  const { positionals, flags } = parseArgs(argv.slice(1));
  const mod = await loader();
  checkFlags(mod, flags, cmd);
  const result = await mod.run(positionals, flags, {});
  if (result !== undefined) printJson(result);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  printJson(errorPayload(error), process.stderr);
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
}
