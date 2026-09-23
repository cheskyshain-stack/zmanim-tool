import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import worker from "../src/worker.js";
import { identity } from "../src/auth.js";
test("signed Access identity, issuer, audience, expiry and granular server permissions", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = { ...await exportJWK(publicKey), kid: "display-test", alg: "RS256", use: "sig" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url).startsWith("https://display-test.cloudflareaccess.com/cdn-cgi/access/certs") ? Response.json({ keys: [key] }) : realFetch(url, options);
  const env = { ACCESS_TEAM_DOMAIN: "display-test.cloudflareaccess.com", ACCESS_AUD: "display-audience", DB: { prepare: () => ({ bind: () => ({ first: async () => ({ capabilities_json: '["announcements"]' }) }) }) } };
  const sign = (email, extra = {}) => new SignJWT({ email, ...extra }).setProtectedHeader({ alg: "RS256", kid: "display-test" }).setIssuer("https://display-test.cloudflareaccess.com").setAudience("display-audience").setExpirationTime("5m").sign(privateKey);
  const request = (token, path = "/api/display/admin/items", method = "GET", body) => new Request("https://shul.example" + path, { method, headers: { "Cf-Access-Jwt-Assertion": token, Origin: "https://shul.example", "X-Display-Request": "1", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : void 0 });
  try {
    const token = await sign("announcements@example.com", { capabilities: ["full"] });
    assert.equal(await identity(request(token), env), "announcements@example.com");
    const denied = await worker.fetch(request(token, "/api/display/admin/items", "POST", { kind: "dedication" }), env);
    assert.equal(denied.status, 403);
    assert.equal((await worker.fetch(request(token, "/api/display/admin/permissions"), env)).status, 403);
    const badAudience = await new SignJWT({ email: "announcements@example.com" }).setProtectedHeader({ alg: "RS256", kid: "display-test" }).setIssuer("https://display-test.cloudflareaccess.com").setAudience("another-app").setExpirationTime("5m").sign(privateKey);
    await assert.rejects(identity(request(badAudience), env), /expired/);
    const expired = await new SignJWT({ email: "announcements@example.com" }).setProtectedHeader({ alg: "RS256", kid: "display-test" }).setIssuer("https://display-test.cloudflareaccess.com").setAudience("display-audience").setExpirationTime(1).sign(privateKey);
    await assert.rejects(identity(request(expired), env), /expired/);
    const tampered = token.slice(0, -10) + "aaaaaaaaaa";
    await assert.rejects(identity(request(tampered), env), /expired/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
