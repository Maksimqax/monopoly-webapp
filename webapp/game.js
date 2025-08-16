/* game.js — вертикальное поле (11x11), 40 клеток по периметру.
   Без сервера работает локально (можно бросать и ходить).
   С сервером — оставлены места для fetch/SSE.
*/

(() => {
  // ---------- helpers ----------
  const qs =(s,root=document)=>root.querySelector(s);
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const getParam = k => new URL(location.href).searchParams.get(k);

  const COLORS = ["red","yellow","blue","green","purple"];
  const COLORS_CLASS = {
    red:"t-red", yellow:"t-yellow", blue:"t-blue", green:"t-green", purple:"t-purple"
  };

  // ---------- DOM ----------
  const boardEl   = qs('#board');
  const diceLabel = qs('#diceLabel');
  const rollBtn   = qs('#rollBtn');
  const endBtn    = qs('#endBtn');
  const roomInfo  = qs('#roomInfo');
  const turnInfo  = qs('#turnInfo');

  // ---------- state (если сервер не дал — поднимем локальный режим) ----------
  const state = {
    lobbyId: getParam('lobby') || '—',
    me: null,                 // id игрока
    current: 0,               // индекс, чей ход
    players: [],              // [{id,name,color,pos,money}]
    started: true
  };

  // если бэкенд положил стартовое состояние (через шаблон) — подтянем
  if (window.__GAME__) Object.assign(state, window.__GAME__);

  // если всё ещё пусто — локальный режим на двоих
  if (!state.players?.length) {
    state.players = [
      { id: 'me',   name:'Я',    color:'red',    pos:0, money:1500 },
      { id: 'u2',   name:'Друг', color:'yellow', pos:0, money:1500 }
    ];
    state.me = 'me';
  }
  // если сервер не сказал, кто я — пусть я буду первым
  if (!state.me) state.me = state.players[0]?.id;

  // ---------- строим периметр 40 клеток ----------
  const ring = [];
  for (let x=0;x<11;x++) ring.push([10,x]);     // низ слева->вправо
  for (let y=9; y>=0; y--) ring.push([y,10]);    // право вниз->вверх
  for (let x=9; x>=0; x--) ring.push([0,x]);     // верх право->лево
  for (let y=1; y<10; y++) ring.push([y,0]);     // лево вверх->вниз

  const ringIndex = (r,c)=> ring.findIndex(([rr,cc])=> rr===r && cc===c);
  const getCell   = (idx) => {
    idx = ((idx%40)+40)%40;
    const [r,c] = ring[idx];
    return boardEl.children[r*11 + c];
  };

  // ---------- отрисуем сетку 11×11 ----------
  for (let r=0;r<11;r++){
    for (let c=0;c<11;c++){
      const cell = document.createElement('div');
      const edge = r===0 || r===10 || c===0 || c===10;
      cell.className = 'cell ' + (edge?'edge':'center');
      if (edge){
        const idx = ringIndex(r,c);
        if (idx>=0){
          const d=document.createElement('div');
          d.className='idx'; d.textContent=idx;
          cell.appendChild(d);
          cell.dataset.idx = idx;
        }
      }
      boardEl.appendChild(cell);
    }
  }

  // ---------- токены ----------
  function renderTokens(){
    boardEl.querySelectorAll('.token').forEach(n=>n.remove());
    for (const p of state.players){
      const el = getCell(p.pos||0);
      const t  = document.createElement('div');
      t.className = 'token ' + (COLORS_CLASS[p.color] || 't-red');
      t.dataset.pid = p.id;
      el.appendChild(t);
    }
  }

  // ---------- ход ----------
  const playerById   = id => state.players.find(p=>p.id===id);
  const currentPlayer= ()=> state.players[state.current % state.players.length];
  const isMyTurn     = ()=> currentPlayer()?.id === state.me;

  async function move(player, steps){
    for (let i=0;i<steps;i++){
      player.pos = ((player.pos||0) + 1) % 40;
      renderTokens();
      await sleep(200);
    }
  }

  async function onRoll(){
    // разрешим бросать в локальном режиме даже если сервер не сказал, что мой ход
    if (!isMyTurn() && state.players.length>1) return;

    rollBtn.disabled = true;

    // серверный вариант:
    // const r = await fetch(`/api/game/roll?lobby=${state.lobbyId}`, {method:'POST'});
    // const {d1,d2} = await r.json();

    const d1 = 1 + Math.floor(Math.random()*6);
    const d2 = 1 + Math.floor(Math.random()*6);
    diceLabel.textContent = `Выпало: ${d1} и ${d2} (сумма ${d1+d2})`;

    await move(currentPlayer(), d1+d2);

    // здесь можно дернуть обработку клетки на сервере
    // await fetch(`/api/game/land?lobby=${state.lobbyId}`, {method:'POST', body: JSON.stringify({player: state.me})});

    endBtn.disabled = false;
  }

  function onEndTurn(){
    if (!isMyTurn() && state.players.length>1) return;
    endBtn.disabled = true;
    state.current = (state.current + 1) % state.players.length;

    // сервер: сообщить о смене хода
    // fetch(`/api/game/turn?lobby=${state.lobbyId}`, {method:'POST', body: JSON.stringify({current: state.current})});

    updateTurnUI();
    rollBtn.disabled = !isMyTurn();
  }

  function updateTurnUI(){
    roomInfo.textContent = `Комната #${state.lobbyId}`;
    const p = currentPlayer();
    turnInfo.textContent = `Ходит: ${p?.name ?? '—'}`;
  }

  // ---------- SSE (если сделано на бэкенде) ----------
  function setupSSE(){
    try{
      const es = new EventSource(`/events/${encodeURIComponent(state.lobbyId)}`);
      es.onmessage = e => {
        const msg = JSON.parse(e.data||'{}');
        switch(msg.type){
          case 'state':
            Object.assign(state, msg.payload||{});
            renderTokens(); updateTurnUI();
            rollBtn.disabled = !isMyTurn();
            endBtn.disabled  = true;
            break;
          case 'move': {
            const p = playerById(msg.player);
            if (p){ p.pos = msg.pos; renderTokens(); }
            break;
          }
          case 'turn':
            state.current = msg.current ?? state.current;
            updateTurnUI();
            rollBtn.disabled = !isMyTurn();
            endBtn.disabled  = true;
            break;
          case 'started':
            // при старте из лобби — сюда уже пришли; оставляем на случай повторного входа
            break;
        }
      };
    }catch(e){}
  }

  // ---------- старт ----------
  function bootstrap(){
    renderTokens();
    updateTurnUI();
    // локальный режим: ходить можно сразу
    rollBtn.disabled = false;
    endBtn.disabled  = true;

    setupSSE();
  }

  // ---------- bind ----------
  rollBtn.addEventListener('click', onRoll);
  endBtn.addEventListener('click', onEndTurn);

  bootstrap();
})();
