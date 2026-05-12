const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { runIngestion, readJson } = require("./src/ingestion/pipeline");

const rootDir = process.cwd();
const port = Number(process.env.PORT || 4173);
const dataFile = path.resolve(rootDir, process.env.DATA_FILE || "data/listings.json");
const providersFile = path.resolve(rootDir, process.env.PROVIDERS_FILE || "config/providers.json");
const ingestToken = process.env.INGEST_TOKEN || "change-this-before-production";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sendText(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function filterListings(listings, searchParams) {
  const query = String(searchParams.get("q") || "").trim().toLowerCase();
  const source = searchParams.get("source");
  const risk = searchParams.get("risk");
  const maxBid = Number(searchParams.get("maxBid") || "");
  const minDealScore = Number(searchParams.get("minDealScore") || "");
  const minConfidence = Number(searchParams.get("minConfidence") || "");

  return listings.filter((listing) => {
    const searchable = [
      listing.title,
      listing.vin,
      listing.source,
      listing.location,
      listing.damage,
      listing.titleType,
      ...(listing.flags || [])
    ].join(" ").toLowerCase();

    return (
      (!query || searchable.includes(query)) &&
      (!source || source === "all" || listing.source === source) &&
      (!risk || risk === "all" || listing.risk === risk) &&
      (!maxBid || listing.currentBid <= maxBid) &&
      (!minDealScore || listing.dealScore >= minDealScore) &&
      (!minConfidence || listing.confidenceScore >= minConfidence)
    );
  });
}

async function serveStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.resolve(rootDir, `.${safePath}`);

  if (!filePath.startsWith(rootDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300"
    });
    response.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    sendText(response, 500, "Server error");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      const data = await readJson(dataFile, { generatedAt: null, count: 0, providers: [], listings: [] });
      sendJson(response, 200, {
        ok: true,
        generatedAt: data.generatedAt,
        count: data.count || data.listings.length
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/sources") {
      const data = await readJson(dataFile, { listings: [] });
      const sources = [...new Set(data.listings.map((listing) => listing.source))].sort();
      sendJson(response, 200, { sources });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/provider-health") {
      const data = await readJson(dataFile, { generatedAt: null, providers: [], rejected: [], listings: [] });
      const bySource = data.listings.reduce((map, listing) => {
        map[listing.source] = (map[listing.source] || 0) + 1;
        return map;
      }, {});

      sendJson(response, 200, {
        generatedAt: data.generatedAt,
        rejectedCount: (data.rejected || []).length,
        providers: (data.providers || []).map((provider) => ({
          ...provider,
          normalizedCount: bySource[provider.source] || bySource[sourceNameForProvider(provider.id)] || 0
        }))
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/listings") {
      const data = await readJson(dataFile, { generatedAt: null, providers: [], rejected: [], listings: [] });
      const listings = filterListings(data.listings, url.searchParams);
      sendJson(response, 200, {
        generatedAt: data.generatedAt,
        count: listings.length,
        totalCount: data.listings.length,
        providers: data.providers || [],
        rejectedCount: (data.rejected || []).length,
        listings
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ingest") {
      const auth = request.headers.authorization || "";
      if (auth !== `Bearer ${ingestToken}`) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }

      const result = await runIngestion({ rootDir, providersFile, outputFile: dataFile });
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendText(response, 405, "Method not allowed");
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

function sourceNameForProvider(providerId) {
  const names = {
    "copart-public": "Copart",
    "iaai-public": "IAAI",
    "cars4bid-public": "Cars4Bid",
    "sca-public": "SCA",
    "abetterbid-public": "A Better Bid",
    "autobidmaster-public": "AutoBidMaster",
    "capitalautoauction-public": "Capital Auto Auction"
  };
  return names[providerId] || providerId;
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
    console.error(`Open http://localhost:${port} if AuctionHub is already running, or start another instance with a different port:`);
    console.error(`PowerShell: $env:PORT=4174; npm start`);
    process.exit(1);
  }

  throw error;
});

server.listen(port, async () => {
  try {
    await fs.access(dataFile);
  } catch {
    await runIngestion({ rootDir, providersFile, outputFile: dataFile });
  }

  console.log(`AuctionHub running at http://localhost:${port}`);
});
