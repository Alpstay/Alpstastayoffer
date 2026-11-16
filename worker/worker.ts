/**
 * ALPSTAY — Conteggio aperture delle offerte (Cloudflare Worker «offerclick»)
 *
 * La pagina personale (alpstay.github.io/Alpstastayoffer) avvisa questo servizio quando l'ospite
 * la apre dal link dell'email, quando sceglie una casa e quando invia la richiesta di prenotazione.
 * Si salvano SOLO: id dell'offerta (r<codice>-<arrivo>), codice richiesta, tipo di evento,
 * pulsante usato, lingua e ora. Nessun IP, nessun nome, nessuna email.
 * L'Offerta Studio legge i conteggi dal database D1 tramite il connettore Cloudflare.
 *
 * Binding richiesto: D1 database «alpstay-offerte-click» con nome variabile DB.
 */

interface Env {
  DB: D1Database;
}

type Kind = "open" | "choose" | "book";

interface Hit {
  o: string;      // id offerta, es. "r316386-2027-05-29"
  k: Kind;        // tipo di evento
  g?: string;     // pulsante / sezione (es. "p-hartmann", "a", "alt-0")
  l?: "de" | "it" | "en";
}

const ALLOWED_ORIGINS: readonly string[] = ["https://alpstay.github.io"];
const OFFER_ID = /^r(\d{3,9})-\d{4}-\d{2}-\d{2}$/;
const SLOT = /^[a-z0-9-]{1,30}$/;
const KINDS: readonly Kind[] = ["open", "choose", "book"];
const DEDUP_SECONDS = 60; // lo stesso evento ripetuto entro 60 s conta una volta

function cors(origin: string | null): Record<string, string> {
  const ok = origin !== null && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function parseHit(raw: unknown): Hit | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const o = typeof r.o === "string" ? r.o : "";
  const k = typeof r.k === "string" ? r.k : "";
  if (!OFFER_ID.test(o) || !KINDS.includes(k as Kind)) return null;
  const g = typeof r.g === "string" && SLOT.test(r.g) ? r.g : undefined;
  const l = r.l === "de" || r.l === "it" || r.l === "en" ? r.l : undefined;
  return { o, k: k as Kind, g, l };
}

async function record(env: Env, hit: Hit): Promise<boolean> {
  const code = OFFER_ID.exec(hit.o)?.[1] ?? "";
  const dup = await env.DB.prepare(
    "SELECT 1 FROM clicks WHERE offer_id = ?1 AND kind = ?2 AND IFNULL(slot,'') = ?3 AND ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now', ?4) LIMIT 1",
  ).bind(hit.o, hit.k, hit.g ?? "", `-${DEDUP_SECONDS} seconds`).first();
  if (dup) return false;
  await env.DB.prepare("INSERT INTO clicks (offer_id, code, kind, slot, lang) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(hit.o, code, hit.k, hit.g ?? null, hit.l ?? null).run();
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const headers = cors(origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/health") return new Response("ok", { headers });
    if (url.pathname !== "/hit") return new Response("Not found", { status: 404, headers });
    // Le chiamate dal browser arrivano solo dalla pagina personale
    if (origin !== null && !ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers });

    let raw: unknown = null;
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
  },
} satisfies ExportedHandler<Env>;
