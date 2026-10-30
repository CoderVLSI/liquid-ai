# PC bridge

Lets LFM3 Pocket use a computer or VM of yours: look at files and (if you allow it) run commands, with every
command and file change approved on the phone first.

```bash
python3 pc_bridge.py --root ~/projects                      # read-only, this machine only
python3 pc_bridge.py --host 0.0.0.0 --root ~ --allow-exec   # your phone can reach it over Wi-Fi
```

It prints a **URL** and a **token**. In the app: Setup (or Settings → Profile & setup) → *Remote computer* → paste both.

* It is an MCP server (streamable HTTP, `POST /mcp`), so any MCP client can use it, not just the app.
* Safe by default: token required, localhost only, read-only, files limited to `--root`.
  `--allow-write` adds `write_file`; `--allow-exec` adds `run_command`.
* Away from home? Don't open the port to the internet. Put the computer and the phone on the same
  [Tailscale](https://tailscale.com) network (or use an SSH tunnel) and use the computer's Tailscale address.
* A VM works the same way: run the script inside it.
