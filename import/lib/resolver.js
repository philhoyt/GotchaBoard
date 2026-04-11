// Resolves the highest-resolution image URL from a Pinterest pin page.
// Takes a Puppeteer `page` object (managed/reused by the caller) and a pin.
//
// Strategy 0 (fast path): If the pin has an image_hash from the export, construct
// the pinimg.com URL directly — no browser navigation needed.
//
// Strategy 1–3: Navigate to the pin page and extract from the live DOM.

const NAVIGATION_TIMEOUT = 20000;
const SELECTOR_TIMEOUT   = 10000;

// Build a direct pinimg.com URL from the export's image hash.
// Pinterest stores images at: /originals/{h[0:2]}/{h[2:4]}/{h[4:6]}/{hash}.jpg
function hashToUrl(hash) {
  return `https://i.pinimg.com/originals/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash.slice(4,6)}/${hash}.jpg`;
}

// Upgrade any thumbnail-size URL to originals resolution
function upgradePinImgUrl(url) {
  return url.replace(/\/\d+x\//, '/originals/');
}

async function resolvePin(page, pin) {
  const pinUrl = pin.pin_url;

  // ── Strategy 0: direct hash URL (no browser needed) ────────────────
  if (pin.image_hash && /^[a-f0-9]{32}$/i.test(pin.image_hash)) {
    return hashToUrl(pin.image_hash.toLowerCase());
  }

  // ── Strategies 1–3 require browser navigation ───────────────────────
  if (!pinUrl) throw new Error('no pin URL');

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  await page.goto(pinUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT,
  });

  // Detect 404 (Pinterest SPA returns HTTP 200 with a not-found view)
  const pageTitle = await page.title().catch(() => '');
  if (/page not found|404|this page isn/i.test(pageTitle)) {
    throw new Error('404');
  }

  // Wait for Pinterest to render an image into the DOM
  await page.waitForFunction(
    () => !!document.querySelector('img[src*="pinimg.com"]'),
    { timeout: SELECTOR_TIMEOUT }
  ).catch(() => {});

  // Strategy 1: og:image meta tag
  try {
    const ogImage = await page.$eval(
      'meta[property="og:image"]',
      el => el.getAttribute('content') || ''
    );
    if (ogImage && ogImage.startsWith('https://') && !isPlaceholder(ogImage)) {
      return upgradePinImgUrl(ogImage);
    }
  } catch (_) {}

  // Strategy 2: pinimg.com images in DOM — prefer highest-res
  const pinImgUrl = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[src*="pinimg.com"]')];
    if (!imgs.length) return null;
    const rank = url => {
      if (url.includes('/originals/')) return 0;
      if (url.includes('/736x/'))      return 1;
      if (url.includes('/564x/'))      return 2;
      if (url.includes('/474x/'))      return 3;
      return 4;
    };
    imgs.sort((a, b) => rank(a.src) - rank(b.src));
    return imgs[0].src;
  });

  if (pinImgUrl && !isPlaceholder(pinImgUrl)) {
    return upgradePinImgUrl(pinImgUrl);
  }

  // Strategy 3: any large img on the page
  const imgUrl = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[src]')];
    return imgs
      .map(img => ({ src: img.src, area: img.naturalWidth * img.naturalHeight }))
      .filter(i => i.area > 10000 && i.src.startsWith('https://'))
      .sort((a, b) => b.area - a.area)[0]?.src ?? null;
  });

  if (imgUrl && !isPlaceholder(imgUrl)) return imgUrl;

  throw new Error('no image found');
}

function isPlaceholder(url) {
  return (
    url.includes('logo') ||
    url.includes('placeholder') ||
    url.includes('avatar') ||
    url.includes('pinterest.com/images') ||
    url.includes('pinterest-media-upload')
  );
}

module.exports = { resolvePin };
