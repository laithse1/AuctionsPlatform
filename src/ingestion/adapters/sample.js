const fs = require("node:fs/promises");
const path = require("node:path");

async function fetchListings(provider, context) {
  const feedPath = path.resolve(context.rootDir, provider.path);
  const raw = await fs.readFile(feedPath, "utf8");
  return JSON.parse(raw);
}

module.exports = { fetchListings };
