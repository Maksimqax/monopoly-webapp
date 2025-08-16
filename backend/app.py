# backend/app.py
import random
import string
import time
from typing import Dict, List, Optional, Literal
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Monopoly WebApp — full + auction/mortgage/trade")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_headers=["*"],
    allow_methods=["*"],
)

# Раздача фронта
app.mount("/static", StaticFiles(directory="webapp"), name="static")

@app.get("/")
def index():
    from fastapi.responses import FileResponse
    return FileResponse("webapp/index.html")

# ========= базовые сущности =========

def short_id(n=6) -> str:
    import string, random
    return "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(n))

Money = int

class Player(BaseModel):
    id: str
    name: str
    color: str
    money: Money = 1500
    pos: int = 0
    in_jail: bool = False
    jail_turns: int = 0
    is_ready: bool = True
    bankrupt: bool = False

class Tile(BaseModel):
    kind: Literal[
        "start", "property", "railroad", "utility",
        "chance", "force", "tax", "jail", "gotojail", "empty"
    ]
    name: str
    price: Money = 0
    owner: Optional[str] = None
    base_rent: Money = 0
    rent_table: Optional[List[int]] = None  # для домов/отеля (0..5)
    house_cost: int = 0
    house_level: int = 0  # 0..5 (5=отель)
    group: Optional[str] = None
    tax_amount: Money = 0
    mortgaged: bool = False  # <<< ипотека

class Auction(BaseModel):
    active: bool = False
    tile_idx: Optional[int] = None
    participants: List[str] = []
    bidder_idx: int = 0
    current_bid: int = 0
    current_winner: Optional[str] = None

class Trade(BaseModel):
    active: bool = False
    proposer: Optional[str] = None
    target: Optional[str] = None
    tile_idx: Optional[int] = None
    money: int = 0  # деньги, которые платит target -> proposer
    text: str = ""

class Room(BaseModel):
    id: str
    name: str
    created_by: str
    password: Optional[str] = None
    max_players: int = 4
    created_at: float = time.time()
    started: bool = False
    winner: Optional[str] = None
    players: Dict[str, Player] = {}
    turn_order: List[str] = []
    current_turn_idx: int = 0
    board: List[Tile] = []
    log: List[str] = []
    last_roll_total: int = 0
    auction: Auction = Auction()
    trade: Trade = Trade()

ROOMS: Dict[str, Room] = {}

# ========= генерация доски (40 клеток) =========

def prop(name, group, price, house_cost, rent_table):
    return Tile(kind="property", name=name, group=group, price=price,
                base_rent=rent_table[0], rent_table=rent_table, house_cost=house_cost)

def rr(name):
    return Tile(kind="railroad", name=name, price=200)

def util(name):
    return Tile(kind="utility", name=name, price=150)

def tax(name, amt):
    return Tile(kind="tax", name=name, tax_amount=amt)

