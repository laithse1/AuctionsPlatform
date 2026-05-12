const { crawlDelayMs, isAllowed } = require("../robots");
const { parseProviderListings } = require("../sourceParsers");

const DEFAULT_USER_AGENT = "AuctionHubBot/0.1 (+https://example.com/contact; compliant public listing crawler)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, provider) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": provider.userAgent || DEFAULT_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      ...(provider.headers || {})
    },
    signal: AbortSignal.timeout(provider.timeoutMs || 20000)
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status} for ${url}`);
  }

  return response.text();
}

async function fetchRobots(origin, provider) {
  try {
    return await fetchText(`${origin}/robots.txt`, provider);
  } catch {
    return "";
  }
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const objects = [];

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      objects.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Ignore malformed structured-data blocks; providers often include unrelated scripts.
    }
  }

  return objects;
}

function flattenStructuredItems(node) {
  if (!node || typeof node !== "object") return [];

  if (Array.isArray(node)) {
    return node.flatMap(flattenStructuredItems);
  }

  const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : node["@type"];
  const itemList = Array.isArray(node.itemListElement) ? node.itemListElement : [];
  const graph = Array.isArray(node["@graph"]) ? node["@graph"] : [];
  const candidates = [];

  if (/vehicle|car|product|offer/i.test(String(type || ""))) {
    candidates.push(node);
  }

  for (const item of itemList) {
    candidates.push(...flattenStructuredItems(item.item || item));
  }

  for (const item of graph) {
    candidates.push(...flattenStructuredItems(item));
  }

  return candidates;
}

function numberFrom(value) {
  if (value === null || value === undefined) return 0;
  const match = String(value).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function mapStructuredItem(item, provider, pageUrl) {
  const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers || {};
  const image = Array.isArray(item.image) ? item.image[0] : item.image;
  const url = item.url ? new URL(item.url, pageUrl).toString() : pageUrl;
  const name = cleanText(item.name || item.title);
  const vehicleModelDate = numberFrom(item.vehicleModelDate || item.modelDate);

  if (!name && !item.vin && !item.vehicleIdentificationNumber) return null;

  return {
    source: provider.source || provider.id,
    sourceListingId: cleanText(item.sku || item.productID || item.identifier || url),
    title: name,
    year: vehicleModelDate,
    make: cleanText(item.manufacturer?.name || item.brand?.name || item.brand || item.make),
    model: cleanText(item.model || item.vehicleModel),
    vin: cleanText(item.vehicleIdentificationNumber || item.vin),
    location: cleanText(item.availableAtOrFrom?.name || item.areaServed || provider.defaultLocation),
    damage: cleanText(item.itemCondition || item.damage || "Unknown"),
    titleType: cleanText(item.titleType || "Unknown"),
    mileage: numberFrom(item.mileageFromOdometer?.value || item.mileage),
    currentBid: numberFrom(offers.price || item.price),
    auctionFee: numberFrom(provider.defaultAuctionFee),
    brokerFee: numberFrom(provider.defaultBrokerFee),
    shippingEstimate: numberFrom(provider.defaultShippingEstimate),
    auctionEndsAt: item.availabilityEnds || item.validThrough || provider.defaultAuctionEndsAt,
    status: "active",
    flags: provider.defaultFlags || ["Public page import"],
    url,
    image: cleanText(image)
  };
}

function extractListingsFromHtml(html, provider, pageUrl) {
  const structuredItems = extractJsonLd(html).flatMap(flattenStructuredItems);
  const structuredListings = structuredItems
    .map((item) => mapStructuredItem(item, provider, pageUrl))
    .filter(Boolean);

  return [...structuredListings, ...extractListingsFromText(stripTags(html), provider, pageUrl)];
}

function inferMakeModel(title) {
  const parts = cleanText(title).split(" ").filter(Boolean);
  const yearIndex = parts.findIndex((part) => /^(19|20)\d{2}$/.test(part));
  const start = yearIndex === -1 ? 0 : yearIndex + 1;
  return {
    year: yearIndex === -1 ? 0 : Number(parts[yearIndex]),
    make: parts[start] || "",
    model: parts.slice(start + 1, start + 4).join(" ")
  };
}

function normalizeLocation(location) {
  return cleanText(location).replace(/\s+-\s+/g, " - ");
}

function buildTextListing(match, provider, pageUrl) {
  const title = cleanText(match.groups.title);
  const inferred = inferMakeModel(title);
  const location = normalizeLocation(match.groups.location);
  const bid = numberFrom(match.groups.bid);
  const sourceId = `${provider.id}-${title}-${location}-${bid}`;

  return {
    source: provider.source || provider.id,
    sourceListingId: sourceId,
    title,
    year: inferred.year,
    make: inferred.make,
    model: inferred.model,
    vin: cleanText(match.groups.vin || ""),
    location,
    damage: cleanText(match.groups.damage || "Unknown"),
    titleType: cleanText(match.groups.titleType || "Unknown"),
    mileage: numberFrom(match.groups.mileage),
    currentBid: bid,
    auctionFee: numberFrom(provider.defaultAuctionFee),
    brokerFee: numberFrom(provider.defaultBrokerFee),
    shippingEstimate: numberFrom(provider.defaultShippingEstimate),
    auctionEndsAt: parseSaleDate(match.groups.saleDate) || provider.defaultAuctionEndsAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    flags: provider.defaultFlags || ["Homepage scrape"],
    url: pageUrl,
    image: provider.defaultImage || ""
  };
}

function parseSaleDate(value) {
  const text = cleanText(value);
  if (!text) return null;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  const slash = text.match(/(?<month>\d{1,2})\/(?<day>\d{1,2})\/(?<year>\d{4})/);
  if (slash?.groups) {
    const date = new Date(`${slash.groups.year}-${slash.groups.month.padStart(2, "0")}-${slash.groups.day.padStart(2, "0")}T18:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}

