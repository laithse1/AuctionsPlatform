const fallbackListings = [
  {
    id: "fallback-copart-accord",
    source: "Copart",
    title: "2018 Honda Accord EX",
    year: 2018,
    make: "Honda",
    model: "Accord",
    vin: "1HGCV1F34JA000214",
    location: "Houston, TX",
    damage: "Front End",
    titleType: "Salvage",
    mileage: 68210,
    currentBid: 3800,
    auctionFee: 560,
    brokerFee: 299,
    shippingEstimate: 650,
    totalEstimate: 5309,
    auctionEndsAt: "2026-05-11T16:00:00.000Z",
    risk: "watch",
    flags: ["Runs and drives", "Keys available", "Front end"],
    url: "https://www.copart.com/",
    image: "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?auto=format&fit=crop&w=900&q=80",
    isDuplicate: true
  }
];

let listings = [];
let feedMeta = {
  generatedAt: null,
  providers: [],
  rejectedCount: 0,
  apiOnline: false
};

const state = {
  query: "",
  source: "all",
  damage: "all",
  maxBid: "",
  risk: "all",
  sort: "ending",
  savedOnly: false,
  saved: new Set(JSON.parse(localStorage.getItem("auctionhub.saved") || "[]"))
};

const els = {
  listingGrid: document.querySelector("#listingGrid"),
  template: document.querySelector("#listingTemplate"),
  searchInput: document.querySelector("#searchInput"),
  sourceFilter: document.querySelector("#sourceFilter"),
  damageFilter: document.querySelector("#damageFilter"),
  maxBidFilter: document.querySelector("#maxBidFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  resultCount: document.querySelector("#resultCount"),
  savedCount: document.querySelector("#savedCount"),
  savedList: document.querySelector("#savedList"),
  savedToggle: document.querySelector("#savedToggle"),
  clearSaved: document.querySelector("#clearSaved"),
  totalListings: document.querySelector("#totalListings"),
  dedupeCount: document.querySelector("#dedupeCount"),
  avgBid: document.querySelector("#avgBid"),
  endingSoon: document.querySelector("#endingSoon"),
  feedStatus: document.querySelector("#feedStatus"),
  refreshButton: document.querySelector("#refreshButton")
};

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

function hoursUntil(dateValue) {
  if (!dateValue) return null;
  const diff = new Date(dateValue).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 36e5));
}

function totalCost(listing) {
  return listing.totalEstimate || listing.currentBid + listing.auctionFee + listing.brokerFee + listing.shippingEstimate;
}

function duplicateMap() {
  return listings.reduce((map, listing) => {
    if (listing.vin) map[listing.vin] = (map[listing.vin] || 0) + 1;
    return map;
  }, {});
}

function resetFilterOptions(select, label) {
  select.replaceChildren(new Option(label, "all"));
}

function populateFilters() {
  const previousSource = state.source;
  const previousDamage = state.damage;
  const sources = [...new Set(listings.map((listing) => listing.source).filter(Boolean))].sort();
  const damages = [...new Set(listings.map((listing) => listing.damage).filter(Boolean))].sort();

  resetFilterOptions(els.sourceFilter, "All auctions");
  resetFilterOptions(els.damageFilter, "All damage");

  sources.forEach((source) => els.sourceFilter.append(new Option(source, source)));
  damages.forEach((damage) => els.damageFilter.append(new Option(damage, damage)));

  state.source = sources.includes(previousSource) ? previousSource : "all";
  state.damage = damages.includes(previousDamage) ? previousDamage : "all";
  els.sourceFilter.value = state.source;
  els.damageFilter.value = state.damage;
}

