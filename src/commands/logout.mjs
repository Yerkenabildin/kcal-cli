// yazio logout — forgets the cached tokens. There is no password to forget.
import { deleteTokens, loadTokens, tokenFilePath } from "../auth.mjs";

export const knownFlags = new Set([]);

export async function run() {
  const had = loadTokens() !== null;
  deleteTokens();
  return { ok: true, operation: "logout", changed: had, token_file: tokenFilePath() };
}
