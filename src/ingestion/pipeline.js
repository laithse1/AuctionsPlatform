const fs = require("node:fs/promises");
const path = require("node:path");
const { enrichListingIntelligence } = require("./intelligence");
const { normalizeListing, validateListing } = require("./normalizer");

const adapters = {
  sample: require("./adapters/sample"),
  "json-feed": require("./adapters/jsonFeed"),
  "website-crawler": require("./adapters/websiteCrawler"),
  "rendered-crawler": require("./adapters/renderedCrawler")
};

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tempPath, filePath);
}

function markDuplicates(listings) {
  const vinCounts = listings.reduce((map, listing) => {
    if (listing.vin) map.set(listing.vin, (map.get(listing.vin) || 0) + 1);
    return map;
  }, new Map());

  return listings.map((listing) => ({
    ...listing,
    duplicateKey: listing.vin || "",
    isDuplicate: Boolean(listing.vin && vinCounts.get(listing.vin) > 1)
  }));
}

function newestFirst(a, b) {
  return new Date(a.auctionEndsAt).getTime() - new Date(b.auctionEndsAt).getTime();
}

async function runIngestion(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const providersFile = path.resolve(rootDir, options.providersFile || process.env.PROVIDERS_FILE || "config/providers.json");
  const outputFile = path.resolve(rootDir, options.outputFile || process.env.DATA_FILE || "data/listings.json");
  const providers = await readJson(providersFile, []);
  const enabledProviders = providers.filter((provider) => provider.enabled !== false);
  const rejected = [];
  const providerRuns = [];
  const normalized = [];

  for (const provider of enabledProviders) {
    const adapter = adapters[provider.type];

    if (!adapter) {
      providerRuns.push({ id: provider.id, status: "failed", error: `Unknown provider type: ${provider.type}` });
      continue;
    }

    try {
      const records = await adapter.fetchListings(provider, { rootDir });
      const list = Array.isArray(records) ? records : records.listings || [];

      for (const record of list) {
        const listing = normalizeListing(record, provider);
        const errors = validateListing(listing);

        if (errors.length) {
          rejected.push({ provider: provider.id, sourceListingId: listing.sourceListingId, errors });
        } else {
          normalized.push(listing);
        }
      }

      providerRuns.push({ id: provider.id, status: "ok", received: list.length });
    } catch (error) {
      providerRuns.push({ id: provider.id, status: "failed", error: error.message });
    }
  }

  const byId = new Map();
  for (const listing of normalized) {
    byId.set(listing.id, listing);
  }

  const listings = markDuplicates([...byId.values()]).map(enrichListingIntelligence).sort(newestFirst);
  const payload = {
    generatedAt: new Date().toISOString(),
    count: listings.length,
    providers: providerRuns,
    rejected,
    listings
  };

  await writeJsonAtomic(outputFile, payload);
  return payload;
}

module.exports = { runIngestion, readJson };
