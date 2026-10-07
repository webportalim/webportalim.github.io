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
  await page.goto(SELLER_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

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
      const url = new URL(a.href, location.href).href.split("?")[0];
      let image = "";
      let title = (a.innerText || "").trim().split("\n")[0] || "Fab listing";

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

  data.products = [...byUrl.values()];
  data.seller = "Serqan";
  data.seller_url = SELLER_URL;
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`Synced ${data.products.length} Fab products from seller cards.`);
} finally {
  await browser.close();
}
