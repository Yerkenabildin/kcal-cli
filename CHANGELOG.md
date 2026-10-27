# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Goal-aware progress dashboard for the bundled Hermes skill, with calories, protein, fat, fiber, English/Russian labels, and truthful lower bounds for incomplete fiber totals.

## [0.2.1] - 2026-10-27

### Added

- Published `kcal-cli` to npm with the `kcal` and deprecated `yazio` binaries.
- Automated npm releases from GitHub Releases through Trusted Publishing (OIDC), without a long-lived npm token.
- Public Hermes Agent skill for safe food-diary automation.
- English project overview and preserved Russian reference documentation.
- Contributor and security documentation.
- Explicit `--allow-ai` consent gate and 20 MiB image limit before OpenRouter label recognition.

## [0.2.0] - 2026-10-22

### Added

- Local-first SQLite catalog, recipes, Favorites, goals, and food diary.
- Open Food Facts, optional YAZIO search, and OpenRouter label recognition.
- Idempotent diary writes, revision history, and stable JSON/exit-code protocol.
- Local barcode scanning and transactional external-item materialization.

[Unreleased]: https://github.com/Yerkenabildin/kcal-cli/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/Yerkenabildin/kcal-cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Yerkenabildin/kcal-cli/releases/tag/v0.2.0
