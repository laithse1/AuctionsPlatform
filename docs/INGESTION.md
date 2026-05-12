# Ingestion Strategy

AuctionHub supports three provider types:

- `sample`: local JSON for development.
- `json-feed`: a partner, affiliate, vendor, or exported JSON feed.
- `website-crawler`: compliant public-page crawling with robots.txt checks and rate limits.
- `rendered-crawler`: Playwright-backed crawling for JavaScript-rendered public pages, with static fallback.

## Direct Website Pulls

Direct pulling is technically possible when the listing pages are public and the site permits automated access or gives written permission. The crawler adapter intentionally does not bypass logins, CAPTCHAs, bot defenses, paywalls, or access restrictions.

Before enabling a provider:

1. Review the site's current Terms of Use and robots.txt.
2. Confirm commercial reuse of listing text, images, prices, and vehicle data is permitted.
3. Use a clear user agent with contact information.
4. Keep request rates low.
5. Cache results and avoid re-fetching unchanged pages.
6. Link users to the original listing for bidding.
7. Store only the fields needed for browsing, comparison, dedupe, and alerts.

## Provider Configuration

Example:

```json
{
  "id": "example-public",
  "type": "website-crawler",
  "enabled": true,
  "source": "Example Auction",
  "urls": ["https://example.com/search?category=cars"],
  "respectRobots": true,
  "requestDelayMs": 10000,
  "maxPages": 5,
  "defaultAuctionFee": 0,
  "defaultBrokerFee": 0,
  "defaultShippingEstimate": 0
}
```

The current generic crawler extracts JSON-LD structured data from public pages. Many auction sites are JavaScript-heavy, so source-specific adapters may be needed after permission is confirmed.

## Rendered Crawling

Install browser support locally:

```powershell
npm install
npx playwright install chromium
```

`rendered-crawler` opens each configured public URL in Chromium, waits for page scripts to render, scrolls to load lazy content when configured, then passes the HTML to source-specific parsers.

Provider knobs:

- `waitForSelector`: wait for a listing container if known.
- `extraWaitMs`: pause after load for client-rendered data.
- `scrollToLoad`: scroll down to trigger lazy lists.
- `fallbackToStatic`: use the static crawler if Playwright is unavailable.

## Known Compliance Notes

As of May 11, 2026, public terms reviewed for some target sites are restrictive:

- Copart terms describe content as personal, non-commercial unless written consent is granted.
- IAA terms prohibit robots, spiders, data mining, extraction tools, and screen scraping.
- AutoBidMaster terms prohibit scraping and automated systems.

For those sources, the production path should be written permission, affiliate/feed access, or a broker/data partnership before displaying copied listing data commercially.
