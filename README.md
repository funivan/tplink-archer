# TP-Link Router Info

Playwright script that logs into a TP-Link router's web UI, opens the Advanced section, and dumps RSSI / signal / cellular status details to stdout as JSON.

## Prerequisites

- Node.js 18+
- Yarn or npm
- Network access to the router's web UI

## Setup

1. Install dependencies and the Chromium browser:

   ```sh
   ./scripts/install.sh
   ```

   This runs `yarn install` (or `npm install`) and `playwright install chromium`.

2. Create a `.env` file and fill in your router credentials:

   ```sh
   cp .env.example .env
   ```

   Variables:
   - `ROUTER_URL` — full URL of the router (e.g. `https://192.168.4.1`).
   - `ROUTER_PASSWORD` — required.
   - `ROUTER_USER` — username, defaults to `admin`.
   - `HEADLESS` — set to `false` to watch the browser run. Defaults to headless.
   - `LOG_LEVEL` — `error` | `warn` | `info` | `debug` | `trace`. Defaults to `info`.

## Run

```sh
yarn start
# or
node scrape.js
```

The script logs in, navigates to Advanced, and prints a JSON object of signal fields (RSRP, RSRQ, SINR, RSSI, band, PCI, etc.) to stdout. Logs go to stderr.

## Notes

- TP-Link UIs vary by model and firmware. The script tries common selectors and falls back to scraping any text containing `RSSI`, `Signal`, etc.
- Self-signed HTTPS certificates are accepted automatically.
- A "force log in" prompt (another session active) is handled automatically.
