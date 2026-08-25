// The 429/456 distinction in scripts/deepl.mjs, which cost five languages a day's
// translation on 25 Aug 2026 when both statuses rotated the key pool.
//
// fetch is stubbed, so this calls no API and spends no quota. The waits are real, so the
// first case deliberately returns a Retry-After of 0 seconds — the code treats a
// non-positive value as absent and falls back to its own 1s backoff, which is the shortest
// wait the logic can produce and still be the logic.
import test from "node:test";
import assert from "node:assert/strict";
import { translate } from "../deepl.mjs";

const ok = (texts) => ({
  ok: true, status: 200,
  headers: new Headers(),
  json: async () => ({ translations: texts.map((t) => ({ text: `[${t}]` })) }),
});
const status = (code) => ({ ok: false, status: code, headers: new Headers(), text: async () => "" });

const stub = (plan) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const key = init.headers.Authorization;
    const texts = [...new URLSearchParams(init.body).getAll("text")];
    calls.push(key);
    const next = plan.shift();
    return next === 200 ? ok(texts) : status(next);
  };
  return calls;
};

const real = globalThis.fetch;

test("a 429 waits and retries the SAME key rather than rotating", async () => {
  const calls = stub([429, 200]);
  const out = await translate(["a throttled string that is not in the glossary"], { to: "DE" });
  assert.equal(out[0], "[a throttled string that is not in the glossary]");
  assert.equal(calls.length, 2, "one throttled call, one retry");
  assert.equal(calls[0], calls[1], "the retry used the same key");
});

test("a 456 rotates to the next key", async () => {
  const calls = stub([456, 200]);
  await translate(["a second string that is not in the glossary"], { to: "DE" });
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1], "quota exhaustion moves to a different key");
});

test.after(() => { globalThis.fetch = real; });
