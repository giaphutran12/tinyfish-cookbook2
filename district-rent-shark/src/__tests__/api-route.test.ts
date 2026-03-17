import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => {
    throw new Error("Supabase not configured");
  },
}));

async function importRoute() {
  vi.resetModules();
  return import("@/app/api/search/route");
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/search — validation", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await importRoute();
    const req = new Request("http://localhost:3000/api/search", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid JSON/i);
  });

  it('returns 400 for unsupported city (city: "invalid")', async () => {
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ city: "invalid" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Unsupported city/i);
  });

  it("returns 500 when TINYFISH_API_KEY is missing", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    delete process.env.TINYFISH_API_KEY;
    const { POST } = await importRoute();
    const res = await POST(makeRequest({ city: "hcmc" }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/TINYFISH_API_KEY/i);
  });

  it("returns SSE stream with correct content-type when valid", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "test-key-123");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response("data: {}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const { POST } = await importRoute();
    const res = await POST(makeRequest({ city: "hcmc" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    vi.unstubAllGlobals();
  });
});
