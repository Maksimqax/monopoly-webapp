# backend/app.py
from fastapi import FastAPI, Response
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

app = FastAPI()

# Папки: (repo_root / backend / app.py) → repo_root → webapp
REPO_ROOT = Path(__file__).resolve().parent.parent
WEBAPP_DIR = REPO_ROOT / "webapp"
INDEX_FILE = WEBAPP_DIR / "index.html"

# Раздаём статику /static/*
app.mount("/static", StaticFiles(directory=str(WEBAPP_DIR)), name="static")

# HEAD для рендер-проверок
@app.head("/")
async def head_root():
    return Response(status_code=200)

# Главная — отдаём index.html
@app.get("/", response_class=HTMLResponse)
async def serve_index():
    return FileResponse(INDEX_FILE)

# Фоллбэк: любые пути → index.html (удобно для SPA с клиентским роутингом)
@app.get("/{full_path:path}", response_class=HTMLResponse)
async def serve_spa(full_path: str):
    # Если придут за конкретным файлом (css/js/png) — отдастся из /static
    # Остальное — вернём index.html, а маршрутизацию сделает фронт
    return FileResponse(INDEX_FILE)

# Проверка живости
@app.get("/health")
async def health():
    return {"status": "ok"}
