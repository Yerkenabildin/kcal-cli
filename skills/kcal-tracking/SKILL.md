---
name: kcal-tracking
description: Use when logging food or tracking nutrition with kcal CLI.
version: 1.3.1
author: Yerkenabildin
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [nutrition, calories, macros, food-diary, sqlite, cli]
    related_skills: []
    requires_toolsets: [terminal]
---

# kcal Tracking

## Overview

Use the `kcal` JSON CLI to search foods, maintain a local catalog, calculate recipe nutrition, and keep a food diary. SQLite is canonical. Open Food Facts and YAZIO are optional lookup providers; OpenRouter is an optional nutrition-label fallback.

The CLI writes successes as JSON to stdout and errors as JSON to stderr. Treat its returned IDs, totals, and exit codes as the source of truth instead of parsing human text.

## When to Use

Load this skill when the user:

- says what they ate or drank and wants it logged;
- asks to add, correct, move, or remove a diary entry;
- asks for daily or range totals, remaining goals, or macros;
- wants to find or save a food, serving, recipe, or barcode;
- provides a package or label image for logging;
- asks to set calorie or macro goals.

Do not log plans, suggestions, shopping lists, or meals the user has not confirmed eating.

## Prerequisite

Check that the CLI is available:

```bash
kcal --help
```

If `kcal` is missing, read the bundled install guide at `references/install.md` in this skill and follow it. Do **not** invent diary state or substitute a different tracker silently. Read that file only when installation is needed; the guide stays out of the main flow to keep context small.

## Core Rules

1. **Consumed food may be logged.** A clear report that the user ate something is authorization to add it. Plans are not.
2. **Resolve material ambiguity.** Do not guess the amount, unit, brand, preparation state, recipe, date, or meal slot when the choice changes nutrition materially.
3. **Prefer exact data.** Resolve exact local aliases first, then local catalog results, then external providers. Estimate only when the user accepts the assumptions.
4. **Write idempotently.** Every logical diary addition gets one stable `--op-key`. Reuse it on retry; never reuse it for a different item or quantity.
5. **Verify mutations.** Check the returned `day` object or call `kcal diary day`. A command exit alone is not sufficient evidence.
6. **Do not blindly replay exit code 6.** Read the diary and reconcile whether the write landed.
7. **Keep credentials out of argv.** Never pass passwords or API keys as ordinary command arguments.
8. **Shell-quote every user-supplied value** in commands you construct (`--hint`, query, item id, `--op-key`, file paths). Treat user input as data, never as shell syntax.

## Standard Logging Workflow

### 1. Parse the report

Resolve:

- item or recipe;
- amount and unit (`g`, `ml`, or `piece`);
- meal (`breakfast`, `lunch`, `dinner`, or `snack`);
- date/time when not today/current time;
- brand, flavor, fat percentage, and raw/cooked/prepared state when relevant.

Ask only for the smallest missing fact that materially changes the entry.

### 2. Resolve the item

For a known exact local name or alias, a direct diary write is acceptable. Otherwise search:

```bash
kcal search "<query>" --limit 10
```

Inspect a candidate when its basis, servings, or nutrients need confirmation:

```bash
kcal item show <item-id>
kcal item show <item-id> --amount <N> --unit <g|ml|piece>
```

Choose automatically only when one result clearly matches the requested product, brand, state, and unit. If plausible candidates differ materially, present a short choice or ask for a barcode/photo.

Search does not permanently import an external item. Adding it to the diary, a recipe, Favorites, or using `item save` materializes it transactionally while retaining its source ID.

### 3. Add once

```bash
kcal diary add <item-id|exact-name> \
  --amount <N> \
  --unit <g|ml|piece> \
  --meal <breakfast|lunch|dinner|snack> \
  [--date YYYY-MM-DD] \
  [--at "YYYY-MM-DD HH:MM:SS"] \
  --op-key <stable-key>
```

Prefer the platform message ID as the stable key. If one message contains several foods, use a distinct suffix per component. After a partial failure, retry only failed components with their original keys.

### 4. Verify and report

Use the `day` object from `diary add` when present. Otherwise:

```bash
kcal diary day [YYYY-MM-DD]
```

Confirm that the intended entry exists exactly once and that totals changed as expected. Report the logged item, amount, nutrients, daily total, and remaining goals when configured. Label estimates and incomplete nutrients explicitly.

After every successful diary mutation, and when the user asks for daily progress, run the built-in dashboard:

```bash
kcal progress [YYYY-MM-DD] [--lang en|ru]
```

