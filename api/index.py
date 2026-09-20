import os
import sys

# Ensure project root is on sys.path so modules import cleanly in serverless environment
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi import Request
from server import server_app

@server_app.get("/api/debug-path")
@server_app.get("/debug-path")
def debug_path(request: Request):
    return {
        "url": str(request.url),
        "path": request.scope.get("path"),
        "headers": dict(request.headers)
    }

class VercelPathFixMiddleware:
    def __init__(self, asgi_app):
        self.asgi_app = asgi_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            headers = dict(scope.get("headers", []))
            matched_path = headers.get(b"x-matched-path", b"").decode("utf-8")
            forwarded_uri = headers.get(b"x-forwarded-uri", b"").decode("utf-8")
            
            orig_path = matched_path or forwarded_uri
            if orig_path and orig_path.startswith("/api/"):
                scope["path"] = orig_path
            elif not path.startswith("/api/") and path.startswith("/v1/"):
                scope["path"] = "/api" + path

        await self.asgi_app(scope, receive, send)

# Wrap with middleware for Vercel
app = VercelPathFixMiddleware(server_app)
