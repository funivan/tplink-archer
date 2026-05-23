// Playwright script: log into TP-Link router at https://192.168.4.1,
// open the Advanced section, and dump RSSI / status details to the console.
//
// Usage:
//   yarn install
//   yarn playwright install chromium
//   # put ROUTER_PASSWORD=... (and optionally ROUTER_USER, ROUTER_URL) in .env
//   yarn start
//
// Notes:
//   - TP-Link UIs vary by model/firmware. This script tries common selectors
//     and falls back to scraping any text containing "RSSI"/"Signal"/etc.
//   - Self-signed HTTPS is accepted via ignoreHTTPSErrors.

require('dotenv').config({ override: true, quiet: true });
const { chromium } = require('playwright');

const ROUTER_URL = process.env.ROUTER_URL;
const PASS = process.env.ROUTER_PASSWORD;
const USER = process.env.ROUTER_USER || 'admin';
const HEADLESS = process.env.HEADLESS !== 'false';

// LOG_LEVEL: error | warn | info | debug | trace  (default: info)
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
const LOG_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const t0 = Date.now();
function log(level, ...args) {
  if ((LEVELS[level] ?? LEVELS.info) > LOG_LEVEL) return;
  const ms = String(Date.now() - t0).padStart(6);
  process.stderr.write(`[${ms}ms ${level.toUpperCase()}] ${args.join(' ')}\n`);
}
const logError = (...a) => log('error', ...a);
const logWarn = (...a) => log('warn', ...a);
const logInfo = (...a) => log('info', ...a);
const logDebug = (...a) => log('debug', ...a);
const logTrace = (...a) => log('trace', ...a);

if (!PASS) {
  logError('ROUTER_PASSWORD env var is required');
  process.exit(1);
}
logInfo(`config: url=${ROUTER_URL} user=${USER} headless=${HEADLESS} logLevel=${process.env.LOG_LEVEL || 'info'}`);

async function firstVisible(page, selectors, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        try {
          if (await loc.isVisible()) return loc;
        } catch {}
      }
    }
    await page.waitForTimeout(150);
  }
  return null;
}

async function login(page) {
  logInfo(`login: navigating to ${ROUTER_URL}`);
  await page.goto(ROUTER_URL, { waitUntil: 'domcontentloaded' });
  logDebug('login: page loaded');

  // Some TP-Link UIs only ask for a password; others ask for user+password.
  const userField = await firstVisible(page, [
    'input#username',
    'input[name="username"]',
    'input[placeholder*="user" i]',
  ], 2000);
  if (userField) {
    logDebug('login: filling username field');
    await userField.fill(USER);
  } else {
    logDebug('login: no username field present');
  }

  const passField = await firstVisible(page, [
    'input#pcPassword',
    'input#password',
    'input[type="password"]',
    'input[name="password"]',
  ], 8000);
  if (!passField) throw new Error('Password field not found on login page');
  logDebug('login: filling password field');
  await passField.fill(PASS);

  const loginBtn = await firstVisible(page, [
    'button#login-btn',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'a:has-text("Log In")',
    'input[type="submit"]',
    '#loginBtn',
  ], 4000);
  if (loginBtn) {
    logDebug('login: clicking login button');
    await loginBtn.click();
  } else {
    logDebug('login: no login button found, pressing Enter');
    await passField.press('Enter');
  }

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Handle "force log in" / "another device is logged in" confirmation.
  // Wait up to 5s for it to appear.
  await page.waitForFunction(
    () => /force the other device|another (user|device).*log/i.test(document.body.innerText),
    null, { timeout: 5000 },
  ).catch(() => {});
  for (let i = 0; i < 3; i++) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (/force the other device|another (user|device).*log/i.test(text)) {
      logWarn(`login: force-login prompt detected (attempt ${i + 1}/3)`);
      // Click the LAST visible "Log in" — dialog buttons are appended after the form.
      const all = page.locator('button:has-text("Log in"), a:has-text("Log in"), .btn:has-text("Log in")');
      const n = await all.count();
      let clicked = false;
      for (let k = n - 1; k >= 0; k--) {
        const el = all.nth(k);
        if (await el.isVisible().catch(() => false)) {
          logDebug(`login: clicking force-login button index ${k}`);
          await el.click().catch(() => {});
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
    } else break;
  }
}

async function listMenu(page) {
  // Collect every visible clickable nav item across all frames.
  const items = [];
  for (const frame of page.frames()) {
    let found = [];
    try {
      found = await frame.evaluate(() => {
        const out = [];
        const seen = new Set();
        const sel = 'a, button, li, .menu-item, .nav-item, [role="menuitem"], [role="tab"]';
        document.querySelectorAll(sel).forEach((el) => {
          if (!el.offsetParent) return;
          const text = (el.innerText || el.textContent || '').trim();
          if (!text || text.length > 60) return;
          if (seen.has(text)) return;
          seen.add(text);
          out.push(text);
        });
        return out;
      });
    } catch {}
    items.push(...found);
  }
  return Array.from(new Set(items));
}

async function clickByText(page, text, { clickTimeout = 4000, idleTimeout = 10000 } = {}) {
  for (const frame of page.frames()) {
    const loc = frame.locator(
      `a:has-text("${text}"), button:has-text("${text}"), li:has-text("${text}"), [role="menuitem"]:has-text("${text}"), [role="tab"]:has-text("${text}")`,
    ).first();
    if (await loc.count()) {
      try {
        logTrace(`clickByText: clicking "${text}" in frame ${frame.url() || 'main'}`);
        await loc.click({ timeout: clickTimeout });
        await page.waitForLoadState('networkidle', { timeout: idleTimeout }).catch(() => {});
        logDebug(`clickByText: clicked "${text}"`);
        return true;
      } catch (e) {
        logTrace(`clickByText: click "${text}" failed: ${e.message}`);
      }
    }
  }
  return false;
}

async function clickByTextWithRetry(page, text, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (await clickByText(page, text)) return true;
    logDebug(`clickByTextWithRetry: "${text}" not clicked (attempt ${i + 1}/${attempts})`);
    await page.waitForTimeout(1000 * (i + 1));
  }
  logWarn(`clickByTextWithRetry: gave up on "${text}" after ${attempts} attempts`);
  return false;
}

