#!/usr/bin/env node
import { parseArgs, printJson } from "../src/util.mjs";
import { errorPayload, UsageError } from "../src/errors.mjs";

const COMMANDS = {
  search: () => import("../src/commands/search-local.mjs"),
  scan: () => import("../src/commands/scan.mjs"),
  item: () => import("../src/commands/item.mjs"),
  food: () => import("../src/commands/food.mjs"),
  recipe: () => import("../src/commands/recipe.mjs"),
  favorite: () => import("../src/commands/favorite.mjs"),
  diary: () => import("../src/commands/diary-local.mjs"),
  goal: () => import("../src/commands/goal.mjs"),
  provider: () => import("../src/commands/provider.mjs"),
};

const HELP = `kcal — local-first nutrition and food-diary CLI

Usage:
  kcal <command> [args] [flags]

Catalog:
  search <query> [--limit N]
  scan <image> [--hint text]
  item show <id> [--amount N --unit g]
  item save|verify|archive <id>
  item update <id> --set key=value
  food create --file product.json
  recipe create --file recipe.json
  recipe update <id> --file recipe.json
  favorite add|remove|list [id]

Diary:
  diary add <id|exact-name> --amount N --unit g --meal <slot>
  diary day [YYYY-MM-DD]
  diary update <entry-id> [--amount N] [--meal slot] [--at timestamp]
  diary remove <entry-id> --yes
  diary totals --start YYYY-MM-DD --end YYYY-MM-DD
  goal set|show

Providers:
  provider yazio login|status|logout
  provider openrouter status

Every success is JSON on stdout. Every error is JSON on stderr.`;

function checkFlags(mod, flags, command) {
  if (!(mod.knownFlags instanceof Set)) return;
  for (const key of Object.keys(flags)) {
    if (!mod.knownFlags.has(key)) {
      throw new UsageError(`unknown flag for "${command}": --${key}`, { known_flags: [...mod.knownFlags].sort() });
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || ["help", "-h", "--help"].includes(command)) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const loader = COMMANDS[command];
  if (!loader) throw new UsageError(`unknown command: ${command}`, { known_commands: Object.keys(COMMANDS).sort() });
  const { positionals, flags } = parseArgs(argv.slice(1));
  const mod = await loader();
  checkFlags(mod, flags, command);
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
