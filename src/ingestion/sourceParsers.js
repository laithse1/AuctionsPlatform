function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberFrom(value) {
  if (value === null || value === undefined) return 0;
  const match = String(value).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function absoluteUrl(value, pageUrl) {
  try {
    return value ? new URL(value, pageUrl).toString() : pageUrl;
  } catch {
    return pageUrl;
  }
}

function inferTitleParts(title) {
  const parts = cleanText(title).split(" ").filter(Boolean);
  const yearIndex = parts.findIndex((part) => /^(19|20)\d{2}$/.test(part));
  const start = yearIndex === -1 ? 0 : yearIndex + 1;
  return {
    year: yearIndex === -1 ? 0 : Number(parts[yearIndex]),
    make: parts[start] || "",
    model: parts.slice(start + 1, start + 4).join(" ")
  };
}

function fromCard(card, provider, pageUrl) {
  const title =
    cleanText(card.title) ||
    cleanText(card.name) ||
    cleanText(card.vehicleName) ||
    cleanText(card.heading);

  if (!title || !/(19|20)\d{2}/.test(title)) return null;

  const inferred = inferTitleParts(title);
  const bid = numberFrom(card.currentBid || card.bid || card.price || card.current_bid);
  const location = cleanText(card.location || card.yard || card.branch || provider.defaultLocation || "Unknown");

  return {
    source: provider.source || provider.id,
    sourceListingId: cleanText(card.lotNumber || card.lot || card.id || card.url || `${provider.id}-${title}-${location}-${bid}`),
    title,
    year: numberFrom(card.year) || inferred.year,
    make: cleanText(card.make) || inferred.make,
    model: cleanText(card.model) || inferred.model,
    trim: cleanText(card.trim),
    vin: cleanText(card.vin),
    location,
    damage: cleanText(card.damage || card.primaryDamage || "Unknown"),
    titleType: cleanText(card.titleType || card.docType || "Unknown"),
    mileage: numberFrom(card.mileage || card.odometer),
    currentBid: bid,
    auctionFee: numberFrom(provider.defaultAuctionFee),
    brokerFee: numberFrom(provider.defaultBrokerFee),
    shippingEstimate: numberFrom(provider.defaultShippingEstimate),
    auctionEndsAt: card.auctionEndsAt || card.saleDate || provider.defaultAuctionEndsAt,
    status: cleanText(card.status || "active"),
    flags: provider.defaultFlags || ["Rendered page scrape"],
    url: absoluteUrl(card.url, pageUrl),
    image: absoluteUrl(card.image, pageUrl)
  };
}

function parseEmbeddedNextData(html, provider, pageUrl) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1]);
    return collectVehicleObjects(parsed)
      .map((card) => fromCard(card, provider, pageUrl))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function collectVehicleObjects(value, results = []) {
  if (!value || typeof value !== "object") return results;

  if (Array.isArray(value)) {
    for (const item of value) collectVehicleObjects(item, results);
    return results;
  }

  const keys = Object.keys(value);
  const hasVehicleShape = keys.some((key) => /title|vehicleName|lotNumber|currentBid|odometer|primaryDamage|vin/i.test(key));
  if (hasVehicleShape) results.push(value);

  for (const item of Object.values(value)) {
    collectVehicleObjects(item, results);
  }

  return results;
}

function parseGeneric(provider, html, pageUrl) {
  const fromEmbedded = parseEmbeddedNextData(html, provider, pageUrl);
  const fromText = parseVisibleListingText(provider, html, pageUrl);
  return dedupe([...fromEmbedded, ...fromText]);
}

