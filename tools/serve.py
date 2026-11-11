#!/usr/bin/env python3
"""Serve this sample for development: Python's http.server with a
Cache-Control: no-store header on every response, so that a reload always
fetches the current scripts (browsers otherwise keep ES modules served
without cache headers for a while, and a plain reload can show the old
page under the new footer).

Usage: python3 tools/serve.py [port]    (default 8000; serves the sample
directory, whatever the current directory)
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    with ThreadingHTTPServer(("", port), Handler) as httpd:
        print(f"serving {os.getcwd()} on http://localhost:{port}/ (Cache-Control: no-store)")
        httpd.serve_forever()
