# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Local dev server: uv run serve.py, then open http://127.0.0.1:8765 (tests at /tests/)."""
import functools
import http.server
from pathlib import Path

ROOT = Path(__file__).parent
PORT = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows can map .js to text/plain, which breaks ES modules. Set the types explicitly.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".png": "image/png",
        ".html": "text/html",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Serving {ROOT} at http://127.0.0.1:{PORT}")
        httpd.serve_forever()