const SIGNAL_KEYS = /(ss-?rsrp|ss-?rsrq|ss-?sinr|rsrp|rsrq|sinr|rssi|snr|arfcn|pci|imsi|iccid)/i;

// True if any frame currently renders cellular/signal data.
async function hasAdvancedData(page) {
  for (const frame of page.frames()) {
    try {
      const text = await frame.evaluate(() => document.body.innerText || '');
      const m = text.match(SIGNAL_KEYS);
      if (m) {
        logDebug(`hasAdvancedData: matched "${m[0]}" in frame ${frame.url() || 'main'}`);
        return true;
      }
    } catch (e) {
      logTrace(`hasAdvancedData: frame eval failed: ${e.message}`);
    }
  }
  return false;
}

// Polls every frame's text until a signal keyword appears or timeout elapses.
async function waitForAdvancedData(page, timeout = 20000) {
  logInfo(`waitForAdvancedData: polling up to ${timeout}ms`);
  const deadline = Date.now() + timeout;
  let polls = 0;
  while (Date.now() < deadline) {
    if (await hasAdvancedData(page)) {
      logInfo(`waitForAdvancedData: found data after ${polls} polls`);
      return true;
    }
    polls++;
    await page.waitForTimeout(500);
  }
  logWarn(`waitForAdvancedData: timed out after ${timeout}ms (${polls} polls)`);
  return false;
}

async function openAdvanced(page) {
  logInfo('openAdvanced: looking for Advanced menu item');
  // Click Advanced with retries — some firmwares are slow to render the menu.
  for (let attempt = 0; attempt < 3; attempt++) {
    const menu = await listMenu(page);
    logDebug(`openAdvanced: menu items=${menu.length} (attempt ${attempt + 1}/3)`);
    logTrace(`openAdvanced: menu=${JSON.stringify(menu)}`);
    if (menu.some(m => m.toLowerCase() === 'advanced')) {
      if (await clickByTextWithRetry(page, 'Advanced')) {
        logInfo('openAdvanced: Advanced clicked');
        break;
      }
    } else {
      logDebug('openAdvanced: "Advanced" not in menu yet');
    }
    await page.waitForTimeout(1500);
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // If the Advanced landing page already shows signal data, we're done.
  if (await hasAdvancedData(page)) {
    logInfo('openAdvanced: signal data visible on landing page, skipping sub-tabs');
    return;
  }

  // Navigate into cellular / status sub-pages where signal details live.
  for (const label of ['Internet', 'Network', 'Cellular', 'Mobile Network', 'SIM', 'Status', 'Wireless']) {
    logDebug(`openAdvanced: trying sub-tab "${label}"`);
    if (await clickByTextWithRetry(page, label, 2)) {
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      if (await hasAdvancedData(page)) {
        logInfo(`openAdvanced: signal data appeared after "${label}"`);
        return;
      }
    }
  }

  // Last resort: poll for async data fetches.
  logDebug('openAdvanced: no sub-tab yielded data, falling back to long poll');
  await waitForAdvancedData(page, 20000);
}

async function collectByRow(page) {
  // Group every visible leaf by y-coordinate row, sorted left-to-right.
  // This reconstructs the visual layout the user sees on screen.
  const rows = [];
  for (const frame of page.frames()) {
    let frameRows = [];
    try {
      frameRows = await frame.evaluate(() => {
        const leaves = [];
        const getText = (el) => {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return (el.value || '').trim();
          if (el.tagName === 'SELECT') return (el.options[el.selectedIndex]?.text || '').trim();
          return (el.innerText || el.textContent || '').trim();
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
          acceptNode: (el) => {
            if (!el.offsetParent && el.tagName !== 'BODY') return NodeFilter.FILTER_SKIP;
            const isFormVal = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
            if (!isFormVal && el.children.length) return NodeFilter.FILTER_SKIP;
            return getText(el) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          },
        });
        let n;
        while ((n = walker.nextNode())) {
          const r = n.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          leaves.push({ text: getText(n), x: r.left, y: r.top, h: r.height });
        }
        // Bucket by y (round to nearest 8px).
        const buckets = new Map();
        for (const l of leaves) {
          const key = Math.round(l.y / 8) * 8;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(l);
        }
        const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
        // Drop sidebar/nav: keep only items whose x is >= 400 (content panel).
        return sorted.map(([y, items]) => ({
          y,
          line: items.filter(i => i.x >= 400).sort((a, b) => a.x - b.x).map(i => i.text).join('  |  '),
          items: items.filter(i => i.x >= 400).sort((a, b) => a.x - b.x),
        }));
      });
    } catch {}
    rows.push(...frameRows);
  }
  return rows;
}

