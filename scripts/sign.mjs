// PRISM Mozilla signing.
//
// Signs dist/prism.zip via the AMO API v5 (JWT HS256). Channel is ALWAYS
// "unlisted" — the add-on is signed but never published to addons.mozilla.org.
// GitHub Releases are the only distribution channel.
//
// Env: AMO_JWT_ISSUER, AMO_JWT_SECRET, AMO_GUID (default prism@mheci.github.io),
//      AMO_TIMEOUT_MIN (default 25).
// Output: dist/prism-signed.xpi
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const GUID = process.env.AMO_GUID || "prism@mheci.github.io";
const ISSUER = process.env.AMO_JWT_ISSUER;
const SECRET = process.env.AMO_JWT_SECRET;
const TIMEOUT_MS = (Number(process.env.AMO_TIMEOUT_MIN) || 25) * 60 * 1000;
const API = "https://addons.mozilla.org/api/v5/addons";

const zipPath = path.join(root, "dist", "prism.zip");
const xpiPath = path.join(root, "dist", "prism-signed.xpi");

if (!ISSUER || !SECRET) {
  console.error("Missing AMO_JWT_ISSUER or AMO_JWT_SECRET env vars");
  process.exit(1);
}
if (!fs.existsSync(zipPath)) {
  console.error("dist/prism.zip not found — run npm run build first");
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const jwt = () => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 180 }));
  const sig = crypto.createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
};
const auth = () => ({ Authorization: `JWT ${jwt()}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries transient failures (429 throttle, 5xx) with exponential backoff.
// The JWT is refreshed on every attempt (AMO tokens expire in ~5 minutes).
async function fetchRetry(url, opts, { attempts = 6, baseMs = 15000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const attemptOpts = { ...opts, headers: { ...(opts.headers || {}), ...auth() } };
    const res = await fetch(url, attemptOpts);
    if (res.status !== 429 && res.status < 500) return res;
    last = res;
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    const waitMs = Math.min(600000, Math.max(5000, retryAfter * 1000 || baseMs * 2 ** i));
    console.log(`  throttled (${res.status}) — retrying in ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
  throw new Error(`request kept failing with status ${last && last.status}`);
}

async function stage() {
  const form = new FormData();
  form.append("upload", new Blob([fs.readFileSync(zipPath)]), "prism.zip");
  form.append("channel", "unlisted");
  const res = await fetchRetry(`${API}/upload/`, { method: "POST", headers: auth(), body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Staging failed (${res.status}):`, JSON.stringify(body).slice(0, 600));
    process.exit(1);
  }
  console.log(`Staged upload ${body.uuid} (channel ${body.channel})`);
  return body.uuid;
}

async function waitValidated(uuid) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/upload/${uuid}/`, { headers: auth() });
    const u = await res.json().catch(() => ({}));
    if (u.processed) {
      if (!u.valid) {
        console.error("Validation failed:");
        for (const m of (u.validation && u.validation.messages) || []) {
          console.error(`  [${m.id || m.type || "?"}] ${m.message}`);
        }
        process.exit(1);
      }
      console.log(`Upload validated (version ${u.version || "n/a"})`);
      return;
    }
    await sleep(5000);
  }
  console.error("Timed out waiting for validation.");
  process.exit(1);
}

async function submit(uuid) {
  const createRes = await fetch(`${API}/addon/`, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, auth()),
    body: JSON.stringify({ version: { upload: uuid } }),
  });
  if (createRes.ok) {
    const created = await createRes.json().catch(() => ({}));
    console.log(`Created add-on ${GUID}, submitted version ${created.version && created.version.version}`);
    return created.version && created.version.id;
  }
  const vres = await fetchRetry(
    `${API}/addon/${GUID}/versions/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload: uuid }),
    },
    { attempts: 12, baseMs: 30000 }
  );
  const vbody = await vres.json().catch(() => ({}));
  if (!vres.ok) {
    throw new Error(`version submission failed (${vres.status}): ${JSON.stringify(vbody).slice(0, 600)}`);
  }
  console.log(`Submitted new version ${vbody.version} — id ${vbody.id}`);
  return vbody.id;
}

async function pollSigned(versionId) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const res = await fetchRetry(`${API}/addon/${GUID}/versions/${versionId}/`, { headers: auth() }, { attempts: 4, baseMs: 15000 });
    const v = await res.json().catch(() => ({}));
    const status = v.status || "unknown";
    if (status !== last) {
      console.log(`  version status: ${status}`);
      last = status;
    }
    if (v.file && v.file.id && v.file.status === "public") {
      return v.file.url;
    }
    if (status === "disabled" || status === "rejected") {
      console.error("Version rejected:", JSON.stringify(v).slice(0, 800));
      process.exit(1);
    }
    await sleep(15000);
  }
  console.error("Timed out waiting for signing.");
  process.exit(1);
}

async function download(url) {
  const res = await fetchRetry(url, { headers: auth() }, { attempts: 4, baseMs: 10000 });
  if (!res.ok) {
    console.error(`Download failed (${res.status})`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(xpiPath, buf);
  console.log(`Saved dist/prism-signed.xpi (${(buf.length / 1024).toFixed(1)} KB)`);
}

// Full pipeline with re-stage on stale-upload failure (AMO uploads expire
// while the submit endpoint is throttled).
async function run() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const uuid = await stage();
      await waitValidated(uuid);
      const versionId = await submit(uuid);
      const url = await pollSigned(versionId);
      await download(url);
      console.log("Signing complete — artifact never published to AMO.");
      return;
    } catch (err) {
      const msg = String(err && err.message || err);
      // A stale upload surfaces as a 400 on submit; re-stage and retry.
      if (/upload.*required|expired|not found/i.test(msg) && attempt < 3) {
        console.log(`  upload issue (${msg.slice(0, 80)}) — re-staging (attempt ${attempt + 1})`);
        continue;
      }
      console.error("Signing error:", msg);
      process.exit(1);
    }
  }
}

await run();
