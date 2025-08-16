from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid

app = FastAPI(title="Monopoly WebApp")

# CORS (на будущее, если будешь звать из tg-web-app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Статика и главная ===
# ВАЖНО: каталог "webapp" лежит в корне репозитория.
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "webapp")
if not os.path.isdir(STATIC_DIR):
    # чтобы в логах было видно, если что-то не так со структурой
    raise RuntimeError(f"Static dir not found: {STATIC_DIR}")

# будет доступно по /static/...
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(html)


# === Простая in-memory логика лобби ===
lobbies = {}  # lobby_id -> dict


@app.get("/api/lobbies")
async def get_lobbies():
    """Список публичных лобби; приватные помечаем флажком."""
    out = []
    for lid, lobby in lobbies.items():
        out.append({
            "id": lid,
            "name": lobby["name"],
            "max_players": lobby["max_players"],
            "players": lobby["players"],
            "locked": bool(lobby.get("password")),
            "owner": lobby["owner"],
        })
    return {"lobbies": out}


@app.post("/api/lobbies")
async def create_lobby(req: Request):
    data = await req.json()
    name = (data.get("name") or "").strip()
    max_players = int(data.get("max_players") or 4)
    password = (data.get("password") or "").strip()
    owner = (data.get("owner") or "").strip()

    if not name:
        raise HTTPException(400, "Название лобби обязательно")
    if max_players < 2 or max_players > 5:
        raise HTTPException(400, "Количество игроков 2–5")

    lobby_id = uuid.uuid4().hex[:6].upper()
    lobbies[lobby_id] = {
        "name": name,
        "max_players": max_players,
        "password": password or None,
        "owner": owner or "host",
        "players": 0,
        "members": []
    }
    return {"ok": True, "id": lobby_id}


@app.post("/api/lobbies/{lobby_id}/join")
async def join_lobby(lobby_id: str, req: Request):
    if lobby_id not in lobbies:
        raise HTTPException(404, "Лобби не найдено")

    data = await req.json()
    password = (data.get("password") or "").strip()
    who = (data.get("who") or "guest").strip()

    lobby = lobbies[lobby_id]
    if lobby.get("password") and lobby["password"] != password:
        raise HTTPException(403, "Неверный пароль")

    if lobby["players"] >= lobby["max_players"]:
        raise HTTPException(400, "Лобби заполнено")

    lobby["players"] += 1
    lobby["members"].append(who)
    return {"ok": True, "lobby": {
        "id": lobby_id, "name": lobby["name"], "players": lobby["players"],
        "max_players": lobby["max_players"], "owner": lobby["owner"]
    }}