(async () => {
  logInfo('startup: launching browser');
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  logDebug('startup: browser launched');

  try {
    await login(page);
    logInfo('login: complete');
    await page.waitForTimeout(1500);
    await openAdvanced(page);

    // Retry collection — data fields can render in lazily after the page paints.
    // Bail out as soon as a signal keyword (RSRP/RSRQ/SINR/...) appears.
    let rows = [];
    let all = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      logDebug(`collect: attempt ${attempt + 1}/4`);
      rows = await collectByRow(page);
      all = [];
      for (const r of rows) for (const it of (r.items || [])) all.push(it);
      logDebug(`collect: rows=${rows.length} leaves=${all.length}`);
      const hit = all.find(it => SIGNAL_KEYS.test(it.text));
      if (hit) {
        logInfo(`collect: found signal data ("${hit.text}") after ${attempt + 1} attempt(s)`);
        break;
      }
      logWarn(`collect: no signal data yet (attempt ${attempt + 1}/4), waiting...`);
      await page.waitForTimeout(2500 + 1500 * attempt);
    }

    const used = new Set();
    const cellular = {};
    const LABEL_HINT = /^(isp|sim|network type|imsi|mcc|iccid|mnc|msisdn|download|upload|data|band|signal|nr-?arfcn|e-?arfcn|ss-?rsrp|ss-?rsrq|ss-?sinr|rsrp|rsrq|sinr|snr|pci|cell id|tac|tx power|dl mod|ul mod|dl mcs|ul mcs|cqi|ri|rbs|downlink|uplink|mode)\b/i;
    for (const lab of all) {
      const stripped = lab.text.replace(/\s*[:：]\s*$/, '').trim();
      const hasColon = /[:：]\s*$/.test(lab.text);
      if (!stripped || stripped.length > 60) continue;
      if (!hasColon && !LABEL_HINT.test(stripped)) continue;
      const key = stripped;
      let best = null, bestDx = Infinity;
      for (let i = 0; i < all.length; i++) {
        const cand = all[i];
        if (cand === lab || used.has(i)) continue;
        if (/[:：]$/.test(cand.text)) continue;
        const yc1 = lab.y + lab.h / 2;
        const yc2 = cand.y + cand.h / 2;
        if (Math.abs(yc1 - yc2) > 16) continue;
        const dx = cand.x - lab.x;
        if (dx <= 0) continue;
        if (dx < bestDx) { bestDx = dx; best = i; }
      }
      if (best != null) {
        used.add(best);
        const k = key in cellular ? `${key} (alt)` : key;
        cellular[k] = all[best].text;
      }
    }

    const KEYS = /(rssi|rsrp|rsrq|sinr|snr|signal|band|arfcn|pci|mcs|mod|bandwidth|frequency|tx power|cqi|cell id|tac|isp|sim|imsi|iccid|msisdn|mcc|mnc|network type|download|upload|data|ri$|rbs)/i;
    const signal = {};
    for (const k of Object.keys(cellular)) {
      if (KEYS.test(k)) signal[k] = cellular[k];
    }
    if (!Object.keys(signal).length) {
      logWarn(`no signal keys matched. rows=${rows.length} leaves=${all.length} cellularKeys=${Object.keys(cellular).length}`);
      logDebug(`sample rows:\n${rows.slice(0, 40).map(r => r.line).filter(Boolean).join('\n')}`);
    } else {
      logInfo(`output: ${Object.keys(signal).length} signal field(s)`);
    }
    process.stdout.write(JSON.stringify(signal, null, 2) + '\n');
  } catch (err) {
    logError(`fatal: ${err.message}`);
    process.stderr.write(JSON.stringify({ error: err.message }) + '\n');
    process.exitCode = 1;
  } finally {
    logDebug('shutdown: closing browser');
    await browser.close();
    logInfo('done');
  }
})();
