const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCapitalAutoAuction, parseKBid } = require("../src/ingestion/sourceParsers");
const { enrichListingIntelligence } = require("../src/ingestion/intelligence");

test("Capital Auto Auction parser extracts inventory cards", () => {
  const html = `
    <div class="card catalog__card" itemscope itemtype="https://schema.org/Product">
      <img itemprop="image" src="https://example.com/car.jpg" />
      <h3 class="card__title" itemprop="name">2008 C90 VL1500</h3>
      <span class="event__type event__type-block">Internet Auction</span>
      <span class="card__stock-value">PRS38568</span>
      <div class="card__date-value">05/16/2026</div>
      <span class="card__option-caption">Location</span><span class="card__option-value">Philadelphia, PA</span>
      <span class="card__option-caption">VIN</span><span class="card__option-value">JS1VY52A382100430</span>
      <span class="card__option-caption">Status</span><span class="card__option-value">n/a</span>
      <span class="card__option-caption">Type</span><span class="card__option-value">MOTORCYCLE</span>
      <span class="card__option-caption">Mileage</span><span class="card__option-value">999999 <b>TMU</b></span>
      <span itemprop="price">200</span>
      <a itemprop="url" href="https://www.capitalautoauction.com/inventory/details/abc">View Details</a>
    </div>
  `;

  const listings = parseCapitalAutoAuction(
    {
      id: "capitalautoauction-public",
      source: "Capital Auto Auction",
      defaultFlags: ["Capital inventory scrape"]
    },
    html,
    "https://www.capitalautoauction.com/inventory"
  );

  assert.equal(listings.length, 1);
  assert.equal(listings[0].source, "Capital Auto Auction");
  assert.equal(listings[0].sourceListingId, "PRS38568");
  assert.equal(listings[0].vin, "JS1VY52A382100430");
  assert.equal(listings[0].location, "Philadelphia, PA");
  assert.equal(listings[0].currentBid, 200);
  assert.equal(listings[0].mileage, 999999);
  assert.equal(listings[0].auctionEndsAt, "2026-05-16T18:00:00.000Z");
});

test("listing intelligence adds buyer-facing scores and notes", () => {
  const enriched = enrichListingIntelligence({
    source: "Test",
    title: "2021 Toyota Corolla",
    year: 2021,
    make: "Toyota",
    model: "Corolla",
    vin: "5YFB4MDE2MP063114",
    location: "Phoenix, AZ",
    damage: "Hail",
    titleType: "Clean",
    mileage: 33780,
    currentBid: 6400,
    auctionFee: 760,
    brokerFee: 299,
    shippingEstimate: 540,
    auctionEndsAt: "2026-05-12T04:30:00.000Z",
    flags: [],
    isDuplicate: false
  });

  assert.ok(enriched.confidenceScore >= 90);
  assert.ok(enriched.dealScore > 70);
  assert.equal(enriched.feeEstimateComplete, true);
});

test("K-BID parser extracts vehicle auction events", () => {
  const html = `
    * * *
    TopGear Auto Auction
    Begins Closing Tomorrow
    03/19/2026 08:30 pm
    1d 8h 11m
    Active
    <a href="/auction/123">View Auction</a>
    TopGear Auto Auction - Weekly Thursday Sale #50
    880 Southwest 15th St, Forest Lake, MN 55025
    763-203-7000
    Vehicles & Marine | 15 Items
    Cars/Trucks/Motorcycles (15)
    * * *
  `;

  const listings = parseKBid(
    { id: "kbid-public", source: "K-BID" },
    html,
    "https://www.k-bid.com/auction/list"
  );

  assert.equal(listings.length, 1);
  assert.equal(listings[0].source, "K-BID");
  assert.equal(listings[0].title, "TopGear Auto Auction - Weekly Thursday Sale #50");
  assert.equal(listings[0].location, "880 Southwest 15th St, Forest Lake, MN 55025");
  assert.equal(listings[0].auctionEndsAt, "2026-03-19T20:30:00.000Z");
  assert.equal(listings[0].url, "https://www.k-bid.com/auction/123");
});
