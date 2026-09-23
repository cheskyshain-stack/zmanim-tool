import { createRemoteJWKSet, jwtVerify } from "jose";
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const CAPABILITIES = ["full", "announcements", "dedications", "schedules"];
let signingKeys, signingDomain;
export async function identity(request, env) {
  const host = new URL(request.url).hostname;
  if (env.LOCAL_DEVELOPMENT === "true" && ["127.0.0.1", "localhost", "[::1]"].includes(host)) return "local-admin";
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || "") || !env.ACCESS_AUD) throw new ApiError(503, "Server sign-in must be configured before display management can be used online.");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new ApiError(401, "Sign in to manage the display.");
  try {
    if (signingDomain !== env.ACCESS_TEAM_DOMAIN) {
      signingKeys = createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
      signingDomain = env.ACCESS_TEAM_DOMAIN;
    }
    const { payload } = await jwtVerify(token, signingKeys, { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD, algorithms: ["RS256"], requiredClaims: ["exp", "email"] });
    if (!payload.email) throw Error();
    return payload.email.toLowerCase();
  } catch {
    throw new ApiError(401, "Your sign-in expired. Please sign in again.");
  }
}
export async function actor(request, env) {
  const email = await identity(request, env);
  let capabilities = [];
  if (email === "local-admin" || (env.DISPLAY_ADMINS || "").split(",").map((s) => s.trim().toLowerCase()).includes(email)) capabilities = ["full"];
  else {
    const row = await env.DB.prepare("SELECT capabilities_json FROM display_permissions WHERE email=?").bind(email).first();
    if (row) capabilities = JSON.parse(row.capabilities_json);
  }
  if (!capabilities.length) throw new ApiError(403, "This account has no display permissions.");
  return { email, capabilities };
}
export function allow(who, kind) {
  const cap = { announcement: "announcements", dedication: "dedications", schedule: "schedules" }[kind] || kind;
  if (!who.capabilities.includes("full") && !who.capabilities.includes(cap)) throw new ApiError(403, "You do not have permission for this action.");
}
