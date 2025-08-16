// === ПАРАМЕТРЫ И ВСПОМОГАТЕЛЬНЫЕ ===
const qs = new URLSearchParams(location.search);
const LOBBY = qs.get('lobby') || '';   // ?lobby=XXXX
const API = {
  state: (l) => `/api/lobby/state?lobby=${encodeURIComponent(l)}`, // GET
  roll:  `/api/lobby/roll`,                                        // POST {lobby}
  end:   `/api/lobby/endturn`,                                     // POST {lobby}
  sse:   (l) => `/api/events?lobby=${encodeURIComponent(l)}`,      // GET (SSE)
};

const COLORS = {
  red:    '#ff3b30',
  blue:   '#2aa8ff',
  green:  '#34c759',
  yellow: '#ffd60a',
  purple: '#a970ff',
  cyan:   '#22d3ee',
};

// === СЕЛЕКТОРЫ ===
const $canvas = document.getElementById('board');
const $log    = document.getElementById('log');
const $room   = document.getElementById('room');
const $turn   = document.getElementById('turnNick');
const $btnRoll= document.getElementById('btnRoll');
const $btnEnd = document.getElementById('btnEnd');

const ctx = $canvas.getContext('2d', { alpha: false });

// === СОСТОЯНИЕ КЛИЕНТА ===
let state = {
  lobby: LOBBY,
  me: null,              // my user id (с бэка)
  players: [],           // [{id,nick,color,pos,cash,...}]
  turn: null,            // id игрока чей ход
  board: [],             // 40 клеток: [{name,type,price,rent,colorGroup}]
  dice: [0,0],
};

// === УТИЛИТЫ ===
const log = (txt) => {
  const el = document.createElement('div');
  el.textContent = txt;
  $log.prepend(el);
};

const POST = async (url, data) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// === ИНИЦИАЛИЗАЦИЯ ===
async function bootstrap() {
  if (!LOBBY) {
    alert('Нет параметра ?lobby=...');
    return;
  }
  $room.textContent = `Комната — ${LOBBY}`;

  // первичная загрузка
  await loadState();

  // подписка на события
  bindSSE();

  // кнопки
  $btnRoll.onclick = onRoll;
  $btnEnd.onclick  = onEnd;

  draw();
}

async function loadState() {
  const r = await fetch(API.state(LOBBY));
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(txt);
  }
  const json = await r.json();
  // ожидаемый формат:
  // { me, turn, players:[{id,nick,color,pos}], board:[...], dice:[d1,d2] }
  state = { ...state, ...json };
  updateHeader();
  draw();
}

function updateHeader() {
  const p = state.players.find(x => x.id === state.turn);
  $turn.textContent = p ? p.nick : '—';
}

// === ОБРАБОТКА КНОПОК ===
async function onRoll() {
  try {
    disableUI(true);
    const data = await POST(API.roll, { lobby: LOBBY });
    // {d1,d2,player,newPos}
    state.dice = [data.d1, data.d2];
    const pl = state.players.find(p => p.id === data.player);
    if (pl) pl.pos = data.newPos;
    log(`🎲 Бросок: ${data.d1} и ${data.d2} → ${pl?.nick || 'игрок'} на ${data.newPos}`);
    draw(true);
  } catch (e) {
    console.error(e);
    alert('Ошибка броска: ' + e.message);
  } finally {
    disableUI(false);
  }
}

async function onEnd() {
  try {
    disableUI(true);
    await POST(API.end, { lobby: LOBBY });
    // сервер разошлёт событие turn/state, мы их поймаем в SSE
  } catch (e) {
    console.error(e);
    alert('Ошибка завершения хода: ' + e.message);
  } finally {
    disableUI(false);
  }
}

function disableUI(v) {
  const myTurn = state.turn === state.me;
  $btnRoll.disabled = v || !myTurn;
  $btnEnd.disabled  = v || !myTurn;
}

// === SSE ===
function bindSSE() {
  try {
    const es = new EventSource(API.sse(LOBBY), { withCredentials:false });
    es.onmessage = (ev) => {
      if (!ev.data) return;
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'state':
          state = { ...state, ...msg.payload };
          updateHeader();
          draw();
          break;
        case 'move': {
          const { player, to, d1, d2 } = msg;
          const pl = state.players.find(p => p.id === player);
          if (pl) pl.pos = to;
          state.dice = [d1, d2];
          draw(true);
          log(`➡️ ${pl?.nick || 'Игрок'} перешёл на ${to} (кубики: ${d1}+${d2})`);
          break;
        }
        case 'turn':
          state.turn = msg.player;
          updateHeader();
          disableUI(false);
          break;
        case 'chat':
          log(`💬 ${msg.nick}: ${msg.text}`);
          break;
        case 'started':
          // защищаемся — если кто-то попал сюда из лобби
          break;
      }
    };
    es.onerror = () => {
      // обычно Render free instance “засыпает”; просто переподключимся через секунду
      setTimeout(() => bindSSE(), 1200);
    };
  } catch (e) {
    console.error(e);
  }
}

