#!/usr/bin/env python3
"""
PC bridge: lets the LFM3 Pocket app use your computer or VM as an MCP server.

One file, Python 3.8+, no dependencies. It speaks MCP "streamable HTTP" (POST /mcp) and offers a few tools:
  system_info                       always on
  list_dir, read_file, search_files read-only, limited to --root
  write_file                        only with --allow-write
  run_command                       only with --allow-exec

Safe by default: a token is required, it listens on localhost only, it is read-only, and files outside --root
are refused. The app also asks you to approve every command and file change.

  python3 pc_bridge.py --root ~/projects                        # read-only, localhost
  python3 pc_bridge.py --host 0.0.0.0 --root ~ --allow-exec     # reachable from your phone on the same Wi-Fi
"""
import argparse
import hmac
import json
import os
import platform
import secrets
import shutil
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL = "2025-06-18"
MAX_OUT = 20000


def log(msg):
    sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), msg))


class Bridge:
    def __init__(self, root, allow_write, allow_exec, timeout):
        self.root = os.path.realpath(os.path.expanduser(root))
        self.allow_write = allow_write
        self.allow_exec = allow_exec
        self.timeout = timeout

    # ---- path safety -----------------------------------------------------------------------
    def resolve(self, path):
        p = os.path.expanduser(path or ".")
        if not os.path.isabs(p):
            p = os.path.join(self.root, p)
        real = os.path.realpath(p)
        if real != self.root and not real.startswith(self.root + os.sep):
            raise ValueError("that path is outside the allowed folder (%s)" % self.root)
        return real

    # ---- tools -----------------------------------------------------------------------------
    def tools(self):
        t = [
            {"name": "system_info", "description": "Operating system, host name, allowed folder, free disk space and what this bridge may do.",
             "inputSchema": {"type": "object", "properties": {}}},
            {"name": "list_dir", "description": "List the files and folders in a directory (relative to the allowed folder).",
             "inputSchema": {"type": "object", "properties": {"path": {"type": "string", "description": "folder, default '.'"}}}},
            {"name": "read_file", "description": "Read a text file.",
             "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}, "max_bytes": {"type": "number", "description": "default 20000"}}, "required": ["path"]}},
            {"name": "search_files", "description": "Find files whose name contains some text.",
             "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "path": {"type": "string", "description": "folder to search, default '.'"}}, "required": ["query"]}},
        ]
        if self.allow_write:
            t.append({"name": "write_file", "description": "Write (replace) a text file.",
                      "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}})
        if self.allow_exec:
            t.append({"name": "run_command", "description": "Run a shell command in the allowed folder and return its output.",
                      "inputSchema": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}})
        return t

    def call(self, name, a):
        if name == "system_info":
            free = shutil.disk_usage(self.root).free // (1024 * 1024)
            return "%s %s | host %s | folder %s | %d MB free | write=%s exec=%s" % (
                platform.system(), platform.release(), platform.node(), self.root, free, self.allow_write, self.allow_exec)
        if name == "list_dir":
            d = self.resolve(a.get("path", "."))
            rows = []
            for n in sorted(os.listdir(d))[:300]:
                full = os.path.join(d, n)
                rows.append(("%s/" % n) if os.path.isdir(full) else "%s  (%d bytes)" % (n, os.path.getsize(full)))
            return "\n".join(rows) or "(empty)"
        if name == "read_file":
            f = self.resolve(a.get("path", ""))
            limit = int(a.get("max_bytes") or 20000)
            with open(f, "rb") as fh:
                data = fh.read(min(limit, 200000) + 1)
            text = data[:limit].decode("utf-8", "replace")
            return text + ("\n…[truncated]" if len(data) > limit else "")
        if name == "search_files":
            base = self.resolve(a.get("path", "."))
            q = str(a.get("query", "")).lower()
            hits = []
            for dp, dn, fn in os.walk(base):
                dn[:] = [x for x in dn if not x.startswith(".") and x not in ("node_modules", "__pycache__")]
                for n in fn:
                    if q in n.lower():
                        hits.append(os.path.relpath(os.path.join(dp, n), self.root))
                        if len(hits) >= 100:
                            return "\n".join(hits) + "\n…[more not shown]"
            return "\n".join(hits) or "No files found."
        if name == "write_file" and self.allow_write:
            f = self.resolve(a.get("path", ""))
            os.makedirs(os.path.dirname(f), exist_ok=True)
            with open(f, "w", encoding="utf-8") as fh:
                fh.write(str(a.get("content", "")))
            return "Wrote %s" % os.path.relpath(f, self.root)
        if name == "run_command" and self.allow_exec:
            cmd = str(a.get("command", "")).strip()
            if not cmd:
                raise ValueError("command is empty")
            r = subprocess.run(cmd, shell=True, cwd=self.root, capture_output=True, text=True, timeout=self.timeout)
            out = (r.stdout or "") + (("\n[stderr]\n" + r.stderr) if r.stderr else "")
            if len(out) > MAX_OUT:
                out = out[:MAX_OUT] + "\n…[output cut]"
            return "exit code %d\n%s" % (r.returncode, out)
        raise ValueError("unknown or disabled tool: %s" % name)

    # ---- JSON-RPC --------------------------------------------------------------------------
    def handle(self, msg):
        method, mid = msg.get("method"), msg.get("id")
        if mid is None:  # a notification: nothing to answer
            return None
        try:
            if method == "initialize":
                result = {"protocolVersion": (msg.get("params") or {}).get("protocolVersion") or PROTOCOL,
                          "capabilities": {"tools": {}}, "serverInfo": {"name": "pc-bridge", "version": "1.0"}}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": self.tools()}
            elif method == "tools/call":
                p = msg.get("params") or {}
                log("tool %s %s" % (p.get("name"), json.dumps(p.get("arguments") or {})[:200]))
                try:
                    text = self.call(p.get("name"), p.get("arguments") or {})
                    result = {"content": [{"type": "text", "text": text}]}
                except subprocess.TimeoutExpired:
                    result = {"isError": True, "content": [{"type": "text", "text": "the command took longer than %d s and was stopped" % self.timeout}]}
                except Exception as e:  # tool-level failure: the model reads it and can react
                    result = {"isError": True, "content": [{"type": "text", "text": str(e)}]}
            else:
                return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found: %s" % method}}
            return {"jsonrpc": "2.0", "id": mid, "result": result}
        except Exception as e:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": str(e)}}


def make_handler(bridge, token):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            pass

        def _send(self, status, body=b"", ctype="application/json", extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _authorised(self):
            got = self.headers.get("Authorization", "")
            return hmac.compare_digest(got.encode(), ("Bearer " + token).encode())

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, b'{"ok":true}')
            self._send(405, b'{"error":"use POST /mcp"}')

        def do_POST(self):
            if self.path.split("?")[0] != "/mcp":
                return self._send(404, b'{"error":"not found"}')
            if not self._authorised():
                log("refused a request with a wrong or missing token")
                return self._send(401, b'{"error":"bad token"}')
            try:
                n = int(self.headers.get("Content-Length", "0"))
                msg = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                return self._send(400, b'{"error":"bad json"}')
            msgs = msg if isinstance(msg, list) else [msg]
            replies = [r for r in (bridge.handle(m) for m in msgs) if r is not None]
            extra = {"Mcp-Session-Id": secrets.token_hex(8)} if any(m.get("method") == "initialize" for m in msgs) else {}
            if not replies:
                return self._send(202, b"", extra=extra)
            body = json.dumps(replies if isinstance(msg, list) else replies[0]).encode()
            self._send(200, body, extra=extra)

    return H


def main():
    ap = argparse.ArgumentParser(description="Let the LFM3 Pocket app use this computer through MCP.")
    ap.add_argument("--host", default="127.0.0.1", help="127.0.0.1 (this machine only) or 0.0.0.0 (reachable from your phone)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--root", default="~", help="the only folder tools may touch (default: your home folder)")
    ap.add_argument("--token", default=os.environ.get("PC_BRIDGE_TOKEN", ""), help="access token (made up for you when empty)")
    ap.add_argument("--allow-write", action="store_true", help="enable write_file")
    ap.add_argument("--allow-exec", action="store_true", help="enable run_command")
    ap.add_argument("--timeout", type=int, default=30, help="seconds a command may run")
    a = ap.parse_args()

    token = a.token or secrets.token_urlsafe(18)
    bridge = Bridge(a.root, a.allow_write, a.allow_exec, a.timeout)
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(bridge, token))
    print("PC bridge running")
    print("  URL    : http://%s:%d/mcp%s" % ("<this-computer's-address>" if a.host == "0.0.0.0" else a.host, a.port, ""))
    print("  token  : %s" % token)
    print("  folder : %s" % bridge.root)
    print("  write  : %s   run commands: %s" % ("ON" if a.allow_write else "off", "ON" if a.allow_exec else "off"))
    if a.host == "0.0.0.0":
        print("  Anyone on your network who has the token can use these tools. Keep it private.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
