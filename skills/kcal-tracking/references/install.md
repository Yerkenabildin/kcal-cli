# Installing kcal-cli

Read this file only when `kcal` is missing from the environment, then follow it exactly.

## Requirements

- **Node.js 22 or newer** — check with `node --version`. npm ships with Node.js.
- Network access to the npm registry (public packages are pulled once at install time).

## Install

```bash
npm install --global kcal-cli
```

Sometimes the install appears to succeed but the binary is not yet on PATH; verify:

```bash
kcal --help
```

If `kcal --help` prints the command tree, installation is complete. No login and no
configuration step is required for local use: kcal creates its own SQLite database on first
write, and external providers (YAZIO, Open Food Facts, OpenRouter) are optional extras.

## If the binary is still not found

1. Confirm npm's global bin directory is on PATH:
   ```bash
   npm prefix -g
   npm bin -g
   ```
2. Add that directory to PATH if missing (`export PATH="$(npm bin -g):$PATH"`), or recheck the
   output of the install step.
3. If the previous step fails because the package is pinned to an old version, install the
   latest explicitly:
   ```bash
   npm install --global kcal-cli@latest
   ```

## If Node.js 22+ is missing

Do **not** silently fall back to an older Node version. Install Node.js 22+ first (system
package manager or the official installer), then re-run the npm install above.

## Fallback for a repository checkout

The binary is a thin wrapper; when the repository is already cloned on disk, the CLI also runs
directly from source without a global install:

```bash
node <repo>/bin/kcal.mjs --help
```

Use this only as a fallback for a local checkout, never as the primary installation.

## Verify end to end

```bash
kcal progress --lang en
```

If no diary exists yet, this still prints a four-line dashboard with zeros and `goal not set`
markers — that is normal and proves the install works.

## Troubleshooting summary

| Symptom | Action |
| --- | --- |
| `kcal: command not found` | global bin not on PATH → add `$(npm bin -g)` to PATH |
| `unknown command: progress` | old version installed → `npm install --global kcal-cli@latest` |
| npm permission error | install Node.js through a version manager or system package manager, then retry |