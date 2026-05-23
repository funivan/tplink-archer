# TP-Link Router Scrape

Playwright script that logs into a TP-Link router's web UI, opens the Advanced section, and dumps RSSI / signal / status details to the console.

## Prerequisites

- Node.js 18+
- [Yarn](https://classic.yarnpkg.com/lang/en/docs/install/) (Classic or Berry both work)
- Network access to the router's web UI

## Setup

1. Install dependencies (this also installs the Chromium browser via Playwright's `postinstall`):

   ```sh
   yarn install
   ```

   If Chromium did not install automatically, run:

   ```sh
   yarn playwright install chromium
   ```

2. Create a `.env` file from the example and fill in your router credentials:

   ```sh
   cp .env.example .env
   ```

   Edit `.env`:

   ```
   ROUTER_IP=192.168.1.1
   ROUTER_USERNAME=admin
   ROUTER_PASSWORD=your_password_here
   ```

   Optional variables:
   - `ROUTER_URL` — full URL override (e.g. `https://192.168.4.1`). Defaults to `https://192.168.1.1`.
   - `ROUTER_USER` — username override. Defaults to `admin`.
   - `HEADLESS` — set to `false` to watch the browser run. Defaults to headless.

## Run

```sh
yarn start
```

The script will log in, navigate to the Advanced section, and print RSSI / signal / status information to stdout.

## Notes

- TP-Link UIs vary by model and firmware. The script tries common selectors and falls back to scraping any text containing `RSSI`, `Signal`, etc.
- Self-signed HTTPS certificates are accepted automatically.
