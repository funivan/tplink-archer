# tplink-archer

Minimal Python client for reading status data from TP-Link Archer routers.

## Usage

```bash
python tplink_archer.py --host 192.168.0.1 --username admin --password "<password>"
```

The command logs in to the router web API and prints JSON from:

`/cgi-bin/luci/;stok=<token>/admin/status?form=all`