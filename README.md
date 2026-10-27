# kcal

A local-first JSON CLI for food search, nutrition labels, recipes, goals, and a food diary.

`kcal` is designed for both humans at a terminal and AI agents that need a stable, machine-readable interface. SQLite is the source of truth; external services are optional lookup providers.

[Русская документация](docs/README.ru.md)

## Why kcal?

- **Local-first:** your catalog, recipes, diary, goals, and history live in SQLite.
- **Agent-friendly:** one JSON document on stdout for success, one JSON document on stderr for failure, and documented exit codes.
- **Safe retries:** diary writes support idempotency keys.
- **Provider-resilient:** local data remains usable if an external provider is unavailable.
- **Nutrition-aware:** calories, protein, fat, carbohydrates, fiber, portions, aliases, and recipe yields.
- **Label scanning:** local barcode detection first; optional AI label recognition only as a fallback.

## Providers

| Provider | Purpose | Required? |
| --- | --- | --- |
| Local SQLite | Catalog, recipes, diary, goals, revisions | Yes |
| Open Food Facts | Product and barcode lookup | No |
| YAZIO private API | Additional product search | No |
| OpenRouter | Nutrition-label recognition after barcode lookup fails | No |

> [!WARNING]
> The YAZIO integration uses an unofficial, reverse-engineered private API. It can break when YAZIO changes its API or mobile-client requirements. It is not required for the local diary or Open Food Facts integration. See [Private API risks](docs/PRIVATE-API-RISKS.md).

## Requirements

- Node.js 22 or newer
- npm
- A C/C++ toolchain only when `better-sqlite3` has no prebuilt binary for your platform

## Install

Install the published package from npm:

```bash
npm install --global kcal-cli
kcal --help
```

