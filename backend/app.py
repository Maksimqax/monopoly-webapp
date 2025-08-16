#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, json, time, hmac, hashlib, base64, secrets, asyncio, random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
PUBLIC_URL = os.getenv("PUBLIC_URL", "http://127.0.0.1:8000").rstrip("/")

app = FastAPI(title="Monopoly Backend")
from fastapi.staticfiles import StaticFiles
app.mount("/webapp", StaticFiles(directory="../webapp", html=True), name="webapp")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== Telegram WebApp initData verification ======
def verify_webapp_init_data(init_data: str, bot_token: str) -> Dict[str, Any]:
    pairs = [s for s in init_data.split("&") if s]
    data: Dict[str, str] = {}
    data_pairs = []
    recv_hash = None
    for p in pairs:
        if "=" not in p:
            continue
        k, v = p.split("=", 1)
        if k == "hash":
            recv_hash = v
        else:
            data[k] = v
            data_pairs.append(f"{k}={v}")
    if not recv_hash:
        raise ValueError("No hash in initData")
    data_check_string = "\n".join(sorted(data_pairs))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    calc_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if calc_hash != recv_hash:
        raise ValueError("Bad initData hash")
    if "user" in data:
        try:
            user_obj = json.loads(base64.urlsafe_b64decode(data["user"] + "==").decode("utf-8"))
        except Exception:
            user_obj = {}
        data["user_obj"] = user_obj
    return data

# ====== Game Model (simplified) ======
@dataclass
class Player:
    id: str
    name: str
    pos: int = 0
    money: int = 1500
    in_jail: bool = False
    jail_turns: int = 0
    bankrupt: bool = False

@dataclass
class Property:
    name: str
    price: int
    rent: int
    owner: Optional[str] = None  # player_id

@dataclass
class Room:
    id: str
    players: Dict[str, Player] = field(default_factory=dict)
    order: List[str] = field(default_factory=list)
    turn_index: int = 0
    board: List[Dict[str, Any]] = field(default_factory=list)
    started: bool = False
    last_dice: int = 0
    created_at: float = field(default_factory=time.time)

# In-memory storage
ROOMS: Dict[str, Room] = {}
WS: Dict[str, List[WebSocket]] = {}

# Simple board of 16 cells
def make_board():
    return [
        {"type": "go", "name": "GO", "bonus": 200},
        {"type": "street", "name": "Green St", "price": 60, "rent": 2},
        {"type": "street", "name": "Blue St", "price": 60, "rent": 4},
        {"type": "tax", "name": "Income Tax", "amount": 100},
        {"type": "street", "name": "Orange Ave", "price": 100, "rent": 6},
        {"type": "chance", "name": "Chance"},
        {"type": "street", "name": "Red Rd", "price": 120, "rent": 8},
        {"type": "jail", "name": "Jail"},
        {"type": "street", "name": "Pink Pl", "price": 140, "rent": 10},
        {"type": "chance", "name": "Chance"},
        {"type": "street", "name": "Brown Blvd", "price": 160, "rent": 12},
        {"type": "tax", "name": "Luxury Tax", "amount": 100},
        {"type": "street", "name": "Silver Sq", "price": 180, "rent": 14},
        {"type": "street", "name": "Gold Sq", "price": 200, "rent": 16},
        {"type": "gotojail", "name": "Go To Jail"},
        {"type": "free", "name": "Free Parking"},
    ]

def room_state(room: Room):
    return {
        "room": room.id,
        "players": {pid: vars(p) for pid, p in room.players.items()},
        "order": room.order,
        "turn": room.order[room.turn_index] if room.order else None,
        "board": room.board,
        "last_dice": room.last_dice,
        "started": room.started,
    }

async def broadcast(room_id: str, msg: Dict[str, Any]):
    for ws in WS.get(room_id, []):
        try:
            await ws.send_json(msg)
        except:
            pass

def ensure_room(room_id: str) -> Room:
    if room_id not in ROOMS:
        ROOMS[room_id] = Room(id=room_id, board=make_board())
    return ROOMS[room_id]

# ====== HTTP endpoints ======
@app.post("/api/create_room")
async def create_room(req: Request):
    data = await req.json()
    init_data = data.get("initData","")
    verify_webapp_init_data(init_data, BOT_TOKEN)  # ensure legit
    rid = secrets.token_hex(3)
    ROOMS[rid] = Room(id=rid, board=make_board())
    return JSONResponse({"ok": True, "room": rid})

@app.post("/api/join")
async def join(req: Request):
    body = await req.json()
    init_data = body.get("initData","")
    room_id = body.get("room")
    info = verify_webapp_init_data(init_data, BOT_TOKEN)
    user = info.get("user_obj") or {}
    pid = str(user.get("id","0"))
    name = (user.get("first_name") or "Player")
    room = ensure_room(room_id)
    if pid not in room.players:
        room.players[pid] = Player(id=pid, name=name)
        room.order.append(pid)
    await broadcast(room_id, {"type":"state", "data": room_state(room)})
    return JSONResponse({"ok": True, "state": room_state(room)})

