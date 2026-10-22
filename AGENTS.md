# AGENTS.md

Guidance for coding agents working in this repository (`CLAUDE.md` is a symlink here).

## What this is

`kcal` is a local-first Node.js 22+ JSON CLI for food search, nutrition labels, recipes,
favorites, goals, and a food diary. SQLite is canonical. Open Food Facts and the private,
unofficial YAZIO API are search providers. OpenRouter is a barcode-miss fallback for label
recognition. The `yazio` binary is a deprecated alias of `kcal`, not a second implementation.

Runtime dependencies are intentional:

- `better-sqlite3` for the local source of truth and FTS5;
- `zxing-wasm` for local barcode/QR decoding;
- `ajv` for product, recipe, and structured-label validation.

## Commands

```bash
npm test
node --test test/local-diary.test.mjs
node --test --test-name-pattern="<regex>" test/local-diary.test.mjs
node --check bin/kcal.mjs
npm pack --dry-run
node bin/kcal.mjs <command>
```

The standard test suite is fully network-free. Tests mock `globalThis.fetch`; live provider tests,
if added, must be explicit opt-in.

Use red-green-refactor for behavioral changes: first add the smallest test that demonstrates the
missing CLI, SQLite, provider, or scan behavior; see it fail for the intended reason; then make
the minimum implementation change and run the focused test before the full suite.

## Architecture

- `bin/kcal.mjs` is the only command dispatcher. It lazily loads one module per top-level
  command, validates `knownFlags`, prints successes as JSON on stdout, and errors as JSON on
  stderr. `bin/yazio.mjs` only imports it.
- `src/db.mjs` owns SQLite connection setup, migrations, transactions, and FTS refreshes.
- `src/catalog.mjs` owns local products, recipes, favorites, search ranking, and nutrient
  calculation.
- `src/local-diary.mjs` owns diary snapshots, revisions, idempotency keys, totals, and goals.
- `src/services/catalog-service.mjs` combines local/provider search and controls transactional
  materialization of external IDs.
- `src/services/scan-service.mjs` performs local ZXing detection before an explicit
  `--allow-ai` OpenRouter fallback; image upload is never automatic.
- `src/providers/` is the external boundary for YAZIO, Open Food Facts, and OpenRouter.
- `src/schemas.mjs` is the runtime source of truth for product/recipe/label JSON schemas.
- `src/errors.mjs` maps failures to exit codes and redacts secrets from printed payloads.

Command modules do not call external APIs directly. Read configuration from `src/config.mjs`,
never `process.env` directly. A read-only command must use `openDatabase({ create: false })` and
must work with `null` when no database exists.

## Data rules

- Public IDs retain their origin: `l::`, `r::`, `y::`, `off::`, `scan::`, and diary `e::`.
- Search alone does not add an item to the permanent catalog. Actual use materializes it without
  changing the ID.
- Materialization plus a recipe or diary write is one transaction. Never leave an external item
  behind when the enclosing operation fails.
- Recipes may include recipes, but cycles are forbidden. Version 1 does not convert `g` and `ml`.
- Diary entries keep the item name, version, quantity, unit, and complete nutrient snapshot.
  Later catalog or recipe changes must not rewrite history.
- Favorites are explicit. Recent ranking is derived from active diary entries.
- Image bytes are never stored in SQLite; scan metadata includes SHA-256, path, structured output,
  model, and warnings.
- Secrets are never accepted through ordinary argv flags, printed in JSON, or stored in SQLite.

## YAZIO provider constraints

YAZIO's API is private and reverse engineered. The field guide is
[`yazio-community/yazio-api-specification`](https://github.com/yazio-community/yazio-api-specification)
(v22). Tolerate unknown response fields and do not infer that an undocumented endpoint is absent.
See `docs/PRIVATE-API-RISKS.md` for evidence and failure modes.

- Every non-token request needs an accepted app `User-Agent`; a retired version produces
  `403 {"error":"version_blocked"}`.
- Search requires nonblank `sex` and `countries` and is ranked by `Accept-Language`.
- Product nutrients are per one base unit, not per 100. Energy is kcal; other values are grams.
- YAZIO diary endpoints remain internal legacy code in v1 and are not exposed by `kcal`.
- The account password is read only from hidden TTY or explicit stdin mode. Only tokens are saved.

## Exit codes and safety

`0` success · `1` API/runtime · `2` usage/schema validation · `3` authentication required ·
`4` confirmation required · `5` ambiguity/conflict · `6` remote write result unknown ·
`7` private API changed.

Destructive commands never prompt. Without `--yes`, return `confirmation_required` with the exact
retry command. All nutrient keys include units (`energy_kcal`, `protein_g`, and so on).
