function parseRobots(text) {
  const groups = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      current = { agents: [value.toLowerCase()], rules: [], crawlDelay: null };
      groups.push(current);
      continue;
    }

    if (!current) continue;

    if (key === "disallow" || key === "allow") {
      current.rules.push({ type: key, path: value });
    }

    if (key === "crawl-delay") {
      const delay = Number(value);
      if (Number.isFinite(delay)) current.crawlDelay = delay;
    }
  }

  return groups;
}

function matchingGroups(groups, userAgent) {
  const normalized = userAgent.toLowerCase();
  const exact = groups.filter((group) => group.agents.some((agent) => agent !== "*" && normalized.includes(agent)));
  if (exact.length) return exact;
  return groups.filter((group) => group.agents.includes("*"));
}

function ruleMatches(pathname, rulePath) {
  if (!rulePath) return false;
  return pathname.startsWith(rulePath);
}

function isAllowed(robotsText, targetUrl, userAgent) {
  const url = new URL(targetUrl);
  const groups = matchingGroups(parseRobots(robotsText), userAgent);
  const rules = groups.flatMap((group) => group.rules).filter((rule) => ruleMatches(url.pathname, rule.path));

  if (!rules.length) return true;

  rules.sort((a, b) => b.path.length - a.path.length);
  return rules[0].type === "allow";
}

function crawlDelayMs(robotsText, userAgent, fallbackMs) {
  const groups = matchingGroups(parseRobots(robotsText), userAgent);
  const delay = groups.map((group) => group.crawlDelay).find((value) => value !== null);
  return delay === undefined ? fallbackMs : delay * 1000;
}

module.exports = { isAllowed, crawlDelayMs };
