import os
import sys
from urllib.parse import parse_qs, urlencode

# Ensure project root is on sys.path so modules import cleanly in serverless environment
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi import Request
from fastapi.responses import JSONResponse
from server import server_app

class VercelPathFixMiddleware:
    def __init__(self, asgi_app):
        self.asgi_app = asgi_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            query_bytes = scope.get("query_string", b"")
            if b"__path__=" in query_bytes:
                qs = parse_qs(query_bytes.decode("utf-8", errors="ignore"))
                custom_path = qs.pop("__path__", [None])[0]
                if custom_path:
                    scope["path"] = custom_path
                    scope["query_string"] = urlencode(qs, doseq=True).encode("utf-8")

        await self.asgi_app(scope, receive, send)

# Wrap with middleware for Vercel
app = VercelPathFixMiddleware(server_app)
