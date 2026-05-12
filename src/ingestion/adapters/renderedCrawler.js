const { parseProviderListings } = require("../sourceParsers");
const { fetchListings: fetchStaticListings } = require("./websiteCrawler");

const DEFAULT_USER_AGENT = "AuctionHubBot/0.1 (+https://example.com/contact; rendered public listing crawler)";

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error("Playwright is not installed. Run npm install, then npx playwright install chromium.");
    }
    throw error;
  }
}

async function fetchRenderedPage(page, url, provider) {
  await page.goto(url, {
    waitUntil: provider.waitUntil || "domcontentloaded",
    timeout: provider.timeoutMs || 45000
  });

  if (provider.waitForSelector) {
    await page.waitForSelector(provider.waitForSelector, { timeout: provider.selectorTimeoutMs || 15000 }).catch(() => null);
  }

  if (provider.extraWaitMs) {
    await page.waitForTimeout(provider.extraWaitMs);
  }

  if (provider.scrollToLoad) {
    for (let index = 0; index < (provider.scrollSteps || 3); index += 1) {
      await page.mouse.wheel(0, provider.scrollPixels || 1400);
      await page.waitForTimeout(provider.scrollWaitMs || 900);
    }
  }

  return page.content();
}

async function fetchListings(provider) {
  if (!Array.isArray(provider.urls) || !provider.urls.length) {
    throw new Error(`Provider ${provider.id} needs urls`);
  }

  if (provider.staticFallbackOnly) {
    return fetchStaticListings(provider);
  }

  let playwright;
  try {
    playwright = await loadPlaywright();
  } catch (error) {
    if (provider.fallbackToStatic !== false) {
      return fetchStaticListings(provider);
    }
    throw error;
  }

  const browser = await playwright.chromium.launch({
    headless: provider.headless !== false,
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });

  const records = [];

  try {
    const context = await browser.newContext({
      userAgent: provider.userAgent || DEFAULT_USER_AGENT,
      viewport: provider.viewport || { width: 1440, height: 1200 },
      locale: provider.locale || "en-US"
    });

    const page = await context.newPage();

    for (const url of provider.urls.slice(0, provider.maxPages || 5)) {
      const html = await fetchRenderedPage(page, url, provider);
      records.push(...parseProviderListings(provider, html, url));
    }
  } finally {
    await browser.close();
  }

  return records;
}

module.exports = { fetchListings };