def vertical_board() -> List[Tile]:
    return [
        Tile(kind="start", name="СТАРТ"),

        prop("Mediterranean Ave", "brown", 60, 50,  [2,10,30,90,160,250]),
        Tile(kind="force", name="Форс-мажор"),
        prop("Baltic Ave", "brown", 60, 50,        [4,20,60,180,320,450]),
        tax("Подоходный налог", 200),
        rr("Reading Railroad"),

        prop("Oriental Ave", "lightblue", 100, 50, [6,30,90,270,400,550]),
        Tile(kind="chance", name="Шанс"),
        prop("Vermont Ave", "lightblue", 100, 50,  [6,30,90,270,400,550]),
        prop("Connecticut Ave", "lightblue", 120,50,[8,40,100,300,450,600]),
        Tile(kind="jail", name="Тюрьма/Визит"),

        prop("St. Charles Place","pink",140,100,   [10,50,150,450,625,750]),
        util("Electric Company"),
        prop("States Ave","pink",160,100,          [12,60,180,500,700,900]),
        prop("Virginia Ave","pink",160,100,        [12,60,180,500,700,900]),
        rr("Pennsylvania Railroad"),

        prop("St. James Place","orange",180,100,   [14,70,200,550,750,950]),
        Tile(kind="force", name="Форс-мажор"),
        prop("Tennessee Ave","orange",180,100,     [14,70,200,550,750,950]),
        prop("New York Ave","orange",200,100,      [16,80,220,600,800,1000]),
        Tile(kind="empty", name="Бесплатная стоянка"),

        prop("Kentucky Ave","red",220,150,         [18,90,250,700,875,1050]),
        Tile(kind="chance", name="Шанс"),
        prop("Indiana Ave","red",220,150,          [18,90,250,700,875,1050]),
        prop("Illinois Ave","red",240,150,         [20,100,300,750,925,1100]),
        rr("B. & O. Railroad"),

        prop("Atlantic Ave","yellow",260,150,      [22,110,330,800,975,1150]),
        prop("Ventnor Ave","yellow",260,150,       [22,110,330,800,975,1150]),
        util("Water Works"),
        prop("Marvin Gardens","yellow",280,150,    [24,120,360,850,1025,1200]),
        Tile(kind="gotojail", name="Отправиться в тюрьму"),

        prop("Pacific Ave","green",300,200,        [26,130,390,900,1100,1275]),
        prop("North Carolina Ave","green",300,200, [26,130,390,900,1100,1275]),
        Tile(kind="force", name="Форс-мажор"),
        prop("Pennsylvania Ave","green",320,200,   [28,150,450,1000,1200,1400]),
        rr("Short Line Railroad"),

        Tile(kind="chance", name="Шанс"),
        prop("Park Place","darkblue",350,200,      [35,175,500,1100,1300,1500]),
        tax("Налог на роскошь", 100),
        prop("Boardwalk","darkblue",400,200,       [50,200,600,1400,1700,2000]),
    ]

CHANCE = [
    {"text": "Отправляйтесь на СТАРТ: +200", "goto": 0, "money": +200},
    {"text": "Заплатите штраф: -100",        "money": -100},
    {"text": "Премия: +150",                 "money": +150},
    {"text": "Штраф за парковку: -50",       "money": -50},
    {"text": "Идите в тюрьму!",              "gotojail": True},
]
FORCE = [
    {"text": "Срыв поставок: -120",  "money": -120},
    {"text": "Выгодная сделка: +180","money": +180},
    {"text": "Благотворительность: -60","money": -60},
    {"text": "Кэшбэк по карте: +90", "money": +90},
]

# ========= DTO =========
class CreateRoomDTO(BaseModel):
    name: str
    password: Optional[str] = None
    max_players: int = 4
    owner_name: str
    owner_color: str

class JoinRoomDTO(BaseModel):
    name: str
    color: str
    password: Optional[str] = None

class StartRoomDTO(BaseModel):
    player_id: str

class RollDTO(BaseModel):
    player_id: str

class BuyDTO(BaseModel):
    player_id: str

class BuildDTO(BaseModel):
    player_id: str

class SellDTO(BaseModel):
    player_id: str

class EndTurnDTO(BaseModel):
    player_id: str

class MortgageDTO(BaseModel):
    player_id: str

class AuctionStartDTO(BaseModel):
    player_id: str  # тот, кто отказывается от покупки и запускает аукцион

class AuctionBidDTO(BaseModel):
    player_id: str
    amount: int  # надбавка к текущей ставке (минимум 1)

class AuctionPassDTO(BaseModel):
    player_id: str

class TradeProposeDTO(BaseModel):
    player_id: str
    target_id: str
    tile_idx: int
    money: int

class TradeDecisionDTO(BaseModel):
    player_id: str  # принимает/отклоняет (это target)

# ========= Лобби =========

@app.get("/api/rooms")
def list_rooms():
    out = []
    for r in ROOMS.values():
        status = "finished" if r.winner else ("started" if r.started else "open")
        out.append({
            "id": r.id,
            "name": r.name,
            "players": len([p for p in r.players.values() if not p.bankrupt]),
            "max_players": r.max_players,
            "locked": bool(r.password),
            "status": status,
        })
    out.sort(key=lambda x: x["id"], reverse=True)
    return out

