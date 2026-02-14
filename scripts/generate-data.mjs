// scripts/generate-data.mjs
import fs from "node:fs/promises";

const LIMIT = Number(process.env.LIMIT || 120);
const OUT_FILE = "data.json";

function buildSparql(limit) {
  return `
SELECT ?item ?itemLabel ?creatorLabel ?image ?sitelinks WHERE {
  ?item wdt:P31 wd:Q3305213;
        wdt:P18 ?image.
  OPTIONAL { ?item wdt:P170 ?creator. }
  ?item wikibase:sitelinks ?sitelinks.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,ja". }
}
ORDER BY DESC(?sitelinks)
LIMIT ${limit}
`;
}

function toThumb(url, width = 360) {
  try {
    const u = new URL(url);
    u.searchParams.set("width", String(width));
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchSparql(query) {
  const endpoint = "https://query.wikidata.org/sparql";
  const url = endpoint + "?format=json&query=" + encodeURIComponent(query);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/sparql-results+json",
      // WDQSはUAがない/薄いと弾くことがあるので明示
      "User-Agent": "masterpiece-collection/1.0 (local dev; contact: none)"
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WDQS failed: ${res.status} ${res.statusText}\n${text.slice(0, 300)}`);
  }
  return await res.json();
}

async function main() {
  console.log(`Generating ${OUT_FILE} (LIMIT=${LIMIT}) ...`);

  const sparql = buildSparql(LIMIT);

  const maxTries = 5;
  let json;
  for (let i = 1; i <= maxTries; i++) {
    try {
      json = await fetchSparql(sparql);
      break;
    } catch (e) {
      const waitMs = 1200 * i;
      console.warn(`Attempt ${i}/${maxTries} failed`);
      if (i === maxTries) throw e;
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  const rows = json.results.bindings.map(b => {
    const itemUrl = b.item.value;
    const id = itemUrl.split("/").pop();
    return {
      id,
      title: b.itemLabel?.value ?? id,
      artist: b.creatorLabel?.value ?? "Unknown",
      image: toThumb(b.image.value, 360)
    };
  });

  const seen = new Set();
  const unique = rows.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));

  await fs.writeFile(OUT_FILE, JSON.stringify(unique, null, 2) + "\n", "utf-8");
  console.log(`Done. Wrote ${unique.length} items to ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});