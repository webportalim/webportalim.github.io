import { chromium } from "playwright";
import fs from "node:fs";

const DATA_FILE = "fab-products.json";
const SELLER_URL = "https://www.fab.com/sellers/Serqan";

const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const byUrl = new Map((data.products || []).map(p => [p.url, p]));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  locale: "en-US"
});

try {
  const response = await page.goto(SELLER_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!response?.ok()) {
    throw new Error(`Fab seller page returned HTTP ${response?.status() ?? 'unknown'}; saved products were not changed.`);
  }
  await page.locator('a[href*="/listings/"]').first().waitFor({ state: "attached", timeout: 15000 });

  let lastCount = -1;
  let stable = 0;
  for (let i = 0; i < 10 && stable < 2; i++) {
    const count = await page.locator('a[href*="/listings/"]').count();
    stable = count === lastCount ? stable + 1 : 0;
    lastCount = count;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);
  }

  const cards = await page.locator('a[href*="/listings/"]').evaluateAll(nodes => {
    const out = new Map();

    for (const a of nodes) {
      const listing = new URL(a.href, location.href);
      if (listing.origin !== location.origin || !/^\/listings\/[0-9a-f-]{36}$/i.test(listing.pathname)) continue;
      const url = listing.origin + listing.pathname;
      let image = "";
      let title = (a.innerText || a.getAttribute("aria-label") || a.querySelector("img")?.alt || "").trim().split("\n")[0];
      if (!title) continue;

      const candidates = [a, a.parentElement, a.parentElement?.parentElement, a.parentElement?.parentElement?.parentElement];
      for (const el of candidates) {
        if (!el || image) continue;
        const img = el.querySelector("img");
        if (img) image = img.currentSrc || img.src || "";
      }

      if (!out.has(url) || (!out.get(url).image && image)) {
        out.set(url, { url, image, title });
      }
    }

    return [...out.values()];
  });

  if (!cards.length) {
    throw new Error("Fab returned no valid seller listings; saved products were not changed.");
  }

  for (const card of cards) {
    if (byUrl.has(card.url)) {
      const product = byUrl.get(card.url);
      if (card.image) product.image = card.image;
    } else {
      byUrl.set(card.url, {
        title: card.title || "Fab listing",
        url: card.url,
        image: card.image || "header.png",
        kind: "Fab listing",
        description: "Published product on Fab.",
        badge: "Fab"
      });
    }
  }

  const products = [...byUrl.values()];
  if (JSON.stringify(products) === JSON.stringify(data.products)) {
    console.log(`Checked ${cards.length} Fab listings; no product changes.`);
  } else {
    data.products = products;
    data.seller = "Serqan";
    data.seller_url = SELLER_URL;
    data.updated_at = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
    console.log(`Synced ${data.products.length} Fab products from seller cards.`);
  }
} finally {
  await browser.close();
}
