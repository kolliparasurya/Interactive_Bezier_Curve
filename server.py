from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys

class SecurityHeaderHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # These two headers enable SharedArrayBuffer
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        SimpleHTTPRequestHandler.end_headers(self)

if __name__ == '__main__':
    port = 3000
    print(f"Serving on http://localhost:{port} (With Secure Headers)")
    httpd = HTTPServer(('localhost', port), SecurityHeaderHandler)
    httpd.serve_forever()