// === РИСОВАНИЕ ПОЛЯ ===

/**
 * Поле: 40 клеток по периметру.
 * Координатная сетка: 11x11 (0..10), четыре угла — (0,0), (10,0), (10,10), (0,10).
 * «Внутренность» пустая — только для красоты.
 */
function cellXY(idx) {
  // idx 0..39, по часовой стрелке, 0 — нижний левый угол (старт)
  // Раскладка:
  // 0..10 справа -> по нижнему краю
  // 10..20 вверх  -> по правому краю
  // 20..30 влево  -> по верхнему краю
  // 30..40 вниз   -> по левому краю
  // Возвращаем (col,row) из диапазона 0..10
  if (idx < 10) return [10 - idx, 10];
  if (idx === 10) return [0, 10];
  if (idx < 20) return [0, 20 - idx];
  if (idx === 20) return [0, 0];
  if (idx < 30) return [idx - 20, 0];
  if (idx === 30) return [10, 0];
  // 30..39
  return [10, idx - 30];
}

function draw(animateMove=false) {
  const W = $canvas.width;
  const H = $canvas.height;
  ctx.clearRect(0,0,W,H);

  // фон
  ctx.fillStyle = '#0e1621';
  ctx.fillRect(0,0,W,H);

  // поле-сетка
  const CELLS = 11;
  const s = W / CELLS;

  // тонкая рамка
  ctx.strokeStyle = '#1f2a39';
  ctx.lineWidth = 2;
  ctx.strokeRect(2,2,W-4,H-4);

  // подсветим «дорожку» периметра
  ctx.fillStyle = '#0b2035';
  ctx.fillRect(s, s, W-2*s, H-2*s); // внутренний квадрат
  // сверху прозрачный прямоугольник — визуальный «стол»
  ctx.fillStyle = '#0b1320';
  ctx.fillRect(s*2, s*2, W-4*s, H-4*s);

  // клетки (только периметр)
  ctx.lineWidth = 1.5;
  for (let i=0;i<40;i++){
    const [c,r] = cellXY(i);
    const x = c*s, y = r*s;
    ctx.strokeStyle = '#213049';
    ctx.strokeRect(x,y,s,s);

    // номера клеток для теста
    ctx.fillStyle = '#6b86a2';
    ctx.font = `${Math.floor(s*0.27)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i), x + s/2, y + s/2);
  }

  // бросок
  if (state.dice?.length===2 && (state.dice[0] || state.dice[1])) {
    const txt = `🎲 ${state.dice[0]} + ${state.dice[1]}`;
    ctx.fillStyle = '#9ec6ff';
    ctx.font = `${Math.floor(s*0.35)}px system-ui`;
    ctx.textAlign = 'left';
    ctx.fillText(txt, s*1.4, s*1.2);
  }

  // фишки
  drawTokens(s, animateMove);
  disableUI(false);
}

function drawTokens(s, animate=false) {
  // В каждой клетке можем рисовать несколько кружков-фишек
  const R = Math.max(8, Math.floor(s*0.22));

  // сгруппируем по позиции
  const groups = new Map();
  for (const p of state.players) {
    const arr = groups.get(p.pos) || [];
    arr.push(p);
    groups.set(p.pos, arr);
  }

  for (const [pos, arr] of groups) {
    const [c,r] = cellXY(pos);
    const x0 = c*s + s/2;
    const y0 = r*s + s/2;

    // круговая раскладка, если фишек > 1
    const n = arr.length;
    for (let i=0;i<n;i++){
      const a = (i / n) * Math.PI*2;
      const rad = n>1 ? Math.min( R*1.6, s*0.28 ) : 0;
      const x = x0 + Math.cos(a)*rad;
      const y = y0 + Math.sin(a)*rad;

      ctx.beginPath();
      ctx.fillStyle = COLORS[arr[i].color] || '#fff';
      ctx.arc(x, y, R, 0, Math.PI*2);
      ctx.fill();

      // маленькая белая точка для объёма
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.arc(x - R*0.4, y - R*0.4, Math.max(2, R*0.18), 0, Math.PI*2);
      ctx.fill();
    }
  }
}

// === СТАРТ ===
bootstrap().catch(e => {
  console.error(e);
  alert('Не удалось загрузить игру: ' + e.message);
});