function getFilteredListings() {
  const query = state.query.trim().toLowerCase();
  const maxBid = Number(state.maxBid || 0);

  const filtered = listings.filter((listing) => {
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
      (state.source === "all" || listing.source === state.source) &&
      (state.damage === "all" || listing.damage === state.damage) &&
      (!maxBid || listing.currentBid <= maxBid) &&
      (state.risk === "all" || listing.risk === state.risk) &&
      (!state.savedOnly || state.saved.has(listing.id))
    );
  });

  filtered.sort((a, b) => {
    if (state.sort === "priceAsc") return a.currentBid - b.currentBid;
    if (state.sort === "priceDesc") return b.currentBid - a.currentBid;
    if (state.sort === "yearDesc") return b.year - a.year;
    if (state.sort === "dealDesc") return (b.dealScore || 0) - (a.dealScore || 0);
    if (state.sort === "confidenceDesc") return (b.confidenceScore || 0) - (a.confidenceScore || 0);
    return (hoursUntil(a.auctionEndsAt) || 0) - (hoursUntil(b.auctionEndsAt) || 0);
  });

  return filtered;
}

function renderSummary(filtered) {
  const duplicates = duplicateMap();
  const duplicateListings = listings.filter((listing) => listing.isDuplicate || duplicates[listing.vin] > 1).length;
  const avg = filtered.length ? filtered.reduce((sum, listing) => sum + listing.currentBid, 0) / filtered.length : 0;

  els.totalListings.textContent = String(listings.length);
  els.dedupeCount.textContent = String(duplicateListings);
  els.avgBid.textContent = money(avg);
  els.endingSoon.textContent = String(listings.filter((listing) => (hoursUntil(listing.auctionEndsAt) || 9999) <= 48).length);
}

function renderFeedStatus() {
  const generated = feedMeta.generatedAt ? new Date(feedMeta.generatedAt).toLocaleString() : "not refreshed";
  const failedProviders = feedMeta.providers.filter((provider) => provider.status !== "ok");
  const status = feedMeta.apiOnline ? "Live API feed" : "Static fallback";
  const providerText = feedMeta.providers.length ? `${feedMeta.providers.length} provider run(s)` : "no provider runs";
  const rejected = feedMeta.rejectedCount ? `, ${feedMeta.rejectedCount} rejected` : "";
  const failed = failedProviders.length ? `, ${failedProviders.length} failed` : "";

  els.feedStatus.textContent = `${status}: ${providerText}${rejected}${failed}. Updated ${generated}.`;
}

function renderListings() {
  const filtered = getFilteredListings();
  const duplicates = duplicateMap();

  els.listingGrid.replaceChildren();
  els.resultCount.textContent = `Showing ${filtered.length} listing${filtered.length === 1 ? "" : "s"}`;

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No listings match these filters.";
    els.listingGrid.append(empty);
    renderSummary(filtered);
    renderSaved();
    renderFeedStatus();
    return;
  }

  filtered.forEach((listing) => {
    const node = els.template.content.firstElementChild.cloneNode(true);
    const img = node.querySelector("img");
    const save = node.querySelector(".save-button");
    const risk = node.querySelector(".risk-badge");
    const duplicate = node.querySelector(".duplicate");
    const score = node.querySelector(".score-badge");
    const notes = node.querySelector(".notes");
    const endsInHours = hoursUntil(listing.auctionEndsAt);

    img.src = listing.image || "";
    img.alt = `${listing.title} auction listing`;
    node.querySelector(".source-badge").textContent = listing.source;
    node.querySelector("h3").textContent = listing.title;
    node.querySelector(".meta").textContent = `${listing.location} | ${Number(listing.mileage || 0).toLocaleString()} mi | ${listing.titleType} | VIN ${listing.vin || "N/A"}`;
    node.querySelector(".bid").textContent = money(listing.currentBid);
    node.querySelector(".total").textContent = money(totalCost(listing));
    node.querySelector(".ends").textContent = endsInHours === null ? "TBD" : `${endsInHours}h`;
    node.querySelector(".primary-link").href = listing.url;

    risk.textContent = listing.risk === "low" ? "Low risk" : listing.risk === "watch" ? "Review" : "High risk";
    risk.classList.add(`risk-${listing.risk || "watch"}`);
    score.textContent = `Deal ${listing.dealScore ?? "--"}`;
    score.classList.add(scoreClass(listing.dealScore));

    if (state.saved.has(listing.id)) {
      save.classList.add("saved");
      save.textContent = "*";
    }

    save.addEventListener("click", () => toggleSaved(listing.id));
    node.querySelector(".details-button").addEventListener("click", () => {
      alert(`${listing.title}\n\nFees estimate:\nAuction fee: ${money(listing.auctionFee)}\nBroker fee: ${money(listing.brokerFee)}\nShipping: ${money(listing.shippingEstimate)}\nEstimated total: ${money(totalCost(listing))}`);
    });

    (listing.flags || []).forEach((flag) => {
      const tag = document.createElement("span");
      tag.className = "flag";
      tag.textContent = flag;
      node.querySelector(".flags").append(tag);
    });

    duplicate.textContent = listing.isDuplicate || duplicates[listing.vin] > 1 ? "Possible duplicate listing found by VIN." : "";
    notes.textContent = [...(listing.riskReasons || []), ...(listing.buyerNotes || [])].slice(0, 3).join(" | ");
    els.listingGrid.append(node);
  });

  renderSummary(filtered);
  renderSaved();
  renderFeedStatus();
}

