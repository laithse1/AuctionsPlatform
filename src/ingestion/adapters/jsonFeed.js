const fs = require("node:fs/promises");
const path = require("node:path");

async function fetchListings(provider, context) {
  if (provider.url) {
    const response = await fetch(provider.url, {
      headers: provider.headers || {},
      signal: AbortSignal.timeout(provider.timeoutMs || 15000)
    });

    if (!response.ok) {
      throw new Error(`Feed request failed with ${response.status} for ${provider.id}`);
    }

    return response.json();
  }

  if (provider.path) {
    const feedPath = path.resolve(context.rootDir, provider.path);
    const raw = await fs.readFile(feedPath, "utf8");
    return JSON.parse(raw);
  }

  throw new Error(`Provider ${provider.id} needs either url or path`);
}

module.exports = { fetchListings };