npm package: [kcal-cli](https://www.npmjs.com/package/kcal-cli)

From a checkout:

```bash
git clone https://github.com/Yerkenabildin/kcal-cli.git
cd kcal-cli
npm ci
npm link
kcal --help
```

The primary binary is `kcal`. The `yazio` binary is retained as a deprecated compatibility alias.

## Quick start

Create a local food from JSON:

```bash
kcal food create --file product.json
```

Search, save an alias, and log a meal:

```bash
kcal search "lentils" --limit 10
kcal favorite add off::8712345678905 --alias "my lentils"
kcal diary add "my lentils" --amount 200 --unit g --meal lunch \
  --op-key message-1842
kcal diary day
```

Set daily goals:

```bash
kcal goal set --energy 2000 --protein 120 --fat 70 --carb 220 --fiber 30
kcal goal show
```

Scan a package or nutrition label:

```bash
# Barcode scan stays local unless a product lookup is needed.
kcal scan ./label.jpg --hint "lentil bread"

# Only after explicit consent to upload the image to OpenRouter:
export OPENROUTER_API_KEY="..."
kcal scan ./label.jpg --hint "lentil bread" --allow-ai
```

The CLI scans barcodes locally first. It sends the image to OpenRouter only when barcode lookup cannot resolve a product and `--allow-ai` was explicitly supplied. Images larger than 20 MiB are rejected.

## Command overview

```text
kcal search <query> [--limit 10]

kcal item show <item-id> [--amount 200 --unit g]
kcal item save <item-id>
kcal item update <item-id> --set key=value [--set key=value ...]
kcal item verify <item-id>
kcal item archive <item-id> --yes

kcal food create --file <product.json|->
kcal recipe create --file <recipe.json|->
kcal recipe update <recipe-id> --file <recipe.json|->
kcal recipe show <recipe-id>

kcal favorite add <item-id> [--alias "my milk"]
kcal favorite remove <item-id>
kcal favorite list

kcal diary add <item-id|exact-name> --amount N --unit <g|ml|piece> \
  --meal <breakfast|lunch|dinner|snack> [--date YYYY-MM-DD] \
  [--at "YYYY-MM-DD HH:MM:SS"] [--op-key key]
kcal diary day [YYYY-MM-DD]
kcal diary update <entry-id> [--amount N] [--unit unit] [--meal slot] [--at timestamp]
kcal diary remove <entry-id> --yes
kcal diary totals --start YYYY-MM-DD --end YYYY-MM-DD

kcal goal set [--energy N] [--protein N] [--fat N] [--carb N] [--fiber N]
kcal goal show

kcal scan <image> [--hint text] [--limit 10] [--allow-ai]

kcal provider yazio login --email user@example.com
kcal provider yazio status [--refresh]
kcal provider yazio logout
kcal provider openrouter status
```

Run `kcal --help` for the complete command tree.

## Data model

Public IDs retain their source:

| Prefix | Entity |
| --- | --- |
| `l::` | Local food |
| `r::` | Recipe |
| `off::` | Open Food Facts item |
| `y::` | YAZIO item |
| `scan::` | Scanned label |
| `e::` | Diary entry |

External search results are not imported merely by searching. They are materialized transactionally when first used in a diary entry, recipe, Favorite, or `item save`.

Diary entries store a complete nutrient snapshot. Later catalog or recipe changes do not rewrite history.

### Minimal food JSON

```json
{
  "schema_version": 1,
  "kind": "food",
  "name": "Lentil bread",
  "aliases": ["my bread"],
  "brand": null,
  "barcodes": [],
  "state": "as_sold",
  "basis": { "amount": 100, "unit": "g" },
  "nutrients": {
    "energy_kcal": 240,
    "protein_g": 18,
    "fat_g": 5,
    "carb_g": 31,
    "fiber_g": 9
  },
  "other_nutrients": {},
  "portions": [{ "name": "slice", "amount": 45, "unit": "g" }],
  "category": "prepared_dish",
  "tags": []
}
```

Allowed units are `g`, `ml`, and `piece`. Version 1 does not convert between mass, volume, and pieces.

### Minimal recipe JSON

```json
{
  "schema_version": 1,
  "kind": "recipe",
  "name": "Lentil soup",
  "aliases": [],
  "ingredients": [
    { "item_id": "l::<uuid>", "amount": 200, "unit": "g" }
  ],
  "yield": { "amount": 1200, "unit": "g" },
  "portions": [{ "name": "bowl", "amount": 350, "unit": "g" }],
  "tags": []
}
```

Recipes may include other recipes. Cycles, missing items, incompatible units, and non-positive quantities are rejected.

## Search order

Name search:

1. Exact local name or alias
2. Local Favorites and Recent items
3. Remaining local catalog through FTS5
4. YAZIO
5. Open Food Facts

Barcode search:

1. Local catalog
2. Open Food Facts
3. YAZIO

A failure from one provider does not discard local results or results from another provider. Provider failures are returned in `provider_errors`.

## JSON protocol and exit codes

Every successful invocation emits one JSON document to stdout. Every failure emits one JSON document to stderr.

| Code | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Runtime or provider error |
| `2` | Usage or schema validation error |
| `3` | Authentication required |
| `4` | Explicit confirmation required |
| `5` | Ambiguity or verification conflict |
| `6` | Remote write result unknown; do not blindly retry |
| `7` | Private YAZIO API changed |

Destructive commands require `--yes` and otherwise return the exact retry command. For diary writes, reuse the same `--op-key` after an interrupted call.

## Storage

```text
SQLite:       ${XDG_DATA_HOME:-~/.local/share}/kcal/kcal.sqlite3
Config/tokens:${XDG_CONFIG_HOME:-~/.config}/kcal/
State:        ${XDG_STATE_HOME:-~/.local/state}/kcal/
```

Read-only local commands do not create a missing database. Migrations run on the first mutating command.

## Configuration

The CLI does not load `.env` automatically. Export variables in your shell or use an environment manager. See [.env.example](.env.example).

Important variables:

| Variable | Purpose |
| --- | --- |
| `KCAL_DB_FILE` | Override SQLite file path |
| `KCAL_DATA_DIR` | Override data directory |
| `KCAL_CONFIG_DIR` | Override config/token directory |
| `KCAL_STATE_DIR` | Override state directory |
| `OPENROUTER_API_KEY` | Optional label-recognition key |
| `KCAL_OPENROUTER_MODEL` | OpenRouter model; defaults to `openrouter/auto` |
| `KCAL_OFF_USER_AGENT` | Open Food Facts User-Agent |
| `YAZIO_USER_AGENT` | Accepted YAZIO mobile-client version |
| `YAZIO_ACCEPT_LANGUAGE` | YAZIO search language/ranking |
| `YAZIO_COUNTRIES` | Override YAZIO countries |
| `YAZIO_LOCALES` | Override YAZIO locales |
| `YAZIO_TOKEN_FILE` | Override saved token path |

Passwords are never accepted through ordinary argv flags, printed in JSON, or stored in SQLite. YAZIO login reads a password from a hidden TTY or explicit stdin mode and saves only tokens.

## Hermes Agent skill

This repository includes an agent workflow at [`skills/kcal-tracking/SKILL.md`](skills/kcal-tracking/SKILL.md).

Install it directly from this public repository:

```bash
hermes skills install Yerkenabildin/kcal-cli/skills/kcal-tracking
```

The skill teaches Hermes when to log food, how to resolve ambiguous products, how to use idempotency keys, and how to verify every diary mutation.

## Development

```bash
npm ci
npm test
node --check bin/kcal.mjs
npm pack --dry-run
```

The standard suite is network-free; provider calls are mocked. Live-provider checks are intentionally excluded from the default test suite and must never run in CI with a personal account.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
