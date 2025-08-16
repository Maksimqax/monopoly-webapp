import asyncio
import json
import os
import random
import string
from typing import Dict, Any, Set

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ------------------------
# ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ
# ------------------------

app = FastAPI()

WEB_DIR = os.path.join(os.path.dirname(__file__), "..", "webapp")
WEB_DIR = os.path.abspath(WEB_DIR)

# Отдаём статику из webapp (css/js/html)
app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="static")

# ------------------------
# ПРОСТЕЙШАЯ МОДЕЛЬ ЛОББИ В ПАМЯТИ
# ------------------------

def _rid(n=6):
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=n))

class Lobbies:
    """Хранилище лобби в памяти (для прототипа)."""
    def __init__(self):
        # id -> lobby
        self.lobbies: Dict[str, Dict[str, Any]] = {}
        # id -> множество asyncio.Queue (подписчики SSE)
        self.subs: Dict[str, Set[asyncio.Queue]] = {}

    def get(self, lobby_id: str) -> Dict[str, Any]:
        if lobby_id not in self.lobbies:
            self.lobbies[lobby_id] = {
                "id": lobby_id,
                "name": "Без названия",
                "owner": None,           # uid создателя
                "players": [],           # [{uid, name, color}]
                "max_players": 2,
                "private": False,
                "password": None,
                "started": False,
            }
        return self.lobbies[lobby_id]

    def for_list(self):
        # то, что отдадим во фронт в списке лобби
        lst = []
        for l in self.lobbies.values():
            lst.append({
                "id": l["id"],
                "name": l["name"],
                "players_count": len(l["players"]),
                "players": l["players"],
                "max_players": l["max_players"],
                "private": bool(l["private"]),
                "started": bool(l["started"]),
            })
        # Открытые сверху, приватные ниже, нев_started сверху
        lst.sort(key=lambda x: (x["private"], x["started"], -x["players_count"]))
        return lst

    def subscribe(self, lobby_id: str, q: asyncio.Queue):
        self.subs.setdefault(lobby_id, set()).add(q)

    def unsubscribe(self, lobby_id: str, q: asyncio.Queue):
        try:
            self.subs.get(lobby_id, set()).discard(q)
        except Exception:
            pass

    async def publish(self, lobby_id: str, payload: Dict[str, Any]):
        dead = []
        for q in list(self.subs.get(lobby_id, set())):
            try:
                await q.put(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            self.unsubscribe(lobby_id, q)

LOBBIES = Lobbies()


def ensure_uid(req: Request) -> str:
    """Берём уникальный uid игрока из заголовка (присылаем с фронта)."""
    uid = req.headers.get("X-UID")
    if not uid:
        raise HTTPException(400, "Missing X-UID header")
    return uid


# ------------------------
#   МОДЕЛИ ЗАПРОСОВ
# ------------------------

class CreateLobbyBody(BaseModel):
    name: str
    max_players: int
    private: bool = False
    password: str | None = None
    color: str = "red"
    player_name: str

class JoinLobbyBody(BaseModel):
    lobby: str
    password: str | None = None
    color: str
    player_name: str

class LeaveLobbyBody(BaseModel):
    lobby: str

class StartBody(BaseModel):
    lobby: str


# ------------------------
#   SSE СТРИМ /events/{lobby}
# ------------------------

@app.get("/events/{lobby_id}")
async def sse_events(request: Request, lobby_id: str):
    lobby = LOBBIES.get(lobby_id)
    q: asyncio.Queue = asyncio.Queue()
    LOBBIES.subscribe(lobby_id, q)

    async def gen():
        # сразу отдаём состояние (state)
        await q.put({"type": "state", "payload": lobby_for_front(lobby_id)})
        try:
            while True:
                # Keep-alive, чтобы Render не резал соединение
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                except asyncio.TimeoutError:
                    yield ":\n\n"
                    continue
                yield "data: " + json.dumps(msg, ensure_ascii=False) + "\n\n"
        finally:
            LOBBIES.unsubscribe(lobby_id, q)

    return StreamingResponse(gen(), media_type="text/event-stream")


def lobby_for_front(lobby_id: str) -> Dict[str, Any]:
    l = LOBBIES.get(lobby_id)
    return {
        "id": l["id"],
        "name": l["name"],
        "players": l["players"],
        "max_players": l["max_players"],
        "private": l["private"],
        "started": l["started"],
        "players_count": len(l["players"]),
    }


# ------------------------
#      API ЛОББИ
# ------------------------

@app.get("/api/lobbies")
async def api_lobbies():
    return {"items": LOBBIES.for_list()}

@app.post("/api/lobby/create")
async def api_create(req: Request, body: CreateLobbyBody):
    uid = ensure_uid(req)

    # не позволяем создавать новую, если игрок уже где-то состоит
    for l in LOBBIES.lobbies.values():
        if any(p["uid"] == uid for p in l["players"]):
            raise HTTPException(400, "Вы уже находитесь в лобби")

    lobby_id = _rid()
    lobby = LOBBIES.get(lobby_id)
    lobby["name"] = body.name.strip() or "Лобби"
    lobby["owner"] = uid
    lobby["max_players"] = min(5, max(2, body.max_players))
    lobby["private"] = bool(body.private)
    lobby["password"] = body.password or None
    lobby["started"] = False
    lobby["players"] = [{
        "uid": uid,
        "name": (body.player_name or "Игрок")[:24],
        "color": body.color,
        "owner": True,
    }]
    # уведомим подписчиков списка (если такие есть)
    return {"ok": True, "lobby": lobby_for_front(lobby_id)}

@app.post("/api/lobby/join")
async def api_join(req: Request, body: JoinLobbyBody):
    uid = ensure_uid(req)
    lobby = LOBBIES.get(body.lobby)

    if lobby["started"]:
        raise HTTPException(400, "Игра уже началась")

    # не влезем сверх лимита
    if len(lobby["players"]) >= lobby["max_players"]:
        raise HTTPException(400, "Лобби заполнено")

    # пароль для приватного
    if lobby["private"]:
        if (lobby["password"] or "") != (body.password or ""):
            raise HTTPException(403, "Неверный пароль")

    # игрок не может быть сразу в двух лобби
    for l in LOBBIES.lobbies.values():
        if any(p["uid"] == uid for p in l["players"]):
            raise HTTPException(400, "Вы уже находитесь в другом лобби")

    # цвет не должен дублироваться
    if any(p.get("color") == body.color for p in lobby["players"]):
        raise HTTPException(400, "Цвет уже занят")

    lobby["players"].append({
        "uid": uid,
        "name": (body.player_name or "Игрок")[:24],
        "color": body.color,
        "owner": False,
    })
    await LOBBIES.publish(body.lobby, {"type": "state", "payload": lobby_for_front(body.lobby)})
    return {"ok": True, "lobby": lobby_for_front(body.lobby)}

@app.post("/api/lobby/leave")
async def api_leave(req: Request, body: LeaveLobbyBody):
    uid = ensure_uid(req)
    lobby = LOBBIES.get(body.lobby)
    before = len(lobby["players"])
    lobby["players"] = [p for p in lobby["players"] if p["uid"] != uid]
    # если вышел владелец — передаём владение первому оставшемуся
    if lobby["owner"] == uid:
        lobby["owner"] = lobby["players"][0]["uid"] if lobby["players"] else None
    # если пусто — удаляем лобби
    if not lobby["players"]:
        LOBBIES.lobbies.pop(body.lobby, None)
    else:
        await LOBBIES.publish(body.lobby, {"type": "state", "payload": lobby_for_front(body.lobby)})
    return {"ok": True, "changed": before != len(lobby["players"])}

@app.post("/api/lobby/start")
async def api_start(req: Request, body: StartBody):
    uid = ensure_uid(req)
    lobby = LOBBIES.get(body.lobby)
    if not lobby["players"]:
        raise HTTPException(400, "Лобби пустое")

    if lobby["owner"] != uid:
        raise HTTPException(403, "Только создатель может запускать игру")

    if len(lobby["players"]) < 2:
        raise HTTPException(400, "Нужно минимум 2 игрока")

    lobby["started"] = True
    await LOBBIES.publish(body.lobby, {"type": "started"})
    return {"ok": True}
