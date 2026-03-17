export const runtime = "nodejs";
export const maxDuration = 800;

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import { tryGetSupabase } from "@/lib/supabase";
import {
  normalizePharmacyResult,
  isEmptyResult,
} from "@/lib/normalize";
import type { PharmacyResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TINYFISH_SSE_URL = "https://agent.tinyfish.ai/v1/automation/run-sse";
const REQUEST_TIMEOUT_MS = 780_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const PHARMACY_SITES: Record<string, { name: string; url: string }> = {
  longchau: {
    name: "Long Ch\u00e2u",
    url: "https://nhathuoclongchau.com.vn/tim-kiem?key={query}",
  },
  pharmacity: {
    name: "Pharmacity",
    url: "https://www.pharmacity.vn/search?q={query}",
  },
  ankhang: {
    name: "An Khang",
    url: "https://nhathuocankhang.com/tim-kiem?keyword={query}",
  },
  guardian: {
    name: "Guardian",
    url: "https://www.guardian.com.vn/catalogsearch/result/?q={query}",
  },
  medicare: {
    name: "Medicare",
    url: "https://medicare.vn/products?keyword={query}",
  },
};

const GOAL_PROMPT = `You are extracting medicine/health product pricing from this Vietnamese pharmacy website.

Steps:
1. Wait for the page to fully load (some pages use JavaScript rendering)
2. Handle any popups or cookie banners by dismissing them
3. Find ALL product listings on the FIRST PAGE of search results only
4. Do NOT click "Load More" or navigate to other pages
5. For each product (maximum 20), extract:
   - product_name: Full Vietnamese product name
   - brand: Manufacturer or brand name (if visible)
   - dosage_form: One of "vi\u00ean n\u00e9n", "vi\u00ean nang", "siro", "kem", "g\u00f3i", "chai", "tu\u00fdp", or the actual form shown
   - quantity: Package size (e.g., "H\u1ed9p 10 v\u1ec9 x 10 vi\u00ean", "Chai 100ml")
   - original_price: Original price in VND as a number (e.g., 32000 not "32.000\u20ab")
   - sale_price: Discounted price in VND if on sale, null otherwise
   - price_unit: What the price is for ("vi\u00ean", "v\u1ec9", "h\u1ed9p", "tu\u00fdp", "chai")
   - quantity_per_unit: Number per unit (e.g., 10 for "10 vi\u00ean/v\u1ec9"), null if not visible
   - stock_status: "C\u00f2n h\u00e0ng" if available, "H\u1ebft h\u00e0ng" if out of stock, "C\u1ea7n t\u01b0 v\u1ea5n d\u01b0\u1ee3c s\u0129" if prescription required
   - product_url: Full URL to product detail page
   - promo_badge: Any promotion text (e.g., "Gi\u1ea3m 11%", "Flash Sale"), null if none

Return a JSON object:
{
  "pharmacy": "Name of the pharmacy chain",
  "search_term": "The search query used",
  "products": [array of products as described above]
}

If no products are found or the page is blocked, return:
{
  "pharmacy": "Name",
  "search_term": "query",
  "products": [],
  "error": "no_results"
}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SearchBody = { query: string; useCache?: boolean };

type TinyFishEvent = {
  status?: string;
  type?: string;
  resultJson?: unknown;
  streamingUrl?: string;
};

interface CacheRow {
  pharmacy: string;
  result_data: unknown;
  scraped_at: string;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

const sseData = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

const elapsedSeconds = (startedAt: number) =>
  ((Date.now() - startedAt) / 1000).toFixed(1);

// ---------------------------------------------------------------------------
// Supabase cache helpers (all gracefully degrade on failure)
// ---------------------------------------------------------------------------

/** Get fresh cached results for a query (within TTL) */
async function getCachedResults(
  supabase: SupabaseClient,
  query: string,
): Promise<Map<string, CacheRow>> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();

  const { data, error } = await supabase
    .from("pharmacy_cache")
    .select("pharmacy, result_data, scraped_at")
    .eq("query", query)
    .gte("scraped_at", cutoff);

  if (error) {
    console.error("[PHARMACY] [CACHE] Read error:", error.message);
    return new Map();
  }

  const map = new Map<string, CacheRow>();
  for (const row of data ?? []) {
    map.set(row.pharmacy, row as CacheRow);
  }
  return map;
}

/** Upsert a single scrape result to cache (fire-and-forget) */
async function cacheResult(
  supabase: SupabaseClient,
  query: string,
  pharmacy: string,
  resultData: unknown,
): Promise<void> {
  const { error } = await supabase
    .from("pharmacy_cache")
    .upsert(
      {
        query,
        pharmacy,
        result_data: resultData,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: "query,pharmacy", ignoreDuplicates: false },
    );

  if (error) {
    console.error(
      `[PHARMACY] [CACHE] Write error for ${pharmacy}:`,
      error.message,
    );
  }
}

// ---------------------------------------------------------------------------
// TinyFish SSE scraper
// ---------------------------------------------------------------------------

async function runTinyFishSseForSite(
  siteKey: string,
  url: string,
  apiKey: string,
  enqueue: (payload: unknown) => void,
): Promise<boolean> {
  const startedAt = Date.now();
  console.log(`[PHARMACY] Starting scrape: ${siteKey} → ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TINYFISH_SSE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ url, goal: GOAL_PROMPT }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`TinyFish request failed (${response.status})`);
    }

    if (!response.body) {
      throw new Error("TinyFish response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resultJson: unknown;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        let event: TinyFishEvent;
        try {
          event = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (event.streamingUrl) {
          console.log(
            `[PHARMACY] streamingUrl for ${siteKey}:`,
            event.streamingUrl,
          );
          enqueue({
            type: "STREAMING_URL",
            siteUrl: url,
            streamingUrl: event.streamingUrl,
          });
        }

        if (event.status === "COMPLETED") {
          resultJson = event.resultJson;
        }
      }
    }

    if (resultJson) {
      const normalized = normalizePharmacyResult(resultJson);

      if (isEmptyResult(normalized)) {
        console.warn(
          `[PHARMACY] Empty result from ${siteKey} — 0 products found`,
        );
      }

      enqueue({
        type: "PHARMACY_RESULT",
        pharmacy: siteKey,
        result: normalized,
        source: "live",
      });

      console.log(
        `[PHARMACY] Complete: ${siteKey} — ${normalized.products.length} products (${elapsedSeconds(startedAt)}s)`,
      );
      return true;
    }

    throw new Error("TinyFish stream finished without COMPLETED resultJson");
  } catch (error) {
    console.error(`[PHARMACY] Failed: ${siteKey}`, error);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// POST handler — cache-aside + SSE streaming
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  let body: SearchBody;

  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  const useCache = body.useCache ?? false;

  if (!query) {
    return Response.json({ error: "Missing search query" }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = getEnv().TINYFISH_API_KEY;
  } catch {
    return Response.json(
      { error: "Missing TINYFISH_API_KEY" },
      { status: 500 },
    );
  }

  const siteEntries = Object.entries(PHARMACY_SITES).map(([key, site]) => ({
    key,
    name: site.name,
    url: site.url.replace("{query}", encodeURIComponent(query)),
  }));

  console.log(
    `[PHARMACY] Search: "${query}" → ${siteEntries.length} pharmacy sites`,
  );

  // ---- Cache lookup (graceful degradation) ----
  const supabase = tryGetSupabase();
  let cached = new Map<string, CacheRow>();

  if (supabase && useCache) {
    try {
      cached = await getCachedResults(supabase, query);
      console.log(
        `[PHARMACY] [CACHE] ${cached.size}/${siteEntries.length} sites cached for "${query}"`,
      );
    } catch (err) {
      console.error("[PHARMACY] [CACHE] Lookup failed:", err);
    }
  }

  // Partition sites into cached vs uncached
  const cachedSites: { key: string; name: string; url: string; row: CacheRow }[] = [];
  const uncachedSites: { key: string; name: string; url: string }[] = [];

  for (const entry of siteEntries) {
    const row = cached.get(entry.key);
    if (row) {
      cachedSites.push({ ...entry, row });
    } else {
      uncachedSites.push(entry);
    }
  }

  const searchStartedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // Send immediate ping to establish stream and prevent proxy buffering
      controller.enqueue(encoder.encode(": ping\n\n"));

      const enqueue = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseData(payload)));
      };

      // ---- Stream cached results instantly ----
      for (const { key, row } of cachedSites) {
        const normalized = normalizePharmacyResult(row.result_data);
        enqueue({
          type: "PHARMACY_RESULT",
          pharmacy: key,
          result: { ...normalized, source: "cache", cached_at: row.scraped_at },
          source: "cache",
        });
      }

      // ---- Scrape uncached sites via TinyFish (all in parallel) ----
      let liveSucceeded = 0;

      if (uncachedSites.length > 0) {
        const tasks = uncachedSites.map((site) =>
          (async () => {
            const siteEnqueue = (payload: unknown) => {
              const event = payload as Record<string, unknown>;
              if (event.type === "PHARMACY_RESULT") {
                if (supabase && useCache && event.result) {
                  cacheResult(
                    supabase,
                    query,
                    site.key,
                    event.result,
                  ).catch(() => {});
                }
              }
              enqueue(payload);
            };

            return runTinyFishSseForSite(
              site.key,
              site.url,
              apiKey,
              siteEnqueue,
            );
          })(),
        );

        const settled = await Promise.allSettled(tasks);
        liveSucceeded = settled.filter(
          (r): r is PromiseFulfilledResult<boolean> =>
            r.status === "fulfilled" && r.value,
        ).length;
      }

      enqueue({
        type: "SEARCH_COMPLETE",
        total: siteEntries.length,
        succeeded: cachedSites.length + liveSucceeded,
        cached: cachedSites.length,
        elapsed: `${elapsedSeconds(searchStartedAt)}s`,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Transfer-Encoding": "chunked",
    },
  });
}
