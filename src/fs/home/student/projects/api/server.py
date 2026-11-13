#!/usr/bin/env python3
# TODO: add authentication
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 8080

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

if __name__ == "__main__":
    HTTPServer(("", PORT), Handler).serve_forever()