function scoreClass(score) {
  if (score >= 75) return "score-strong";
  if (score >= 50) return "score-fair";
  return "score-weak";
}

function renderSaved() {
  const savedListings = listings.filter((listing) => state.saved.has(listing.id));
  els.savedCount.textContent = String(savedListings.length);
  els.savedList.replaceChildren();

  if (!savedListings.length) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No saved listings yet.";
    els.savedList.append(empty);
    return;
  }

  savedListings.forEach((listing) => {
    const item = document.createElement("div");
    item.className = "saved-item";
    const endsInHours = hoursUntil(listing.auctionEndsAt);
    item.innerHTML = `<strong>${listing.title}</strong><span>${listing.source} | ${money(listing.currentBid)} | ends in ${endsInHours === null ? "TBD" : `${endsInHours}h`}</span>`;
    els.savedList.append(item);
  });
}

function persistSaved() {
  localStorage.setItem("auctionhub.saved", JSON.stringify([...state.saved]));
}

function toggleSaved(id) {
  if (state.saved.has(id)) {
    state.saved.delete(id);
  } else {
    state.saved.add(id);
  }
  persistSaved();
  renderListings();
}

async function loadListings() {
  try {
    const response = await fetch("/api/listings", { cache: "no-store" });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const data = await response.json();

    listings = data.listings || [];
    feedMeta = {
      generatedAt: data.generatedAt,
      providers: data.providers || [],
      rejectedCount: data.rejectedCount || 0,
      apiOnline: true
    };
  } catch {
    listings = fallbackListings;
    feedMeta = {
      generatedAt: null,
      providers: [],
      rejectedCount: 0,
      apiOnline: false
    };
  }

  populateFilters();
  renderListings();
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderListings();
  });

  els.sourceFilter.addEventListener("change", (event) => {
    state.source = event.target.value;
    renderListings();
  });

  els.damageFilter.addEventListener("change", (event) => {
    state.damage = event.target.value;
    renderListings();
  });

  els.maxBidFilter.addEventListener("input", (event) => {
    state.maxBid = event.target.value;
    renderListings();
  });

  els.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderListings();
  });

  document.querySelectorAll("[data-risk]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-risk]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.risk = button.dataset.risk;
      renderListings();
    });
  });

  els.savedToggle.addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    els.savedToggle.classList.toggle("active", state.savedOnly);
    renderListings();
  });

  els.clearSaved.addEventListener("click", () => {
    state.saved.clear();
    persistSaved();
    renderListings();
  });

  els.refreshButton.addEventListener("click", loadListings);
}

bindEvents();
loadListings();
