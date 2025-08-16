from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os, uuid, random

app = FastAPI(title="Monopoly WebApp")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ---------- STATIC ----------
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "webapp")
if not os.path.isdir(STATIC_DIR):
    raise RuntimeError(f"Static dir not found: {STATIC_DIR}")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def index():
    with open(os.path.join(STATIC_DIR, "index.html"), "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.get("/game", response_class=HTMLResponse)
async def game_page():
    with open(os.path.join(STATIC_DIR, "game.html"), "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


# ============ STORE ============
lobbies: dict[str, dict] = {}
games: dict[str, dict] = {}   # key = lobby_id

ALLOWED_COLORS = ["red","blue","green","yellow","purple","orange"]

def _validate_color(c:str):
    if c not in ALLOWED_COLORS:
        raise HTTPException(400,"Недопустимый цвет")

def _user_in_active_lobby(user: str) -> str | None:
    for lid, lb in lobbies.items():
        if lb.get("started"):  # уже запущена — не мешаем
            continue
        if user == lb["owner"] or user in lb["members"]:
            return lid
    return None

# ---------- LOBBIES ----------
@app.get("/api/lobbies")
async def api_lobbies():
    return {"lobbies":[
        {"id":lid, "name":lb["name"], "max_players":lb["max_players"],
         "players":lb["players"], "locked":bool(lb.get("password")),
         "owner":lb["owner"], "started":lb.get("started",False),
         "taken_colors":lb["taken_colors"], "members":lb["members"]}
        for lid,lb in lobbies.items()
    ]}

@app.post("/api/lobbies")
async def api_create(req: Request):
    d = await req.json()
    name = (d.get("name") or "").strip()
    max_players = int(d.get("max_players") or 4)
    password = (d.get("password") or "").strip() or None
    owner = (d.get("owner") or "you").strip()
    color = (d.get("color") or "").strip()
    if not name: raise HTTPException(400,"Название лобби обязательно")
    if max_players<2 or max_players>5: raise HTTPException(400,"Игроков 2–5")
    _validate_color(color)
    if _user_in_active_lobby(owner): raise HTTPException(400,"Сначала покиньте текущее лобби")
    lid = uuid.uuid4().hex[:6].upper()
    lobbies[lid] = {
        "name":name,"max_players":max_players,"password":password,
        "owner":owner,"players":1,"members":[owner],
        "taken_colors":{owner:color},"used_colors":{color},
        "started":False
    }
    return {"ok":True,"id":lid}

@app.post("/api/lobbies/{lid}/join")
async def api_join(lid:str, req: Request):
    if lid not in lobbies: raise HTTPException(404,"Лобби не найдено")
    d = await req.json()
    who = (d.get("who") or "you").strip()
    color = (d.get("color") or "").strip()
    password = (d.get("password") or "").strip()
    _validate_color(color)
    lb = lobbies[lid]
    if lb.get("password") and lb["password"]!=password: raise HTTPException(403,"Неверный пароль")
    # запрет на второе активное лобби
    x = _user_in_active_lobby(who)
    if x and x!=lid: raise HTTPException(400,"Вы уже в другом активном лобби")

    if who in lb["members"]:
        return {"ok":True,"lobby":{"id":lid,"owner":lb["owner"],"players":lb["players"],"max_players":lb["max_players"],
                                   "started":lb["started"],"members":lb["members"],"taken_colors":lb["taken_colors"]}}
    if lb["players"]>=lb["max_players"]: raise HTTPException(400,"Лобби заполнено")
    if color in lb["used_colors"]: raise HTTPException(400,"Цвет занят")
    lb["players"]+=1; lb["members"].append(who)
    lb["taken_colors"][who]=color; lb["used_colors"].add(color)
    return {"ok":True}

@app.post("/api/lobbies/{lid}/leave")
async def api_leave(lid:str, req: Request):
    if lid not in lobbies: raise HTTPException(404,"Лобби не найдено")
    d = await req.json()
    who = (d.get("who") or "you").strip()
    lb = lobbies[lid]
    if who not in lb["members"]: raise HTTPException(400,"Вы не в этом лобби")
    lb["members"].remove(who); lb["players"]-=1
    clr = lb["taken_colors"].pop(who,None)
    if clr: lb["used_colors"].discard(clr)
    if lb["players"]<=0:
        lobbies.pop(lid,None); games.pop(lid,None)
        return {"ok":True,"deleted":True}
    if who==lb["owner"]:
        lb["owner"]=lb["members"][0]
    return {"ok":True,"owner":lb["owner"],"players":lb["players"]}

# ---------- BOARD (упрощённый набор клеток) ----------
# 40 тайлов: тип, имя, цена/рента/налог и т.д.
GO=0; PROPERTY=1; TAX=2; CHANCE=3; JAIL=4; GOTOJAIL=5; RAIL=6; UTIL=7

BOARD = [
  {"t":GO, "name":"Старт"},
  {"t":PROPERTY,"name":"Медитерр.", "cost":60,"rent":10},
  {"t":CHANCE,"name":"Шанс"},
  {"t":PROPERTY,"name":"Балтик", "cost":60,"rent":20},
  {"t":TAX,"name":"Налог", "amount":200},
  {"t":RAIL,"name":"Ж/д #1","cost":200,"rent":25},
  {"t":PROPERTY,"name":"Ориентал", "cost":100,"rent":30},
  {"t":CHANCE,"name":"Шанс"},
  {"t":PROPERTY,"name":"Вермонт", "cost":100,"rent":30},
  {"t":PROPERTY,"name":"Коннектикут","cost":120,"rent":40},

  {"t":JAIL,"name":"Тюрьма"},
  {"t":PROPERTY,"name":"Сент-Чарльз","cost":140,"rent":50},
  {"t":UTIL,"name":"Электрост.", "cost":150,"rent":40},
  {"t":PROPERTY,"name":"Стейт", "cost":140,"rent":50},
  {"t":PROPERTY,"name":"Вирджиния","cost":160,"rent":60},
  {"t":RAIL,"name":"Ж/д #2","cost":200,"rent":25},
  {"t":PROPERTY,"name":"Сент-Джеймс","cost":180,"rent":70},
  {"t":CHANCE,"name":"Шанс"},
  {"t":PROPERTY,"name":"Теннесси","cost":180,"rent":70},
  {"t":PROPERTY,"name":"Нью-Йорк","cost":200,"rent":80},

  {"t":GO,"name":"Бесплатная парковка"},
  {"t":PROPERTY,"name":"Кентукки","cost":220,"rent":90},
  {"t":CHANCE,"name":"Шанс"},
  {"t":PROPERTY,"name":"Индиана","cost":220,"rent":90},
  {"t":PROPERTY,"name":"Иллинойс","cost":240,"rent":100},
  {"t":RAIL,"name":"Ж/д #3","cost":200,"rent":25},
  {"t":PROPERTY,"name":"Атлантик","cost":260,"rent":110},
  {"t":PROPERTY,"name":"Вентнор","cost":260,"rent":110},
  {"t":UTIL,"name":"Водоканал","cost":150,"rent":40},
  {"t":PROPERTY,"name":"Марвин-гарденс","cost":280,"rent":120},

  {"t":GOTOJAIL,"name":"Отправка в тюрьму"},
  {"t":PROPERTY,"name":"Тихоокеан", "cost":300,"rent":130},
  {"t":PROPERTY,"name":"Норт-Каролина","cost":300,"rent":130},
  {"t":CHANCE,"name":"Шанс"},
  {"t":PROPERTY,"name":"Пенсильвания","cost":320,"rent":140},
  {"t":RAIL,"name":"Ж/д #4","cost":200,"rent":25},
  {"t":CHANCE,"name":"Шанс"},
  {"t":PROPERTY,"name":"Парк-Плейс","cost":350,"rent":175},
  {"t":TAX,"name":"Сверхналог","amount":100},
  {"t":PROPERTY,"name":"Бродвей","cost":400,"rent":200},
]

CHANCE_CARDS = [
    {"kind":"money","delta":+200,"text":"Вы получили дивиденды: +200"},
    {"kind":"money","delta":-100,"text":"Штраф за скорость: -100"},
    {"kind":"move","to":0,"text":"Вернитесь на Старт"},
    {"kind":"move","delta":-3,"text":"Отойдите на 3 клетки назад"},
]

def _init_game_from_lobby(lid:str, lb:dict) -> dict:
    """Создать состояние игры из состава лобби."""
    order = list(lb["members"])
    random.shuffle(order)
    players = {}
    for u in order:
        players[u] = {"name":u, "money":1500, "pos":0, "in_jail":False, "color":lb["taken_colors"][u]}
    return {
        "lobby_id": lid,
        "order": order,
        "turn": 0,
        "players": players,
        "owners": {},  # tile_index -> user
        "dice": (0,0),
        "last": "",
        "ended": False,
    }

@app.post("/api/lobbies/{lid}/start")
async def api_start(lid: str, req: Request):
    if lid not in lobbies: raise HTTPException(404,"Лобби не найдено")
    d = await req.json()
    who = (d.get("who") or "you").strip()
    lb = lobbies[lid]
    if who != lb["owner"]: raise HTTPException(403,"Только владелец может запустить")
    if lb["players"]<2: raise HTTPException(400,"Минимум 2 игрока")
    lb["started"] = True
    games[lid] = _init_game_from_lobby(lid, lb)
    return {"ok":True, "game_id": lid}

# ---------- GAME API ----------
def _current_user(g:dict) -> str:
    return g["order"][g["turn"]]

def _advance_turn(g:dict):
    g["turn"] = (g["turn"]+1) % len(g["order"])

def _move(g:dict, who:str, steps:int):
    p = g["players"][who]
    p["pos"] = (p["pos"] + steps) % len(BOARD)
    # перешли через Старт?
    if steps>0 and (p["pos"] < (p["pos"]-steps) % len(BOARD)):
        p["money"] += 200
        g["last"] += f" {who} прошёл Старт (+200)."

def _go_to(g:dict, who:str, idx:int, pay_start=True):
    p = g["players"][who]
    old = p["pos"]
    p["pos"] = idx % len(BOARD)
    if pay_start and p["pos"] < old:
        p["money"] += 200
        g["last"] += f" {who} прошёл Старт (+200)."

@app.get("/api/game/{lid}/state")
async def game_state(lid:str):
    if lid not in games: raise HTTPException(404,"Игра не найдена")
    g = games[lid]
    # лёгкая проекция
    return {
        "ok": True,
        "board": BOARD,
        "order": g["order"],
        "turn": g["turn"],
        "players": g["players"],
        "owners": g["owners"],
        "dice": g["dice"],
        "last": g["last"],
        "ended": g["ended"],
    }

@app.post("/api/game/{lid}/roll")
async def game_roll(lid:str, req: Request):
    if lid not in games: raise HTTPException(404,"Игра не найдена")
    d = await req.json()
    who = (d.get("who") or "you").strip()
    g = games[lid]
    if who != _current_user(g): raise HTTPException(400,"Сейчас ход другого игрока")

    d1 = random.randint(1,6); d2 = random.randint(1,6)
    g["dice"] = (d1,d2)
    g["last"] = f"{who} бросил {d1} + {d2}."

    _move(g, who, d1+d2)
    p = g["players"][who]
    tile = BOARD[p["pos"]]

    # обработка клетки
    if tile["t"]==PROPERTY or tile["t"]==RAIL or tile["t"]==UTIL:
        idx = p["pos"]
        if idx not in g["owners"]:
            # сообщаем, что можно покупать
            g["last"] += f" Свободно: {tile['name']} за {tile['cost']}."
            return {"ok":True, "can_buy":True, "tile_index":idx}
        else:
            owner = g["owners"][idx]
            if owner != who:
                rent = tile.get("rent",25)
                p["money"] -= rent
                g["players"][owner]["money"] += rent
                g["last"] += f" Аренда {rent} → {owner}."
    elif tile["t"]==TAX:
        p["money"] -= tile["amount"]
        g["last"] += f" Налог {tile['amount']}."
    elif tile["t"]==CHANCE:
        card = random.choice(CHANCE_CARDS)
        if card["kind"]=="money":
            p["money"] += card["delta"]
        elif card["kind"]=="move" and "to" in card:
            _go_to(g, who, card["to"])
        elif card["kind"]=="move" and "delta" in card:
            _move(g, who, card["delta"])
        g["last"] += f" Шанс: {card['text']}"
    elif tile["t"]==GOTOJAIL:
        p["in_jail"] = True
        _go_to(g, who, 10, pay_start=False)  # 10 — тюрьма
        g["last"] += " Отправлен в тюрьму."

    # завершение хода (без автоповтора дубля для простоты)
    _advance_turn(g)
    return {"ok":True}

@app.post("/api/game/{lid}/buy")
async def game_buy(lid:str, req: Request):
    if lid not in games: raise HTTPException(404,"Игра не найдена")
    d = await req.json()
    who = (d.get("who") or "you").strip()
    g = games[lid]
    p = g["players"][who]
    tile = BOARD[p["pos"]]
    idx = p["pos"]
    if tile["t"] not in (PROPERTY,RAIL,UTIL): raise HTTPException(400,"Покупать нечего")
    if idx in g["owners"]: raise HTTPException(400,"Уже куплено")
    cost = tile["cost"]
    if p["money"]<cost: raise HTTPException(400,"Не хватает денег")
    p["money"] -= cost
    g["owners"][idx] = who
    g["last"] += f" {who} купил {tile['name']} за {cost}."
    return {"ok":True}

@app.post("/api/game/{lid}/endturn")
async def end_turn(lid:str, req: Request):
    if lid not in games: raise HTTPException(404,"Игра не найдена")
    d = await req.json()
    who = (d.get("who") or "you").strip()
    g = games[lid]
    if who != _current_user(g): raise HTTPException(400,"Сейчас ход другого игрока")
    _advance_turn(g)
    return {"ok":True}