function parseVisibleListingText(provider, html, pageUrl) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  const patterns = [
    /(?<title>(?:19|20)\d{2}\s+[A-Z][A-Z0-9 .&/-]{3,80}?)\s+Odometer:\s*(?<mileage>[\d,]+)[\s\S]{0,80}?Title\s*Code:\s*(?<titleType>.*?)\s+Damage:\s*(?<damage>.*?)\s+Location:\s*(?<location>[A-Z]{2}\s+-\s+[A-Z][A-Z .'-]{2,50})\s+Sale Date:\s*(?<saleDate>.*?)\s+Sale Status:[\s\S]{0,520}?Current Bid:?\s*\$?(?<currentBid>[\d,]+(?:\.\d{2})?)/gi,
    /(?<time>\d+\s+day|(?:\d{1,2}:){2}\d{2})\s+(?<title>(?:19|20)\d{2}\s+[A-Z0-9][A-Z0-9 .&/-]{3,80}?)\s+(?<location>[A-Z]{2}\s+-\s+[A-Z][A-Z .'-]{2,40})\s+Current Bid\s+\$?(?<currentBid>[\d,]+(?:\.\d{2})?)/gi
  ];

  const listings = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      listings.push(fromCard(match.groups, provider, pageUrl));
    }
  }

  return listings.filter(Boolean);
}

function parseABetterBid(provider, html, pageUrl) {
  return parseGeneric(provider, html, pageUrl);
}

function parseSca(provider, html, pageUrl) {
  const listings = parseGeneric(provider, html, pageUrl);
  const detail = html.match(/(?<title>(?:19|20)\d{2}\s+[A-Z0-9][A-Z0-9 .&/-]{3,100})[\s\S]{0,500}?Primary Damage\s+(?<damage>[A-Za-z &/-]+)[\s\S]{0,120}?Odometer\s+(?<mileage>[\d,]+)[\s\S]{0,120}?Doc Type\s+(?<titleType>[A-Za-z ]+)[\s\S]{0,220}?VIN\s+(?<vin>[A-Z0-9*]{8,20})/i);

  if (detail?.groups) {
    const card = fromCard(detail.groups, provider, pageUrl);
    if (card) listings.push(card);
  }

  return dedupe(listings);
}

function parseCapitalAutoAuction(provider, html, pageUrl) {
  const cardListings = parseCapitalHtmlCards(provider, html, pageUrl);
  if (cardListings.length) return dedupe(cardListings).slice(0, provider.maxListingsPerPage || 30);

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ");

  const pattern = /(?<title>(?:19|20)\d{2}\s+[A-Z0-9][A-Z0-9 .&()/-]{2,90}?)\s+(?<auctionType>Upcoming Auction|Internet Auction)\s+Stock #\s*(?<stock>[A-Z0-9-]+)\s+Auction Date\s*(?<saleDate>(?:\d{2}\/\d{2}\/\d{4}|--\/--\/----)?)\s+(?:Enter Auction\s+)?(?:Run #\s*[^ ]+\s+)?Location\s+(?<location>[A-Za-z .,-]+?)\s+VIN\s*(?<vin>[A-Z0-9]{8,17})?\s+Status\s+(?<status>.*?)\s+Type\s+(?<type>.*?)\s+Color\s+(?<color>.*?)\s+Mileage\s+(?<mileage>[\d,]+)(?:\s+[A-Z]+)?\s+USD\s+(?:(?:Current Bid\s+\$?(?<currentBid>[\d,]+))|(?:Notify Me\s+OutOfStock\s+(?<outOfStockBid>[\d,]+)))/gi;
  const listings = [];

  for (const match of text.matchAll(pattern)) {
    const groups = match.groups || {};
    listings.push(fromCard(
      {
        title: groups.title,
        lotNumber: groups.stock,
        vin: groups.vin,
        location: groups.location,
        status: groups.status,
        titleType: groups.auctionType,
        damage: groups.type,
        mileage: groups.mileage,
        currentBid: groups.currentBid || groups.outOfStockBid || "0",
        saleDate: parseCapitalDate(groups.saleDate),
        url: pageUrl,
        image: ""
      },
      provider,
      pageUrl
    ));
  }

  return dedupe(listings.filter(Boolean)).slice(0, provider.maxListingsPerPage || 30);
}

function parseCapitalHtmlCards(provider, html, pageUrl) {
  return html
    .split(/<div class="card catalog__card"/i)
    .slice(1)
    .map((chunk) => parseCapitalHtmlCard(`<div class="card catalog__card"${chunk}`, provider, pageUrl))
    .filter(Boolean);
}

function parseCapitalHtmlCard(chunk, provider, pageUrl) {
  const title = htmlText(matchFirst(chunk, /<h3[^>]*class="card__title"[^>]*>([\s\S]*?)<\/h3>/i));
  if (!title || !/(19|20)\d{2}/.test(title)) return null;

  const stock = htmlText(matchFirst(chunk, /class="card__stock-value"[^>]*>([\s\S]*?)<\/span>/i));
  const saleDate = htmlText(matchFirst(chunk, /class="card__date-value"[^>]*>([\s\S]*?)<\/div>/i));
  const price = htmlText(matchFirst(chunk, /itemprop="price"[^>]*>([\s\S]*?)<\/span>/i));
  const image = matchFirst(chunk, /<img[^>]+itemprop="image"[^>]+src="([^"]+)"/i);
  const url = matchFirst(chunk, /<a[^>]+itemprop="url"[^>]+href="([^"]+)"/i);

  return fromCard(
    {
      title,
      lotNumber: stock,
      vin: optionValue(chunk, "VIN"),
      location: optionValue(chunk, "Location"),
      status: optionValue(chunk, "Status"),
      titleType: htmlText(matchFirst(chunk, /<span[^>]*class="event__type[^"]*"[^>]*>([\s\S]*?)<\/span>/i)),
      damage: optionValue(chunk, "Type"),
      mileage: optionValue(chunk, "Mileage"),
      currentBid: price,
      saleDate: parseCapitalDate(saleDate),
      url,
      image
    },
    provider,
    pageUrl
  );
}

function optionValue(chunk, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<span[^>]*class="card__option-caption"[^>]*>\\s*${escaped}\\s*<\\/span>\\s*<span[^>]*class="card__option-value"[^>]*>([\\s\\S]*?)<\\/span>`, "i");
  return htmlText(matchFirst(chunk, pattern));
}

function matchFirst(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : "";
}

function htmlText(value) {
  return cleanText(
    String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&#039;/g, "'")
  );
}

function parseCapitalDate(value) {
  const text = cleanText(value);
  if (!text || text === "--/--/----") return null;

  const match = text.match(/(?<month>\d{2})\/(?<day>\d{2})\/(?<year>\d{4})/);
  if (!match?.groups) return null;

  return `${match.groups.year}-${match.groups.month}-${match.groups.day}T18:00:00.000Z`;
}

function dedupe(listings) {
  const seen = new Set();
  return listings.filter((listing) => {
    const key = [listing.source, listing.vin, listing.sourceListingId, listing.title, listing.location, listing.currentBid].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const parsers = {
  "abetterbid-public": parseABetterBid,
  "sca-public": parseSca,
  "copart-public": parseGeneric,
  "iaai-public": parseGeneric,
  "cars4bid-public": parseGeneric,
  "autobidmaster-public": parseGeneric,
  "capitalautoauction-public": parseCapitalAutoAuction
};

function parseProviderListings(provider, html, pageUrl) {
  const parser = parsers[provider.id] || parseGeneric;
  return parser(provider, html, pageUrl);
}

module.exports = { parseProviderListings, parseGeneric, fromCard, parseCapitalAutoAuction };
