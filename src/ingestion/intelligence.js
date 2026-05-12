function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function computeRisk(listing) {
  const text = [
    listing.damage,
    listing.titleType,
    ...(listing.flags || [])
  ].join(" ").toLowerCase();
  const reasons = [];
  let score = 20;

  if (includesAny(text, ["flood", "water"])) {
    score += 35;
    reasons.push("Flood or water damage");
  }

  if (includesAny(text, ["frame", "rollover", "structural"])) {
    score += 30;
    reasons.push("Structural/frame risk");
  }

  if (includesAny(text, ["mechanical", "engine", "transmission", "no start"])) {
    score += 25;
    reasons.push("Mechanical uncertainty");
  }

  if (includesAny(text, ["salvage", "rebuilt", "certificate"])) {
    score += 15;
    reasons.push("Branded title");
  }

  if (!listing.vin) {
    score += 10;
    reasons.push("VIN not visible");
  }

  if (!listing.mileage) {
    score += 8;
    reasons.push("Mileage missing");
  }

  return {
    riskScore: Math.min(score, 100),
    riskReasons: reasons.length ? reasons : ["No major risk signals found"]
  };
}

function computeConfidence(listing) {
  const fields = ["title", "year", "make", "model", "location", "damage", "titleType", "mileage", "currentBid", "auctionEndsAt", "url"];
  const present = fields.filter((field) => Boolean(listing[field])).length;
  const vinBonus = listing.vin ? 12 : 0;
  return Math.min(100, Math.round((present / fields.length) * 88 + vinBonus));
}

function computeDealScore(listing, riskScore, confidenceScore) {
  let score = 55;

  if (listing.currentBid > 0 && listing.year >= 2020) score += 12;
  if (listing.currentBid > 0 && listing.currentBid < 5000) score += 10;
  if (listing.mileage && listing.mileage < 60000) score += 10;
  if (/clean|clear/i.test(listing.titleType)) score += 12;
  if (listing.isDuplicate) score += 6;

  score -= Math.round(riskScore * 0.35);
  score += Math.round((confidenceScore - 50) * 0.2);

  return Math.max(0, Math.min(100, score));
}

function buyerNotes(listing, riskReasons, dealScore) {
  const notes = [];

  if (dealScore >= 75) notes.push("Strong candidate for watchlist review");
  if (listing.isDuplicate) notes.push("Compare duplicate listings before bidding");
  if (!listing.auctionFee || !listing.brokerFee) notes.push("Fee estimate incomplete");
  if (!listing.vin) notes.push("Open source listing to verify VIN");
  if (riskReasons.length && riskReasons[0] !== "No major risk signals found") notes.push("Review damage photos carefully");

  return notes.length ? notes : ["Good basic listing data available"];
}

function normalizedKey(listing) {
  return [
    listing.vin || "",
    listing.year || "",
    listing.make || "",
    listing.model || "",
    listing.location || ""
  ].join("|").toLowerCase();
}

function enrichListingIntelligence(listing) {
  const risk = computeRisk(listing);
  const confidenceScore = computeConfidence(listing);
  const dealScore = computeDealScore(listing, risk.riskScore, confidenceScore);

  return {
    ...listing,
    normalizedKey: normalizedKey(listing),
    confidenceScore,
    dealScore,
    riskScore: risk.riskScore,
    riskReasons: risk.riskReasons,
    buyerNotes: buyerNotes(listing, risk.riskReasons, dealScore),
    feeEstimateComplete: Boolean(listing.auctionFee && listing.brokerFee && listing.shippingEstimate)
  };
}

module.exports = { enrichListingIntelligence };
