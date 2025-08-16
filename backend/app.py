# backend/app.py
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

app = FastAPI()

# папки (repo_root / backend / app.py → repo_root)
REPO_ROOT = Path(__file__).resolve().parent.parent
WEBAPP_DIR = REPO_ROOT / "webapp"

# Раздаём фронт (css/js/картинки) как /static/*
app.mount("/static", StaticFiles(directory=str(WEBAPP_DIR)), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index = WEBAPP_DIR / "index.html"
    return FileResponse(index)

@app.get("/health")
async def health():
    return {"status": "ok"}