The dashboard is a native `kcal` command, so no helper scripts are involved. It reads goals from `kcal diary day`, never substitutes hard-coded targets, and always shows calories, protein, fat, and fiber. When a goal exists it shows a bar and percentage; without a goal it shows the current value and `goal not set` / `цель не задана`, without inventing a bar or percentage. Incomplete totals are marked as lower bounds with `≥` and never rounded upward. Use its output verbatim in a fenced code block so the bars remain aligned. Choose `--lang ru` only when replying in Russian; English is the default. For a non-today mutation, always pass the affected date.

## Corrections and Removal

Read the day first and identify the exact `e::` entry:

```bash
kcal diary day YYYY-MM-DD
```

Update it:

```bash
kcal diary update e::<uuid> [--amount N] [--unit unit] [--meal slot] [--at "YYYY-MM-DD HH:MM:SS"]
```

Remove only after a clear user request:

```bash
kcal diary remove e::<uuid> --yes
```

Read the affected day again. When similar entries exist, compare ID, meal, amount, and timestamp instead of selecting by name alone.

## Goals and Totals

```bash
kcal diary day [YYYY-MM-DD]
kcal diary totals --start YYYY-MM-DD --end YYYY-MM-DD
kcal goal show
kcal goal set [--energy N] [--protein N] [--fat N] [--carb N] [--fiber N]
```

Do not change goals merely because the user discusses a possible target. `goal set` preserves unspecified fields.

If `incomplete_nutrients` includes `fiber_g` or another nutrient, report known totals as incomplete rather than treating missing values as zero.

## Foods, Favorites, and Recipes

Useful commands:

```bash
kcal favorite add <item-id> [--alias "<recurring name>"]
kcal favorite remove <item-id>
kcal favorite list
kcal item save <item-id>
kcal item verify <item-id>
kcal recipe show <recipe-id>
```

Add an alias only after the mapping is confirmed and likely to recur. Create foods and recipes from complete, verified JSON; do not fabricate exact nutrition.

Raw and cooked weights are different states. Do not mix them. Water changes nutrition per 100 g, not the total calories of a recipe.

## Labels and Barcodes

```bash
kcal scan /absolute/path/to/image [--hint "<product>"]
```

The CLI scans barcodes locally first. If it cannot resolve a product, it returns an error asking for `--allow-ai` instead of uploading automatically.

Before rerunning with `--allow-ai`, explain that the full image, hint, and decoded QR payload may be sent to OpenRouter and obtain the user's explicit consent. Only then run:

```bash
kcal scan /absolute/path/to/image [--hint "<product>"] --allow-ai
```

Images larger than 20 MiB are rejected.

- If the result is `active`, inspect identity, basis, and core nutrients before logging.
- If it is `needs_review`, correct or complete it with `item update` before use.
- Do not claim a barcode match when the result came only from model-based label recognition.

## Provider Status

```bash
kcal provider yazio status
kcal provider openrouter status
```

A YAZIO failure does not make the local diary unavailable. Continue with local data and Open Food Facts where possible, and report provider degradation accurately.

## Exit Codes

| Code | Meaning | Agent action |
| ---: | --- | --- |
| `0` | Success | Verify result |
| `1` | Runtime/provider error | Report or try another provider |
| `2` | Usage/schema error | Correct input; do not guess fields |
| `3` | Authentication required | Ask the user to authenticate securely |
| `4` | Confirmation required | Retry with `--yes` only after clear authorization |
| `5` | Ambiguity/conflict | Inspect candidates and retry with selected ID |
| `6` | Remote result unknown | Read back; never blindly replay |
| `7` | Private API changed | Report YAZIO degradation; use local/OFF data |

## Common Pitfalls

1. Logging a plan instead of consumed food.
2. Reusing one idempotency key for different entries.
3. Retrying an uncertain write before reading back.
4. Taking the first search result despite brand or preparation mismatch.
5. Treating provider base-unit nutrients as per-100 values.
6. Guessing a `piece` conversion when no compatible portion exists.
7. Mixing raw and cooked weights.
8. Forgetting material oils, sauces, drinks, or toppings.
9. Claiming success without verifying the diary day.
10. Treating an unavailable external provider as loss of the local diary.

## Verification Checklist

- [ ] The report describes food actually consumed.
- [ ] Item, amount, unit, meal, and date are resolved.
- [ ] Product or recipe matches brand and preparation state.
- [ ] The write used a stable, unique `--op-key`.
- [ ] The entry exists exactly once on the intended day.
- [ ] Returned totals reflect the mutation.
- [ ] Estimates, incomplete nutrients, and provider degradation are explicit.
