# Contributing

Thanks for improving `kcal`.

## Setup

Requirements: Node.js 22+ and npm.

```bash
git clone https://github.com/Yerkenabildin/kcal-cli.git
cd kcal-cli
npm ci
npm test
```

## Development workflow

1. Create a focused branch.
2. For behavior changes, add the smallest failing test first.
3. Make the minimum implementation change.
4. Run the focused test, then the full suite.
5. Verify package contents before opening a pull request.

```bash
npm test
node --check bin/kcal.mjs
node --check bin/yazio.mjs
npm pack --dry-run
```

The standard test suite must stay network-free. Mock `globalThis.fetch`; live-provider tests must be explicit opt-in tests.

## Project invariants

- SQLite is the source of truth for catalog, recipes, goals, and diary.
- Read-only commands must not create a missing database.
- External search alone must not materialize items.
- Materialization and the enclosing diary/recipe/Favorite write must be one transaction.
- Diary entries retain immutable nutrient snapshots.
- Command modules do not call provider APIs directly.
- Secrets must not be accepted through ordinary argv flags, printed, or stored in SQLite.
- Success is one JSON document on stdout; failure is one JSON document on stderr.
- New nutrient keys include units in their names.

See [AGENTS.md](AGENTS.md) for architecture and detailed contributor guidance.

## Pull requests

Include:

- the problem and chosen behavior;
- tests covering the change;
- any compatibility or migration impact;
- provider/API evidence when changing unofficial YAZIO behavior.

Do not include real tokens, passwords, personal food diaries, SQLite databases, or package-label images.

## Releases

1. Update the version in `package.json` and `package-lock.json` and move the relevant changelog entries into a dated release section.
2. Merge the release commit into `main`.
3. Publish a GitHub release with a matching `vX.Y.Z` tag.
4. The `publish` workflow verifies the tag, runs the full test and package checks, and publishes to npm through Trusted Publishing (OIDC).

The release workflow intentionally uses no long-lived `NPM_TOKEN` secret.

## Reporting security issues

Follow [SECURITY.md](SECURITY.md). Do not open a public issue for an unpatched vulnerability or leaked credential.