function extractListingsFromText(text, provider, pageUrl) {
  const patterns = [
    /(?<time>(?:\d+\s*d\s*:\s*)?\d+h\s*:\s*\d+m\s*:\s*\d+s)\s+(?<title>(?:19|20)\d{2}\s+[A-Z0-9][A-Z0-9 .&/-]{3,80}?)\s+(?<location>[A-Z]{2}\s+-\s+[A-Z][A-Z .'-]{2,40})\s+Current Bid:?\s*\$?(?<bid>[\d,]+(?:\.\d{2})?)/gi,
    /(?<time>\d+\s+day|(?:\d{1,2}:){2}\d{2})\s+(?<title>(?:19|20)\d{2}\s+[A-Z0-9][A-Z0-9 .&/-]{3,80}?)\s+(?<location>[A-Z]{2}\s+-\s+[A-Z][A-Z .'-]{2,40})\s+Current Bid\s+\$?(?<bid>[\d,]+(?:\.\d{2})?)/gi,
    /(?<title>(?:19|20)\d{2}\s+[A-Z][A-Z0-9 .&/-]{3,80}?)\s+Time left[\s\S]{0,220}?Current bid\s+\$?(?<bid>[\d,]+(?:\.\d{2})?)/gi,
    /(?<title>(?:19|20)\d{2}\s+[A-Z][A-Z0-9 .&/-]{3,80}?)\s+Odometer:\s*(?<mileage>[\d,]+)[\s\S]{0,80}?Title\s*Code:\s*(?<titleType>.*?)\s+Damage:\s*(?<damage>.*?)\s+Location:\s*(?<location>[A-Z]{2}\s+-\s+[A-Z][A-Z .'-]{2,50})\s+Sale Date:\s*(?<saleDate>.*?)\s+Sale Status:[\s\S]{0,520}?Current Bid:?\s*\$?(?<bid>[\d,]+(?:\.\d{2})?)/gi,
    /(?<title>(?:19|20)\d{2}\s+[A-Z][A-Z0-9 .&/-]{3,80}?)\s+Odometer:\s*(?<mileage>[\d,]+)[\s\S]{0,80}?Title\s*code:\s*(?<titleType>.*?)\s+Damage:\s*(?<damage>.*?)\s+Location:\s*(?<location>[A-Z]{2}\s+-\s+[A-Z][A-Z .'-]{2,50})\s+Sale Date:\s*(?<saleDate>.*?)\s+Sale Status:[\s\S]{0,520}?Current bid:\s*\$?(?<bid>[\d,]+(?:\.\d{2})?)/gi,
    /(?<title>(?:19|20)\d{2}\s+[A-Z][A-Z0-9 .&/-]{3,100}?)\s+You must be registered[\s\S]{0,240}?Primary Damage\s+(?<damage>[A-Za-z &/-]+)\s+Secondary Damage[\s\S]{0,80}?Odometer\s+(?<mileage>[\d,]+)[\s\S]{0,80}?Doc Type\s+(?<titleType>[A-Za-z ]+)[\s\S]{0,220}?VIN\s+(?<vin>[A-Z0-9*]{8,20})/gi
  ];

  const listings = [];
  const seen = new Set();

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const groups = match.groups || {};
      if (!groups.title || !groups.bid) continue;

      const listing = buildTextListing(
        {
          groups: {
            title: groups.title,
            location: groups.location || provider.defaultLocation || "Unknown",
            bid: groups.bid || "0",
            damage: groups.damage,
            titleType: groups.titleType,
            mileage: groups.mileage,
            saleDate: groups.saleDate,
            vin: groups.vin
          }
        },
        provider,
        pageUrl
      );

      const key = `${listing.title}|${listing.location}|${listing.currentBid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      listings.push(listing);
    }
  }

  return listings.slice(0, provider.maxListingsPerPage || 25);
}

async function fetchListings(provider) {
  if (!Array.isArray(provider.urls) || !provider.urls.length) {
    throw new Error(`Provider ${provider.id} needs urls`);
  }

  const userAgent = provider.userAgent || DEFAULT_USER_AGENT;
  const records = [];
  const robotsByOrigin = new Map();
  let lastFetchAt = 0;

  for (const url of provider.urls.slice(0, provider.maxPages || 10)) {
    const parsed = new URL(url);

    if (!robotsByOrigin.has(parsed.origin)) {
      robotsByOrigin.set(parsed.origin, await fetchRobots(parsed.origin, provider));
    }

    const robots = robotsByOrigin.get(parsed.origin);
    if (provider.respectRobots !== false && robots && !isAllowed(robots, url, userAgent)) {
      throw new Error(`robots.txt disallows ${url} for ${userAgent}`);
    }

    const delay = robots ? crawlDelayMs(robots, userAgent, provider.requestDelayMs || 5000) : provider.requestDelayMs || 5000;
    const waitFor = Math.max(0, lastFetchAt + delay - Date.now());
    if (waitFor) await sleep(waitFor);

    const html = await fetchText(url, provider);
    lastFetchAt = Date.now();
    records.push(...parseProviderListings(provider, html, url));
  }

  return records;
}

module.exports = { fetchListings, extractListingsFromHtml };
