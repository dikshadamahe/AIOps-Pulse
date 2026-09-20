import os
import sys

# Ensure project root is on sys.path so modules import cleanly in serverless environment
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from server import server_app

# Vercel serverless function entrypoint
app = server_app
