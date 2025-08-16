from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid

app = FastAPI(title="Monopoly WebApp")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === STATIC ===
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "webapp")
if not os.path.isdir(STATIC_DIR):
    raise RuntimeError(f"Static dir not found: {STATIC_DIR}")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

# === IN-MEMORY LOBBIES ===
# NB: для прототипа "owner" и "you" — плейсхолдеры. Позже подставим реального юзера из Telegram initData.
lobbies = {}  # id -> lobby dict


@app.get("/api/lobbies")
async def get_lobbies():
    return {
        "lobbies": [
            {
                "id": lid,
                "name": lb["name"],
                "max_players": lb["max_players"],
                "players": lb["players"],
                "locked": bool(lb.get("password")),
                "owner": lb["owner"],
                "started": lb.get("started", False),
            }
            for lid, lb in lobbies.items()
        ]
    }


@app.post("/api/lobbies")
async def create_lobby(req: Request):
    data = await req.json()
    name = (data.get("name") or "").strip()
    max_players = int(data.get("max_players") or 4)
    password = (data.get("password") or "").strip()
    owner = (data.get("owner") or "you").strip()  # TEMP

    if not name:
        raise HTTPException(400, "Название лобби обязательно")
    if max_players < 2 or max_players > 5:
        raise HTTPException(400, "Количество игроков — от 2 до 5")

    lobby_id = uuid.uuid4().hex[:6].upper()
    lobbies[lobby_id] = {
        "name": name,
        "max_players": max_players,
        "password": password or None,
        "owner": owner,
        "players": 1,            # создатель уже в лобби
        "members": [owner],      # список ников
        "started": False,
    }
    return {"ok": True, "id": lobby_id}


@app.post("/api/lobbies/{lobby_id}/join")
async def join_lobby(lobby_id: str, req: Request):
    if lobby_id not in lobbies:
        raise HTTPException(404, "Лобби не найдено")

    data = await req.json()
    password = (data.get("password") or "").strip()
    who = (data.get("who") or "you").strip()  # TEMP

    lobby = lobbies[lobby_id]

    if lobby.get("password") and lobby["password"] != password:
        raise HTTPException(403, "Неверный пароль")

    if who not in lobby["members"]:
        if lobby["players"] >= lobby["max_players"]:
            raise HTTPException(400, "Лобби заполнено")
        lobby["players"] += 1
        lobby["members"].append(who)

    return {
        "ok": True,
        "lobby": {
            "id": lobby_id,
            "name": lobby["name"],
            "players": lobby["players"],
            "max_players": lobby["max_players"],
            "owner": lobby["owner"],
            "started": lobby["started"],
        },
    }


@app.post("/api/lobbies/{lobby_id}/start")
async def start_lobby(lobby_id: str, req: Request):
    """Запуск игры создателем лобби (пока просто флаг started=True)."""
    if lobby_id not in lobbies:
        raise HTTPException(404, "Лобби не найдено")
    data = await req.json()
    who = (data.get("who") or "you").strip()

    lobby = lobbies[lobby_id]
    if who != lobby["owner"]:
        raise HTTPException(403, "Только создатель может запускать игру")
    if lobby["players"] < 2:
        raise HTTPException(400, "Нужно минимум 2 игрока")

    lobby["started"] = True
    return {"ok": True, "message": "Игра запущена", "lobby": {"id": lobby_id}}
