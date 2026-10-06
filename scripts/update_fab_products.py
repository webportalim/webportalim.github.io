#!/usr/bin/env python3
import json
import re
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "fab-products.json"
SELLER_URL = "https://www.fab.com/sellers/Serqan"
UA = "Mozilla/5.0 (compatible; WebportalimFabSync/1.0; +https://webportalim.github.io/)"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")

def meta(html, key):
    patterns = [
        rf'<meta[^>]+property=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']{re.escape(key)}["\']',
    ]
    for p in patterns:
        m = re.search(p, html, re.I)
        if m:
            return unescape(m.group(1)).strip()
    return ""

def discover_listing_urls(html):
    ids = set(re.findall(r'/listings/([0-9a-fA-F-]{36})', html))
    return [f"https://www.fab.com/listings/{x}" for x in sorted(ids)]

data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
known = {p["url"]: p for p in data.get("products", [])}

try:
    seller_html = fetch(SELLER_URL)
    for url in discover_listing_urls(seller_html):
        known.setdefault(url, {
            "title": "Fab listing",
            "url": url,
            "image": "header.png",
            "kind": "Fab listing",
            "description": "Published product on Fab.",
            "badge": "Fab",
        })
except Exception as exc:
    print(f"Seller discovery skipped: {exc}")

for url, product in list(known.items()):
    try:
        html = fetch(url)
        title = meta(html, "og:title")
        image = meta(html, "og:image")
        description = meta(html, "og:description")
        if title:
            title = re.sub(r"\s*\|\s*Fab\s*$", "", title).strip()
            product["title"] = title
        if image:
            product["image"] = image
        if description and product.get("description") in ("", "Published product on Fab."):
            product["description"] = description[:220]
    except Exception as exc:
        print(f"Refresh failed for {url}: {exc}")

data["seller"] = "Serqan"
data["seller_url"] = SELLER_URL
data["updated_at"] = datetime.now(timezone.utc).isoformat()
data["products"] = list(known.values())
DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Updated {len(data['products'])} Fab products.")
