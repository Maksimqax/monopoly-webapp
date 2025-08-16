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

# ==== STATIC =====
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "webapp")
if not os.path.isdir(STATIC_DIR):
    raise RuntimeError(f"Static dir not found: {STATIC_DIR}")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def index():
    with open(os.path.join(STATIC_DIR, "index.html"), "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


# ===== IN-MEMORY STORE (в проде заменить на БД/Redis) =====
lobbies: dict[str, dict] = {}

ALLOWED_COLORS = ["red", "blue", "green", "yellow", "purple", "orange"]


def _validate_color(color: str):
    if color not in ALLOWED_COLORS:
        raise HTTPException(400, "Недопустимый цвет")


def _user_in_active_lobby(user: str) -> str | None:
    """Вернёт id активного лобби, где участвует user (владелец или участник)."""
    for lid, lb in lobbies.items():
        if lb.get("started"):
            continue
        if user == lb["owner"] or user in lb["members"]:
            return lid
    return None


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
                "taken_colors": lb["taken_colors"],   # user -> color
                "members": lb["members"],             # список участников
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
    owner = (data.get("owner") or "you").strip()
    color = (data.get("color") or "").strip()

    if not name:
        raise HTTPException(400, "Название лобби обязательно")
    if max_players < 2 or max_players > 5:
        raise HTTPException(400, "Количество игроков — от 2 до 5")
    _validate_color(color)

    # Запрет создавать, если уже где-то состоим
    lid = _user_in_active_lobby(owner)
    if lid:
        raise HTTPException(400, "Вы уже состоите в активном лобби")

    lobby_id = uuid.uuid4().hex[:6].upper()
    lobbies[lobby_id] = {
        "name": name,
        "max_players": max_players,
        "password": password or None,
        "owner": owner,
        "players": 1,
        "members": [owner],
        "taken_colors": {owner: color},
        "used_colors": {color},
        "started": False,
    }
    return {"ok": True, "id": lobby_id}


@app.post("/api/lobbies/{lobby_id}/join")
async def join_lobby(lobby_id: str, req: Request):
    if lobby_id not in lobbies:
        raise HTTPException(404, "Лобби не найдено")

    data = await req.json()
    password = (data.get("password") or "").strip()
    who = (data.get("who") or "you").strip()
    color = (data.get("color") or "").strip()
    _validate_color(color)

    # запрет вступать в несколько активных лобби
    lid = _user_in_active_lobby(who)
    if lid and lid != lobby_id:
        raise HTTPException(400, "Вы уже состоите в другом активном лобби")

    lb = lobbies[lobby_id]

    if lb.get("password") and lb["password"] != password:
        raise HTTPException(403, "Неверный пароль")

    if who in lb["members"]:
        # уже внутри — просто вернуть информацию
        return {
            "ok": True,
            "lobby": {
                "id": lobby_id, "name": lb["name"], "players": lb["players"],
                "max_players": lb["max_players"], "owner": lb["owner"],
                "started": lb["started"], "taken_colors": lb["taken_colors"],
                "members": lb["members"],
            },
        }

    if lb["players"] >= lb["max_players"]:
        raise HTTPException(400, "Лобби заполнено")
    if color in lb["used_colors"]:
        raise HTTPException(400, "Этот цвет уже занят")

    lb["players"] += 1
    lb["members"].append(who)
    lb["taken_colors"][who] = color
    lb["used_colors"].add(color)

    return {
        "ok": True,
        "lobby": {
            "id": lobby_id, "name": lb["name"], "players": lb["players"],
            "max_players": lb["max_players"], "owner": lb["owner"],
            "started": lb["started"], "taken_colors": lb["taken_colors"],
            "members": lb["members"],
        },
    }


@app.post("/api/lobbies/{lobby_id}/leave")
async def leave_lobby(lobby_id: str, req: Request):
    if lobby_id not in lobbies:
        raise HTTPException(404, "Лобби не найдено")

    data = await req.json()
    who = (data.get("who") or "you").strip()
    lb = lobbies[lobby_id]

    if who not in lb["members"]:
        raise HTTPException(400, "Вы не состоите в этом лобби")

    # удалить участника
    lb["members"].remove(who)
    lb["players"] -= 1
    color = lb["taken_colors"].pop(who, None)
    if color and color in lb["used_colors"]:
        lb["used_colors"].discard(color)

    # если никого не осталось — удалить лобби
    if lb["players"] <= 0:
        del lobbies[lobby_id]
        return {"ok": True, "deleted": True}

    # если ушёл владелец — передать права первому оставшемуся
    if who == lb["owner"]:
        lb["owner"] = lb["members"][0]

    return {"ok": True, "lobby": {"id": lobby_id, "owner": lb["owner"], "players": lb["players"]}}


@app.post("/api/lobbies/{lobby_id}/start")
async def start_lobby(lobby_id: str, req: Request):
    if lobby_id not in lobbies:
        raise HTTPException(404, "Лобби не найдено")
    data = await req.json()
    who = (data.get("who") or "you").strip()

    lb = lobbies[lobby_id]
    if who != lb["owner"]:
        raise HTTPException(403, "Только создатель может запускать игру")
    if lb["players"] < 2:
        raise HTTPException(400, "Нужно минимум 2 игрока")

    lb["started"] = True
    return {"ok": True, "message": "Игра запущена", "lobby": {"id": lobby_id}}
