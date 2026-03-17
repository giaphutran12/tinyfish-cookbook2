import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @/lib/supabase BEFORE importing the route
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => {
    throw new Error("Supabase not configured");
  }),
}));

import { POST } from "@/app/api/search/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeInvalidJsonRequest(): Request {
  return new Request("http://localhost:3000/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not valid json {{{",
  });
}

// ---------------------------------------------------------------------------
// Tests — request validation
// ---------------------------------------------------------------------------

describe("POST /api/search — validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns 400 for invalid JSON body", async () => {
    process.env.TINYFISH_API_KEY = "test-key";

    const res = await POST(makeInvalidJsonRequest());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid JSON/i);
  });

  it("returns 400 for empty body (missing query)", async () => {
    process.env.TINYFISH_API_KEY = "test-key";

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Missing search query/i);
  });

  it('returns 400 for { query: "" }', async () => {
    process.env.TINYFISH_API_KEY = "test-key";

    const res = await POST(makeRequest({ query: "" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Missing search query/i);
  });

  it("returns 400 for whitespace-only query", async () => {
    process.env.TINYFISH_API_KEY = "test-key";

    const res = await POST(makeRequest({ query: "   " }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Missing search query/i);
  });

  it("returns 500 when TINYFISH_API_KEY is missing", async () => {
    delete process.env.TINYFISH_API_KEY;

    const res = await POST(makeRequest({ query: "paracetamol" }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/TINYFISH_API_KEY/i);
  });

  it("returns SSE stream with correct headers for valid request", async () => {
    process.env.TINYFISH_API_KEY = "test-key";

    const mockFetch = vi.fn().mockRejectedValue(new Error("mocked network"));
    vi.stubGlobal("fetch", mockFetch);

    const res = await POST(makeRequest({ query: "paracetamol" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("Connection")).toBe("keep-alive");
    if (res.body) {
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }

    vi.unstubAllGlobals();
  });

  it("SSE stream contains SEARCH_COMPLETE event on valid request", async () => {
    process.env.TINYFISH_API_KEY = "test-key";

    const mockFetch = vi.fn().mockRejectedValue(new Error("mocked network"));
    vi.stubGlobal("fetch", mockFetch);

    const res = await POST(makeRequest({ query: "paracetamol" }));
    expect(res.status).toBe(200);

    const chunks: string[] = [];
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }

    const fullStream = chunks.join("");

    expect(fullStream).toContain("SEARCH_COMPLETE");

    vi.unstubAllGlobals();
  });
});
