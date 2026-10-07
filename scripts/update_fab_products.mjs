import { chromium } from "playwright";
import fs from "node:fs";

const DATA_FILE = "fab-products.json";
const SELLER_URL = "https://www.fab.com/sellers/Serqan";

const existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const byUrl = new Map((existing.products || []).map(p => [p.url, p]));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1200 },
  locale: "en-US"
});

await page.goto(SELLER_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);

// Fab lazy-loads seller cards, so scroll until the listing set stops growing.
let lastCount = -1;
let stablePasses = 0;
for (let i = 0; i < 20 && stablePasses < 3; i++) {
  const count = await page.locator('a[href*="/listings/"]').count();
  if (count === lastCount) stablePasses++;
  else stablePasses = 0;
  lastCount = count;
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(900);
}

const sellerCards = await page.locator('a[href*="/listings/"]').evaluateAll(nodes => {
  const out = new Map();

  for (const a of nodes) {
    const url = new URL(a.href, location.href).href.split("?")[0];
    let image = "";

    const direct = a.querySelector("img");
    if (direct) image = direct.currentSrc || direct.src || "";

    if (!image) {
      let p = a.parentElement;
      for (let i = 0; p && i < 6 && !image; i++, p = p.parentElement) {
        const img = p.querySelector("img");
        if (img) image = img.currentSrc || img.src || "";
      }
    }

    const previous = out.get(url);
    if (!previous || (!previous.image && image)) out.set(url, { url, image });
  }

  return [...out.values()];
});

for (const card of sellerCards) {
  const url = card.url;
  if (!byUrl.has(url)) {
    byUrl.set(url, {
      title: "Fab listing",
      url,
      image: card.image || "header.png",
      kind: "Fab listing",
      description: "Published product on Fab.",
      badge: "Fab"
    });
  } else if (card.image) {
    byUrl.get(url).image = card.image;
  }
}

for (const [url, product] of byUrl) {
  const p = await browser.newPage({ locale: "en-US" });
  try {
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await p.waitForTimeout(1200);

    const meta = async (selector, attr = "content") =>
      (await p.locator(selector).first().getAttribute(attr).catch(() => null))?.trim() || "";

    const ogTitle = await meta('meta[property="og:title"]');
    const ogImage = await meta('meta[property="og:image"]');
    const ogDescription = await meta('meta[property="og:description"]');

    if (ogTitle) product.title = ogTitle.replace(/\s*\|\s*Fab\s*$/i, "").trim();
    if (ogImage && (!product.image || product.image === "header.png")) product.image = ogImage;
    if (ogDescription && (!product.description || product.description === "Published product on Fab.")) {
      product.description = ogDescription.slice(0, 220);
    }

    // Try to derive a compact category label from visible breadcrumbs.
    const crumbs = await p.locator('a[href*="/category/"], a[href*="product_types"]').allTextContents().catch(() => []);
    const clean = [...new Set(crumbs.map(x => x.trim()).filter(Boolean))].slice(0, 3);
    if (clean.length && (!product.kind || product.kind === "Fab listing")) product.kind = clean.join(" / ");
  } catch (err) {
    console.warn("Fab listing refresh failed:", url, err.message);
  } finally {
    await p.close();
  }
}

await browser.close();

const nextProducts = [...byUrl.values()];
const before = JSON.stringify(existing.products || []);
const after = JSON.stringify(nextProducts);

if (before !== after) {
  existing.products = nextProducts;
  existing.seller = "Serqan";
  existing.seller_url = SELLER_URL;
  existing.updated_at = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2) + "\n");
  console.log(`Updated Fab data: ${nextProducts.length} products.`);
} else {
  console.log(`No Fab product changes: ${nextProducts.length} products.`);
}
