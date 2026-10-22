# Security Policy

## Supported versions

Until the first stable release, only the latest commit on `main` is supported with security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. If that option is unavailable, contact the maintainer privately through the email listed on the maintainer's GitHub profile.

Do not open a public issue containing:

- credentials, access tokens, or account data;
- a working exploit for an unpatched vulnerability;
- personal diary data or nutrition-label images;
- private API traffic that contains user identifiers.

Include affected versions, reproduction steps, impact, and a suggested fix when possible.

## Security model

- The local SQLite database and provider tokens are stored outside the repository in XDG data/config directories.
- YAZIO passwords are accepted only through a hidden terminal prompt or explicit stdin mode and are not persisted.
- Provider tokens are written with restrictive filesystem permissions.
- OpenRouter label fallback sends the selected image to an external service; barcode detection runs locally first.
- The YAZIO provider relies on an unofficial private API and should be treated as an optional, potentially unstable integration.

For implementation details and known private-API risks, see [docs/PRIVATE-API-RISKS.md](docs/PRIVATE-API-RISKS.md).
