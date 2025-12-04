// api/inventory.js
// Deploy on Vercel (No framework). Requires "cheerio" in package.json
import cheerio from "cheerio";

/**
 * Simple in-memory cache to avoid hitting Kirka too often.
 * Note: serverless instances may be cold-started and cache won't persist across all invocations,
 * but it helps while the instance is warm.
 */
const CACHE = {};
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function absoluteUrl(src) {
  if (!src) return "";
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  // make relative Kirka URLs absolute
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("/")) return "https://kirka.io" + src;
  return "https://kirka.io/" + src;
}

export default async function handler(req, res) {
  try {
    // allow GET only (but Vercel may call with OPTIONS from some clients)
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).end();
    }
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET,OPTIONS");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const id = (req.query.user || req.query.id || "KGJN53").toString().trim();

    // return cached response if fresh
    const now = Date.now();
    if (CACHE[id] && now - CACHE[id].ts < CACHE_TTL_MS) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json(CACHE[id].value);
    }

    const profileUrl = `https://kirka.io/profile/${encodeURIComponent(id)}`;
    // fetch profile page
    const resp = await fetch(profileUrl);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      const err = { ok: false, error: "Failed to fetch profile", status: resp.status, body: body.slice(0, 200) };
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(502).json(err);
    }
    const html = await resp.text();

    const items = [];

    // Strategy A: try to find JSON array in <script> tags like "inventory = [...]" or "inventory: [...]"
    // This attempts to extract an array-ish JSON blob. It's lenient and will try to JSON.parse safely.
    const scriptMatches = [...html.matchAll(/<script[^>]*>((?:[\s\S]*?))<\/script>/gi)];
    for (const m of scriptMatches) {
      const txt = m[1];
      // search for patterns that look like "inventory = [ ... ]" or "inventory: [ ... ]"
      const jsonArrayMatch = txt.match(/(?:inventory|INVENTORY|items)\s*(?:=|:)\s*(\[\s*[\s\S]*?\])/i);
      if (jsonArrayMatch && jsonArrayMatch[1]) {
        try {
          const parsed = JSON.parse(jsonArrayMatch[1]);
          if (Array.isArray(parsed)) {
            parsed.forEach((it) => {
              // normalize common fields
              const name = it.name || it.title || it.displayName || it.itemName || "";
              const img = absoluteUrl(it.img || it.image || it.icon || it.icon_url || "");
              const rarity = it.rarity || it.rarityName || it.tier || "";
              items.push({ name, img, rarity, raw: it });
            });
            break;
          }
        } catch (e) {
          // ignore parse errors and continue to other strategies
        }
      }
    }

    // Strategy B: cheerio scrape if we don't have items yet
    if (items.length === 0) {
      const $ = cheerio.load(html);

      // common selectors used by many item grids; adjust if Kirka changes markup
      const selectors = [
        ".inventory .item",
        ".inventory-item",
        ".inv-item",
        ".item",
        ".item-card",
        ".card.item"
      ];

      for (const sel of selectors) {
        const els = $(sel);
        if (els.length > 0) {
          els.each((i, el) => {
            const el$ = $(el);
            const name = el$.find(".name, .item-name, .title, .item-title").first().text().trim() || el$.attr("data-name") || "";
            let img = el$.find("img").first().attr("src") || el$.attr("data-img") || el$.attr("data-image") || "";
            img = absoluteUrl(img);
            const rarity = el$.find(".rarity, .item-rarity, .tier").first().text().trim() || el$.attr("data-rarity") || "";
            if (name || img) items.push({ name, img, rarity });
          });
          if (items.length > 0) break;
        }
      }
    }

    // Strategy C: fallback, try to find <img> with alt text inside the page if nothing found
    if (items.length === 0) {
      const $ = cheerio.load(html);
      $("img").each((i, im) => {
        const src = $(im).attr("src") || "";
        const alt = $(im).attr("alt") || "";
        // Heuristic: kirka item images often have "item" or "skin" in path or alt
        if (alt || src.toLowerCase().includes("item") || src.toLowerCase().includes("skin")) {
          items.push({ name: alt || "item", img: absoluteUrl(src), rarity: "" });
        }
      });
    }

    // prepare final payload
    const payload = { ok: true, id, profileUrl, items };

    // cache it
    CACHE[id] = { ts: Date.now(), value: payload };

    // allow TrebEdit (or any site) to fetch this
    res.setHeader("Access-Control-Allow-Origin", "*");
    // small caching headers for browsers / CDN (optional)
    res.setHeader("Cache-Control", "public, max-age=20, s-maxage=20, stale-while-revalidate=60");
    return res.status(200).json(payload);
  } catch (err) {
    console.error("inventory error:", err);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(500).json({ ok: false, error: "internal", message: err.message });
  }
}
