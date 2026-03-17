# Pharmacy Panic

> Compare medicine prices across Vietnam's pharmacy chains in seconds — powered by [TinyFish](https://tinyfish.ai) parallel browser agents.

**[Live Demo](https://pharmacy-panic.vercel.app)** (coming soon)

---

## What it does

Real-time medicine and health product price comparison across Vietnam's major pharmacy chains. Searches Long Châu, Pharmacity, and An Khang simultaneously using TinyFish SSE API, displaying per-pharmacy results with VND pricing, stock status, and promotional discounts. No more tab-switching between pharmacy websites — get all prices in one dashboard.

---

## Demo

<!-- TODO: Add demo GIF/video after deployment -->

---

## How it works

```
User enters medicine name
       │
       ▼
POST /api/search
       │
       ├── Cache hit? → stream result instantly via SSE
       │
        └── Cache miss? → fire TinyFish SSE requests for all pharmacies in parallel
                              │
                              ├── STREAMING_URL event → forward iframe URL to client
                              │
                              └── COMPLETED event → parse JSON, stream to client, upsert to cache
```

Each pharmacy has a validated search URL. TinyFish handles all the hard parts: cookie banners, dynamic loading, pagination, and extracting structured product data. The API route streams results via Server-Sent Events so the UI updates as each pharmacy finishes — typically within 15–30 seconds for a full search.

---

## TinyFish API snippet

The core of the app is this SSE request to TinyFish:

```typescript
const response = await fetch("https://agent.tinyfish.ai/v1/automation/run-sse", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-API-Key": process.env.TINYFISH_API_KEY,
  },
  body: JSON.stringify({
    url: "https://nhathuoclongchau.com.vn/tim-kiem?s=paracetamol",
    goal: `You are extracting medicine/health product data from a Vietnamese pharmacy search results page.

Steps:
1. Wait for the page content to fully render...
2. Dismiss any cookie consent banners, popup overlays...
3. Extract products from the FIRST PAGE of search results ONLY...
4. For each product card visible on the page, extract: product_name, brand, dosage_form, quantity, original_price, sale_price, price_unit, quantity_per_unit, stock_status, product_url, promo_badge...`,
  }),
});
```

The goal prompt is sent to every pharmacy URL. Output is a structured JSON object with shop name, search term, and a `products[]` array. TinyFish handles currency conversion from VND automatically.

---

## Running locally

### Prerequisites

- Node.js 18 or higher
- A TinyFish API key (get one free at [tinyfish.ai](https://tinyfish.ai))
- Optional: Supabase account for caching (app works fine without it)

### Setup

```bash
git clone https://github.com/tinyfish-io/tinyfish-cookbook
cd tinyfish-cookbook/pharmacy-panic
npm install
```

Create a `.env.local` file:

```env
TINYFISH_API_KEY=your_key_here

# Optional — for result caching (app works fine without it)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Run dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Build for production

```bash
npm run build
npm start
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  React 19 UI                                             │  │
│  │  - Search input                                          │  │
│  │  - Results grid (grouped by pharmacy)                    │  │
│  │  - Live iframe preview grid (max 5 active agents)        │  │
│  │  - Cache toggle                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                    SSE (Server-Sent Events)
                             │
┌────────────────────────────▼─────────────────────────────────────┐
│                    Next.js API Route                             │
│              /api/search (POST, Node.js runtime)                 │
│                                                                  │
│  1. Check Supabase cache (6-hour TTL)                           │
│  2. Stream cached results instantly                             │
│  3. Fire TinyFish SSE requests for uncached pharmacies          │
│  4. Stream STREAMING_URL events (live iframe URLs)              │
│  5. Stream PHARMACY_RESULT events (product data)                │
│  6. Upsert results to cache (fire-and-forget)                   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                    TinyFish SSE API
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   Long Châu          Pharmacity            An Khang
   (Browser Agent)    (Browser Agent)       (Browser Agent)
   Parallel Scrape    Parallel Scrape       Parallel Scrape
```

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | SSE streaming via Node.js runtime, zero-config deployment |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui | Fast, clean, minimal design system overhead |
| Scraping | [TinyFish API](https://tinyfish.ai/) | Parallel browser agents, structured JSON output, handles JS rendering |
| Caching | Supabase (Postgres) | 6-hour TTL, graceful degradation if unavailable |
| Validation | Zod | Type-safe environment and response validation |
| Hosting | Vercel | Zero-config, auto-deploys on push |

---

Built as a take-home demo for [TinyFish](https://tinyfish.ai) — showing what's possible when you give TinyFish a list of niche local websites and let it run in parallel.
