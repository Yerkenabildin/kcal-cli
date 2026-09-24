import { UsageError } from "./errors.mjs";

// Drop the last UTF-8 character from a byte array: continuation bytes (0b10xxxxxx) belong to
// the character before them, so a backspace has to walk back past them rather than lopping off
// one byte and leaving a broken sequence behind.
function dropLastChar(bytes) {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] & 0xc0) === 0x80) end--;
  return bytes.slice(0, Math.max(0, end - 1));
}

// A hidden password prompt, written out rather than pulled from a dependency because this
// package has none. The prompt and every byte of feedback go to stderr so that stdout stays a
// clean JSON stream even during an interactive login.
//
// Bytes are accumulated and decoded as UTF-8 at the end rather than converted one at a time:
// a password containing anything outside ASCII arrives as several bytes per character, and
// decoding them individually would silently produce a different password than was typed.
//
// The password deliberately cannot arrive any other way: not as a flag (argv is visible in
// `ps`), not from the environment, not from a file. It is read here, exchanged for a token,
// and dropped.
export function promptHidden(question) {
  const input = process.stdin;
  if (!input.isTTY) {
    throw new UsageError("a password can only be read from an interactive terminal", {
      hint: "run `kcal provider yazio login --email <address>` directly in a terminal, not through a pipe",
    });
  }

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let done = false;
    let bytes = [];

    const restore = () => {
      if (done) return;
      done = true;
      input.removeListener("data", onData);
      try { input.setRawMode(wasRaw); } catch {}
      input.pause();
      process.stderr.write("\n");
    };

    const finish = (fn, argument) => { restore(); bytes = []; fn(argument); };

    const onData = (chunk) => {
      for (const byte of chunk) {
        switch (byte) {
          case 0x03: // Ctrl-C — restore the terminal before leaving, or the shell stays raw.
          case 0x1b: // Esc
            finish(reject, new UsageError("cancelled"));
            return;
          case 0x04: // Ctrl-D on an empty line
            if (bytes.length === 0) { finish(reject, new UsageError("cancelled")); return; }
            break;
          case 0x0d: // Enter
          case 0x0a:
            finish(resolve, Buffer.from(bytes).toString("utf8"));
            return;
          case 0x7f: // Backspace / Delete
          case 0x08:
            bytes = dropLastChar(bytes);
            break;
          case 0x15: // Ctrl-U clears the line, as it does in a shell
            bytes = [];
            break;
          default:
            if (byte >= 0x20) bytes.push(byte);
        }
      }
    };

    process.stderr.write(question);
    input.resume();
    try { input.setRawMode(true); } catch (error) { reject(error); return; }
    input.on("data", onData);
  });
}

export const _internals = { dropLastChar };