@app.post("/api/start")
async def start(req: Request):
    body = await req.json()
    room_id = body.get("room")
    room = ensure_room(room_id)
    if not room.order:
        raise HTTPException(400, "No players")
    room.started = True
    room.turn_index = 0
    await broadcast(room_id, {"type":"state", "data": room_state(room)})
    return {"ok": True}

def pass_go_bonus(p: Player, from_pos: int, to_pos: int, board_len: int):
    if to_pos < from_pos:
        p.money += 200

@app.post("/api/roll")
async def roll(req: Request):
    body = await req.json()
    init_data = body.get("initData","")
    room_id = body.get("room")
    verify_webapp_init_data(init_data, BOT_TOKEN)
    room = ensure_room(room_id)
    if not room.started or not room.order:
        raise HTTPException(400, "Game not started")
    current = room.order[room.turn_index]
    dice = random.randint(1,6)
    room.last_dice = dice
    p = room.players[current]
    if p.in_jail:
        p.jail_turns -= 1
        if p.jail_turns <= 0:
            p.in_jail = False
        await broadcast(room_id, {"type":"state", "data": room_state(room)})
        return {"ok": True, "dice": dice, "msg":"Serving jail"}

    from_pos = p.pos
    to_pos = (p.pos + dice) % len(room.board)
    pass_go_bonus(p, from_pos, to_pos, len(room.board))
    p.pos = to_pos
    cell = room.board[p.pos]
    event = {"type": "move", "player": p.id, "to": p.pos, "dice": dice}

    # Resolve cell
    if cell["type"] == "street":
        owner = cell.get("owner")
        if owner is None:
            event["action"] = "offer_buy"
            event["price"] = cell["price"]
        elif owner != p.id:
            rent = cell["rent"]
            p.money -= rent
            room.players[owner].money += rent
            event["action"] = "pay_rent"
            event["to_owner"] = owner
            event["amount"] = rent
    elif cell["type"] == "tax":
        amt = cell["amount"]
        p.money -= amt
        event["action"] = "tax"
        event["amount"] = amt
    elif cell["type"] == "gotojail":
        p.in_jail = True
        p.jail_turns = 2
        # send to jail index (7 in our board)
        jail_idx = next((i for i,c in enumerate(room.board) if c["type"]=="jail"), 7)
        p.pos = jail_idx
        event["action"] = "gotojail"
        event["to"] = jail_idx
    elif cell["type"] == "chance":
        # simple chance
        card = random.choice([
            {"t":"gain","amount":100,"text":"Нашли деньги: +100"},
            {"t":"lose","amount":50,"text":"Штраф: -50"},
            {"t":"move","steps":-3,"text":"Возврат на 3 клетки назад"},
        ])
        event["action"] = "chance"
        event["card"] = card
        if card["t"] == "gain":
            p.money += card["amount"]
        elif card["t"] == "lose":
            p.money -= card["amount"]
        elif card["t"] == "move":
            from_pos2 = p.pos
            p.pos = (p.pos + card["steps"]) % len(room.board)
            pass_go_bonus(p, from_pos2, p.pos, len(room.board))

    await broadcast(room_id, {"type":"event", "data": event})
    await broadcast(room_id, {"type":"state", "data": room_state(room)})
    return {"ok": True, "dice": dice, "event": event}

@app.post("/api/buy")
async def buy(req: Request):
    body = await req.json()
    room_id = body.get("room")
    pid = body.get("pid")
    room = ensure_room(room_id)
    p = room.players[pid]
    cell = room.board[p.pos]
    if cell["type"] != "street" or cell.get("owner") is not None or p.money < cell["price"]:
        raise HTTPException(400, "Cannot buy")
    p.money -= cell["price"]
    cell["owner"] = pid
    await broadcast(room_id, {"type":"state", "data": room_state(room)})
    return {"ok": True}

@app.post("/api/end_turn")
async def end_turn(req: Request):
    body = await req.json()
    room_id = body.get("room")
    room = ensure_room(room_id)
    if room.order:
        room.turn_index = (room.turn_index + 1) % len(room.order)
    await broadcast(room_id, {"type":"state", "data": room_state(room)})
    return {"ok": True}

# ====== WebSocket for live updates ======
@app.websocket("/ws")
async def ws(ws: WebSocket):
    await ws.accept()
    params = ws.query_params
    room_id = params.get("room")
    if not room_id:
        await ws.close(code=1008)
        return
    WS.setdefault(room_id, []).append(ws)
    try:
        # send initial
        room = ensure_room(room_id)
        await ws.send_json({"type":"state","data": room_state(room)})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        WS[room_id].remove(ws)
