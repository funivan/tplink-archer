# tplink-archer

Minimal Python client for reading status data from TP-Link Archer routers.

## Usage

```bash
python tplink_archer.py --host 192.168.0.1 --username admin
```

The command logs in to the router web API and prints JSON from:

`/cgi-bin/luci/;stok=<token>/admin/status?form=all`

You can pass the password via `--password`, `TPLINK_ARCHER_PASSWORD`, or interactive prompt.

## Security note

TP-Link login payloads are base64-encoded by the router protocol, not encrypted. Prefer `--https` whenever the router firmware supports it.