@app.post("/api/rooms")
def create_room(dto: CreateRoomDTO):
    if not (2 <= dto.max_players <= 5):
        raise HTTPException(400, "Игроков: 2..5")
    room_id = short_id()
    owner_id = short_id()
    board = vertical_board()
    room = Room(
        id=room_id, name=dto.name[:30] or f"Комната {room_id}",
        created_by=owner_id, password=(dto.password or None),
        max_players=dto.max_players, started=False,
        players={}, turn_order=[], current_turn_idx=0,
        board=board, log=[f"Комната создана: {dto.name}"],
    )
    owner = Player(id=owner_id, name=dto.owner_name[:20], color=dto.owner_color)
    room.players[owner_id] = owner
    room.turn_order = [owner_id]
    ROOMS[room_id] = room
    return {"room_id": room_id, "player_id": owner_id}

@app.post("/api/rooms/{room_id}/join")
def join_room(room_id: str, dto: JoinRoomDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    if room.started: raise HTTPException(400, "Игра уже началась")
    alive = [p for p in room.players.values() if not p.bankrupt]
    if len(alive) >= room.max_players: raise HTTPException(400, "Комната заполнена")
    if room.password and room.password != (dto.password or ""):
        raise HTTPException(403, "Неверный пароль")
    used_colors = {p.color for p in room.players.values()}
    if dto.color in used_colors: raise HTTPException(400, "Цвет занят")
    pid = short_id()
    room.players[pid] = Player(id=pid, name=dto.name[:20], color=dto.color)
    room.turn_order.append(pid)
    room.log.append(f"{dto.name} вошёл в лобби")
    return {"player_id": pid}

@app.post("/api/rooms/{room_id}/start")
def start_room(room_id: str, dto: StartRoomDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    if room.created_by != dto.player_id: raise HTTPException(403, "Стартовать может только создатель")
    if room.started: raise HTTPException(400, "Игра уже стартовала")
    alive = [p for p in room.players.values() if not p.bankrupt]
    if len(alive) < 2: raise HTTPException(400, "Нужно минимум 2 игрока")
    room.started = True
    random.shuffle(room.turn_order)
    room.current_turn_idx = 0
    room.log.append("Игра началась")
    return {"ok": True, "order": room.turn_order}

# ========= Правила/утилиты =========

def ensure_turn(room: Room, player_id: str):
    if not room.started: raise HTTPException(400, "Игра ещё не началась")
    if room.auction.active:  # во время аукциона ходы недоступны
        raise HTTPException(400, "Сейчас идёт аукцион")
    current_id = room.turn_order[room.current_turn_idx]
    if current_id != player_id:
        raise HTTPException(400, "Сейчас ход другого игрока")

def next_turn(room: Room):
    for _ in range(len(room.turn_order)):
        room.current_turn_idx = (room.current_turn_idx + 1) % len(room.turn_order)
        p = room.players[room.turn_order[room.current_turn_idx]]
        if not p.bankrupt:
            return

def group_tiles(room: Room, group: str) -> List[int]:
    return [i for i,t in enumerate(room.board) if t.kind=="property" and t.group==group]

def owns_all_in_group(room: Room, player_id: str, group: str) -> bool:
    idxs = group_tiles(room, group)
    return all(room.board[i].owner == player_id for i in idxs)

def house_even_rule_can_build(room: Room, player_id: str, idx: int) -> bool:
    tile = room.board[idx]
    if tile.kind!="property" or tile.owner!=player_id: return False
    if tile.mortgaged: return False
    if tile.house_level >= 5: return False
    if not owns_all_in_group(room, player_id, tile.group): return False
    idxs = group_tiles(room, tile.group)
    levels = [room.board[i].house_level for i in idxs]
    min_level = min(levels)
    return tile.house_level == min_level

def house_even_rule_can_sell(room: Room, player_id: str, idx: int) -> bool:
    tile = room.board[idx]
    if tile.kind!="property" or tile.owner!=player_id: return False
    if tile.house_level <= 0: return False
    idxs = group_tiles(room, tile.group)
    levels = [room.board[i].house_level for i in idxs]
    max_level = max(levels)
    return tile.house_level == max_level

def railroads_owned(room: Room, owner: str) -> int:
    return sum(1 for t in room.board if t.kind=="railroad" and t.owner==owner)

def utilities_owned(room: Room, owner: str) -> int:
    return sum(1 for t in room.board if t.kind=="utility" and t.owner==owner)

def pay_rent(room: Room, who: Player, tile: Tile):
    owner = room.players.get(tile.owner) if tile.owner else None
    if not owner or owner.bankrupt or owner.id == who.id: return
    if tile.mortgaged: return  # заложенная — без ренты
    rent = 0
    if tile.kind=="property":
        if tile.house_level>0:
            rent = tile.rent_table[tile.house_level]
        else:
            rent = tile.base_rent
            if owns_all_in_group(room, owner.id, tile.group):
                rent *= 2
    elif tile.kind=="railroad":
        cnt = railroads_owned(room, owner.id)
        rent = [25,50,100,200][cnt-1]
    elif tile.kind=="utility":
        cnt = utilities_owned(room, owner.id)
        mult = 10 if cnt==2 else 4
        rent = mult * max(2, room.last_roll_total)
    if rent>0:
        who.money -= rent
        owner.money += rent
        room.log.append(f"{who.name} заплатил {rent} ренты игроку {owner.name}")

def check_bankrupt_and_winner(room: Room):
    changed = False
    for pid,p in list(room.players.items()):
        if not p.bankrupt and p.money < 0:
            p.bankrupt = True
            room.log.append(f"{p.name} обанкротился.")
            for t in room.board:
                if t.owner == pid:
                    t.owner = None
                    t.house_level = 0
                    t.mortgaged = False
            # убрать из аукциона/сделки
            if room.auction.active and pid in room.auction.participants:
                room.auction.participants = [x for x in room.auction.participants if x!=pid]
            if room.trade.active and (room.trade.proposer==pid or room.trade.target==pid):
                room.trade = Trade()
            changed = True
    if changed:
        alive = [p for p in room.players.values() if not p.bankrupt]
        if len(alive) == 1:
            room.started = False
            room.winner = alive[0].id
            room.log.append(f"Победитель: {alive[0].name}")

# ========= Состояние =========

@app.get("/api/rooms/{room_id}/state")
def room_state(room_id: str):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    return {
        "id": room.id,
        "name": room.name,
        "started": room.started,
        "winner": room.winner,
        "players": [room.players[pid] for pid in room.turn_order],
        "turn": room.turn_order[room.current_turn_idx] if room.started else None,
        "board": [t.dict() for t in room.board],
        "log": room.log[-60:],
        "auction": room.auction.dict(),
        "trade": room.trade.dict(),
    }

# ========= Игровой цикл =========

@app.post("/api/rooms/{room_id}/roll")
def roll_dice(room_id: str, dto: RollDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    p = room.players[dto.player_id]
    if p.bankrupt: raise HTTPException(400, "Игрок банкрот")

    if p.in_jail:
        d1, d2 = random.randint(1,6), random.randint(1,6)
        room.last_roll_total = d1+d2
        if d1==d2:
            p.in_jail=False; p.jail_turns=0
            room.log.append(f"{p.name} выбросил дубль {d1}+{d2} и вышел из тюрьмы")
        else:
            p.jail_turns += 1
            room.log.append(f"{p.name} в тюрьме: {d1}+{d2}. Пропуск (ходов: {p.jail_turns})")
            if p.jail_turns >= 3:
                p.in_jail=False; p.jail_turns=0; p.money -= 50
                room.log.append(f"{p.name} заплатил 50 и вышел из тюрьмы")
        next_turn(room); check_bankrupt_and_winner(room)
        return {"dice": (d1,d2), "pos": p.pos, "money": p.money}

    d1, d2 = random.randint(1,6), random.randint(1,6)
    steps = d1+d2
    room.last_roll_total = steps
    start_pos = p.pos
    p.pos = (p.pos + steps) % len(room.board)
    room.log.append(f"{p.name} бросил {d1}+{d2} и перешёл с {start_pos} на {p.pos}")

    if p.pos < start_pos:
        p.money += 200
        room.log.append(f"{p.name} прошёл СТАРТ: +200")

    tile = room.board[p.pos]

    if tile.kind in ("property","railroad","utility"):
        if tile.owner and tile.owner != p.id:
            pay_rent(room, p, tile)
    elif tile.kind == "chance":
        card = random.choice(CHANCE)
        if card.get("goto") is not None:
            p.pos = card["goto"]
        if card.get("gotojail"):
            p.in_jail = True
            p.pos = 10
        p.money += card.get("money", 0)
        room.log.append(f"Шанс: {p.name}: {card['text']}")
    elif tile.kind == "force":
        card = random.choice(FORCE)
        p.money += card.get("money", 0)
        room.log.append(f"Форс-мажор: {p.name}: {card['text']}")
    elif tile.kind == "tax":
        p.money -= tile.tax_amount
        room.log.append(f"{p.name} заплатил налог {tile.tax_amount}")
    elif tile.kind == "gotojail":
        p.in_jail = True
        p.pos = 10
        room.log.append(f"{p.name} отправился в тюрьму!")

    check_bankrupt_and_winner(room)
    return {"dice": (d1,d2), "pos": p.pos, "money": p.money}

@app.post("/api/rooms/{room_id}/buy")
def buy(room_id: str, dto: BuyDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    p = room.players[dto.player_id]
    tile = room.board[p.pos]
    if tile.kind not in ("property","railroad","utility"):
        raise HTTPException(400, "Покупать можно только имущество")
    if tile.owner: raise HTTPException(400, "Имущество уже куплено")
    if p.money < tile.price: raise HTTPException(400, "Недостаточно денег")
    tile.owner = p.id
    p.money -= tile.price
    room.log.append(f"{p.name} купил {tile.name} за {tile.price}")
    return {"ok": True, "money": p.money, "owner": p.id}

@app.post("/api/rooms/{room_id}/build")
def build(room_id: str, dto: BuildDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    p = room.players[dto.player_id]
    tile = room.board[p.pos]
    if tile.kind!="property": raise HTTPException(400, "Строить можно только на недвижимости")
    if tile.owner!=p.id: raise HTTPException(400, "Это не ваша клетка")
    if tile.mortgaged: raise HTTPException(400, "Клетка в залоге")
    if not house_even_rule_can_build(room, p.id, p.pos): raise HTTPException(400, "Стройте равномерно по группе")
    if p.money < tile.house_cost: raise HTTPException(400, "Недостаточно денег")
    tile.house_level += 1
    p.money -= tile.house_cost
    room.log.append(f"{p.name} построил дом на {tile.name} (уровень {tile.house_level})")
    return {"ok": True, "house_level": tile.house_level, "money": p.money}

@app.post("/api/rooms/{room_id}/sell")
def sell(room_id: str, dto: SellDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    p = room.players[dto.player_id]
    tile = room.board[p.pos]
    if tile.kind!="property": raise HTTPException(400, "Продавать можно только дома на недвижимости")
    if tile.owner!=p.id: raise HTTPException(400, "Это не ваша клетка")
    if not house_even_rule_can_sell(room, p.id, p.pos): raise HTTPException(400, "Продавайте равномерно по группе")
    if tile.house_level<=0: raise HTTPException(400, "Домов нет")
    tile.house_level -= 1
    refund = tile.house_cost // 2
    p.money += refund
    room.log.append(f"{p.name} продал дом на {tile.name} (+{refund}) (уровень {tile.house_level})")
    return {"ok": True, "house_level": tile.house_level, "money": p.money}

@app.post("/api/rooms/{room_id}/end")
def end_turn(room_id: str, dto: EndTurnDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    next_turn(room)
    check_bankrupt_and_winner(room)
    return {"ok": True}

# ========= Ипотека =========

@app.post("/api/rooms/{room_id}/mortgage")
def mortgage(room_id: str, dto: MortgageDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    p = room.players[dto.player_id]
    tile = room.board[p.pos]
    if tile.owner != p.id: raise HTTPException(400, "Это не ваша клетка")
    if tile.kind not in ("property","railroad","utility"): raise HTTPException(400, "Нельзя заложить")
    if tile.house_level>0: raise HTTPException(400, "Сначала продайте дома")
    if tile.mortgaged: raise HTTPException(400, "Уже в залоге")
    tile.mortgaged = True
    gain = tile.price//2
    p.money += gain
    room.log.append(f"{p.name} заложил {tile.name} (+{gain})")
    return {"ok": True, "money": p.money, "mortgaged": True}

@app.post("/api/rooms/{room_id}/unmortgage")
def unmortgage(room_id: str, dto: MortgageDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    p = room.players[dto.player_id]
    tile = room.board[p.pos]
    if tile.owner != p.id: raise HTTPException(400, "Это не ваша клетка")
    if tile.kind not in ("property","railroad","utility"): raise HTTPException(400, "Нельзя выкупить")
    if not tile.mortgaged: raise HTTPException(400, "Клетка не в залоге")
    cost = int(round(tile.price * 0.55))
    if p.money < cost: raise HTTPException(400, "Недостаточно денег")
    p.money -= cost
    tile.mortgaged = False
    room.log.append(f"{p.name} выкупил {tile.name} (-{cost})")
    return {"ok": True, "money": p.money, "mortgaged": False}

# ========= Аукцион =========

def ensure_no_active_auction(room: Room):
    if room.auction.active:
        raise HTTPException(400, "Аукцион уже идёт")

@app.post("/api/rooms/{room_id}/auction/start")
def auction_start(room_id: str, dto: AuctionStartDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    ensure_turn(room, dto.player_id)
    ensure_no_active_auction(room)
    p = room.players[dto.player_id]
    tile = room.board[p.pos]
    if tile.kind not in ("property","railroad","utility") or tile.owner:
        raise HTTPException(400, "Аукцион возможен только для свободной клетки")
    # участники — все живые игроки
    participants = [pid for pid in room.turn_order if not room.players[pid].bankrupt]
    room.auction = Auction(active=True, tile_idx=p.pos, participants=participants,
                           bidder_idx=0, current_bid=0, current_winner=None)
    room.log.append(f"Аукцион: {tile.name}. Участвуют: " +
                    ", ".join(room.players[x].name for x in participants))
    return {"ok": True, "auction": room.auction.dict()}

def rotate_bidder(room: Room):
    if not room.auction.participants:
        return
    room.auction.bidder_idx %= len(room.auction.participants)

def advance_bidder(room: Room):
    if not room.auction.participants:
        return
    room.auction.bidder_idx = (room.auction.bidder_idx + 1) % len(room.auction.participants)

def finish_auction(room: Room):
    a = room.auction
    tile = room.board[a.tile_idx]
    if a.current_winner and a.current_bid>0:
        winner = room.players[a.current_winner]
        if winner.money < a.current_bid:
            room.log.append(f"Аукцион сорвался: у {winner.name} не хватило денег")
        else:
            winner.money -= a.current_bid
            tile.owner = winner.id
            room.log.append(f"Аукцион: {winner.name} купил {tile.name} за {a.current_bid}")
    else:
        room.log.append("Аукцион завершён без продажи")
    room.auction = Auction()  # сброс

def check_auction_resolve(room: Room):
    a = room.auction
    if not a.active: return
    if len(a.participants) == 0:
        room.log.append("Аукцион: нет участников")
        room.auction = Auction()
    elif len(a.participants) == 1 and a.current_winner == a.participants[0]:
        finish_auction(room)

@app.post("/api/rooms/{room_id}/auction/bid")
def auction_bid(room_id: str, dto: AuctionBidDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    if not room.auction.active: raise HTTPException(400, "Аукцион не идёт")
    a = room.auction
    bidder = a.participants[a.bidder_idx]
    if bidder != dto.player_id:
        raise HTTPException(400, "Сейчас ход другого участника аукциона")
    if dto.amount <= 0:
        raise HTTPException(400, "Ставка должна быть положительной")
    new_bid = a.current_bid + dto.amount
    player = room.players[dto.player_id]
    if player.money < new_bid:
        raise HTTPException(400, "Недостаточно денег для такой ставки")
    a.current_bid = new_bid
    a.current_winner = dto.player_id
    room.log.append(f"Ставка: {player.name} → {new_bid}")
    advance_bidder(room)
    check_auction_resolve(room)
    return {"ok": True, "auction": a.dict()}

@app.post("/api/rooms/{room_id}/auction/pass")
def auction_pass(room_id: str, dto: AuctionPassDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    if not room.auction.active: raise HTTPException(400, "Аукцион не идёт")
    a = room.auction
    bidder = a.participants[a.bidder_idx]
    if bidder != dto.player_id:
        raise HTTPException(400, "Сейчас ход другого участника аукциона")
    name = room.players[dto.player_id].name
    a.participants = [x for x in a.participants if x != dto.player_id]
    room.log.append(f"Аукцион: {name} пас")
    if not a.participants:
        room.auction = Auction()
        room.log.append("Аукцион отменён — никто не участвует")
        return {"ok": True, "auction": room.auction.dict()}
    a.bidder_idx %= len(a.participants)
    # если остался один участник и именно он — текущий победитель, финалим
    if len(a.participants) == 1 and a.current_winner == a.participants[0]:
        finish_auction(room)
        return {"ok": True, "auction": room.auction.dict()}
    return {"ok": True, "auction": a.dict()}

# ========= Сделка =========

@app.post("/api/rooms/{room_id}/trade/propose")
def trade_propose(room_id: str, dto: TradeProposeDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    if room.trade.active: raise HTTPException(400, "Уже есть активная сделка")
    ensure_turn(room, dto.player_id)
    if dto.target_id not in room.players: raise HTTPException(404, "Целевой игрок не найден")
    if dto.player_id == dto.target_id: raise HTTPException(400, "Сделка с самим собой не нужна")
    t = room.board[dto.tile_idx]
    if t.owner != dto.player_id: raise HTTPException(400, "Эта клетка вам не принадлежит")
    if t.kind not in ("property","railroad","utility"): raise HTTPException(400, "Эту клетку нельзя передать")
    if t.house_level>0: raise HTTPException(400, "Сначала продайте дома")
    if t.mortgaged: raise HTTPException(400, "Клетка в залоге")
    if dto.money < 0: raise HTTPException(400, "Сумма должна быть неотрицательной")
    room.trade = Trade(
        active=True, proposer=dto.player_id, target=dto.target_id,
        tile_idx=dto.tile_idx, money=int(dto.money),
        text=f"{room.players[dto.player_id].name} предлагает {t.name} за {dto.money} игроку {room.players[dto.target_id].name}"
    )
    room.log.append("Сделка: " + room.trade.text)
    return {"ok": True, "trade": room.trade.dict()}

@app.post("/api/rooms/{room_id}/trade/accept")
def trade_accept(room_id: str, dto: TradeDecisionDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    tr = room.trade
    if not tr.active: raise HTTPException(400, "Нет активной сделки")
    if tr.target != dto.player_id: raise HTTPException(400, "Подтверждать должен целевой игрок")
    buyer = room.players[tr.target]
    seller = room.players[tr.proposer]
    t = room.board[tr.tile_idx]
    if t.owner != seller.id:  # что-то изменилось
        room.trade = Trade()
        raise HTTPException(400, "Сделка устарела")
    if buyer.money < tr.money:
        raise HTTPException(400, "Недостаточно денег")
    buyer.money -= tr.money
    seller.money += tr.money
    t.owner = buyer.id
    room.log.append(f"Сделка: {buyer.name} купил {t.name} у {seller.name} за {tr.money}")
    room.trade = Trade()
    return {"ok": True}

@app.post("/api/rooms/{room_id}/trade/reject")
def trade_reject(room_id: str, dto: TradeDecisionDTO):
    room = ROOMS.get(room_id)
    if not room: raise HTTPException(404, "Комната не найдена")
    tr = room.trade
    if not tr.active: raise HTTPException(400, "Нет активной сделки")
    if tr.target != dto.player_id: raise HTTPException(400, "Отклонять должен целевой игрок")
    room.log.append("Сделка отклонена")
    room.trade = Trade()
    return {"ok": True}
