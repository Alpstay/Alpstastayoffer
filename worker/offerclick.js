/**
 * ALPSTAY — offerclick: conteggio aperture delle offerte (Cloudflare Worker)
 * Sorgente TypeScript: worker.ts (repository Alpstay/Alpstastayoffer, cartella worker/).
 * Binding richiesto: D1 «alpstay-offerte-click» con nome variabile DB.
 * Salva solo id offerta, tipo di evento, pulsante, lingua e ora: nessun IP, nome o email.
 */
const ALLOWED_ORIGINS = ["https://alpstay.github.io"];
const OFFER_ID = /^r(\d{3,9})-\d{4}-\d{2}-\d{2}$/;
const SLOT = /^[a-z0-9-]{1,30}$/;
const KINDS = ["open", "choose", "book"];
const DEDUP_SECONDS = 60;
function cors(origin) {
  const ok = origin !== null && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function parseHit(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  const o = typeof r.o === "string" ? r.o : "";
  const k = typeof r.k === "string" ? r.k : "";
  if (!OFFER_ID.test(o) || !KINDS.includes(k)) return null;
  const g = typeof r.g === "string" && SLOT.test(r.g) ? r.g : void 0;
  const l = r.l === "de" || r.l === "it" || r.l === "en" ? r.l : void 0;
  return { o, k, g, l };
}
async function record(env, hit) {
  const code = OFFER_ID.exec(hit.o)?.[1] ?? "";
  const dup = await env.DB.prepare(
    "SELECT 1 FROM clicks WHERE offer_id = ?1 AND kind = ?2 AND IFNULL(slot,'') = ?3 AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now', ?4) LIMIT 1"
  ).bind(hit.o, hit.k, hit.g ?? "", `-${DEDUP_SECONDS} seconds`).first();
  if (dup) return false;
  await env.DB.prepare("INSERT INTO clicks (offer_id, code, kind, slot, lang) VALUES (?1, ?2, ?3, ?4, ?5)").bind(hit.o, code, hit.k, hit.g ?? null, hit.l ?? null).run();
  return true;
}
var worker_default = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = cors(origin);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/health") return new Response("ok", { headers });
    if (url.pathname !== "/hit") return new Response("Not found", { status: 404, headers });
    if (origin !== null && !ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers });
    let raw = null;
    try {
      if (request.method === "POST") raw = JSON.parse(await request.text());
      else if (request.method === "GET") raw = Object.fromEntries(url.searchParams);
    } catch {
      raw = null;
    }
    const hit = parseHit(raw);
    if (!hit) return new Response(null, { status: 400, headers });
    try {
      await record(env, hit);
    } catch (err) {
      console.error("D1:", err);
      return new Response(null, { status: 500, headers });
    }
    return new Response(null, { status: 204, headers });
  }
};
export {
  worker_default as default
};
