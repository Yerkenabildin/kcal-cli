# yazio-cli

A zero-dependency Node.js CLI for the private [YAZIO](https://www.yazio.com) food-diary API.
Search the food database, read your diary, and log what you ate — with every write verified by
reading it back.

> **Unofficial and unsupported.** YAZIO publishes no API. This talks to the private API behind
> the mobile app, described by the community at
> [`yazio-community/yazio-api-specification`](https://github.com/yazio-community/yazio-api-specification).
> It can break without notice, and using it is subject to YAZIO's terms of service.

## Install

```bash
git clone <this repo> ~/tools/yazio-cli && cd ~/tools/yazio-cli && npm link
yazio --help
```

Requires Node 18+. There are no dependencies to install.

## Usage

```bash
yazio login --email you@example.com    # hidden password prompt; only tokens are stored
yazio status
```

Every successful command prints JSON on stdout. Errors print JSON on stderr and set an exit
code: `2` usage, `3` auth required, `4` confirmation required, `5` ambiguous match or
verification conflict, `6` write result unknown, `7` API changed.

## Safety properties

The point of this CLI, rather than calling the API directly, is that these hold:

- **A diary write is sent exactly once.** The entry id is generated locally and derived from the
  operation key, so repeating an operation cannot silently duplicate your food.
- **Every write is verified by reading the day back.** If the outcome of a request is unknown,
  the CLI re-reads rather than re-sending, and reports `write_result_unknown` if it still cannot tell.
- **Deletion finds the entry first.** The API answers `204` even when it removed nothing, so the
  bucket is discovered by reading the day and the absence is confirmed by reading it again.
- **The password is never persisted.** It is read from a hidden TTY prompt, exchanged for tokens,
  and dropped. Tokens live in `~/.config/yazio-cli/token.json` with mode `0600`.

## Configuration

All optional — see `.env.example`. The one you are most likely to need is `YAZIO_USER_AGENT`:
the API rejects client versions it does not recognise, so when every call starts failing with
`api_changed`, that string needs bumping.

## License

MIT
