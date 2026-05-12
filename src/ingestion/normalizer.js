const crypto = require("node:crypto");

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeVin(value) {
  return cleanString(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function makeId(source, sourceListingId, vin, url) {
  const stable = [source, sourceListingId, vin, url].filter(Boolean).join("|");
  return crypto.createHash("sha1").update(stable).digest("hex").slice(0, 16);
}

function normalizeDate(value) {
  const fallback = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  if (!value) return fallback;

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();

  return fallback;
}

function estimateRisk(record) {
  const text = [
    record.damage,
    record.titleType,
    ...(record.flags || [])
  ].join(" ").toLowerCase();

  if (text.includes("flood") || text.includes("mechanical") || text.includes("frame") || text.includes("no start")) {
    return "high";
  }

  if (text.includes("salvage") || text.includes("front") || text.includes("side") || text.includes("rear") || text.includes("pending")) {
    return "watch";
  }

  return "low";
}

function normalizeListing(input, provider) {
  const source = cleanString(input.source || provider.source || provider.id);
  const vin = normalizeVin(input.vin);
  const sourceListingId = cleanString(input.sourceListingId || input.lotNumber || input.id);
  const title = cleanString(input.title || [input.year, input.make, input.model, input.trim].filter(Boolean).join(" "));
  const auctionEndsAt = normalizeDate(input.auctionEndsAt);
  const flags = Array.isArray(input.flags) ? input.flags.map(cleanString).filter(Boolean) : [];

  const listing = {
    id: makeId(source, sourceListingId, vin, input.url),
    source,
    sourceListingId,
    title,
    year: toNumber(input.year),
    make: cleanString(input.make),
    model: cleanString(input.model),
    trim: cleanString(input.trim),
    vin,
    location: cleanString(input.location),
    damage: cleanString(input.damage || "Unknown"),
    titleType: cleanString(input.titleType || "Unknown"),
    mileage: toNumber(input.mileage),
    currentBid: toNumber(input.currentBid),
    auctionFee: toNumber(input.auctionFee),
    brokerFee: toNumber(input.brokerFee),
    shippingEstimate: toNumber(input.shippingEstimate),
    totalEstimate: 0,
    auctionEndsAt,
    status: cleanString(input.status || "active"),
    risk: cleanString(input.risk),
    flags,
    url: cleanString(input.url),
    image: cleanString(input.image),
    ingestedAt: new Date().toISOString()
  };

  listing.totalEstimate = listing.currentBid + listing.auctionFee + listing.brokerFee + listing.shippingEstimate;
  listing.risk = listing.risk || estimateRisk(listing);

  return listing;
}

function validateListing(listing) {
  const errors = [];

  if (!listing.source) errors.push("source is required");
  if (!listing.title) errors.push("title is required");
  if (!listing.url) errors.push("url is required");
  if (!listing.vin && !listing.sourceListingId) errors.push("vin or sourceListingId is required");
  if (!listing.auctionEndsAt) errors.push("auctionEndsAt is required");

  return errors;
}

module.exports = { normalizeListing, validateListing };
