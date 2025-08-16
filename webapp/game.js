/* webapp/game.js — минимальный прототип поля 40 клеток + ходы
   - CSS grid 11x11 с пустым центром
   - токены 5 цветов
   - анимация перемещения по маршруту из 40 координат
   - крючки для сети: fetch('/api/...'), SSE и пр.
*/

(() => {
  // ==== параметры / состояние игры ====
  const COLORS = ["red","yellow","blue","green","purple"];
  const COLOR_CLASS = {
    red: "t-red", yellow: "t-yellow", blue: "t-blue", green: "t-green", purple: "t-purple"
  };

  // (пример) состояние прилетает с сервера
  const state = {
    lobbyId: getParam("lobby") || "—",
    me: null,                // мой playerId
    current: 0,              // чей ход (index)
    players: [
      // пример двух игроков; реальные подтяни с сервера
      // { id:"u1", name:"Host", color:"red",   pos: 0, money:1500 },
      // { id:"u2", name:"Guest", color:"yellow", pos: 0, money:1500 },
    ],
    started: false
  };

  // если из backend уже есть список игроков
  // можно вытащить с window.__GAME__ или запросом /api/game/state?lobby=...
  if (window.__GAME__) Object.assign(state, window.__GAME__);

  const boardEl = document.getElementById("board");
  const roomInfo = document.getElementById("roomInfo");
  const turnInfo = document.getElementById("turnInfo");
  const rollBtn = document.getElementById("rollBtn");
  const endBtn = document.getElementById("endBtn");
  const diceLabel = document.getElementById("diceLabel");

  // ==== построение маршрута 40 клеток (по периметру) ====
  // grid 11x11 => индексы клеток по периметру (начинаем с нижнего левого угла — как классическое "Старт")
  const ringCoords = [];
  for (let x = 0; x < 11; x++) ringCoords.push([10, x]);          // нижняя строка слева->вправо
  for (let y = 9; y >= 0; y--) ringCoords.push([y, 10]);          // правая колонка вниз->вверх
  for (let x = 9; x >= 0; x--) ringCoords.push([0, x]);           // верхняя строка справа->влево
  for (let y = 1; y < 10; y++) ringCoords.push([y, 0]);           // левая колонка вверх->вниз
  // итого 40 клеток perimetr

  // ==== построим html клеток 11x11 ====
  const cells = [];
  for (let r = 0; r < 11; r++){
    for (let c = 0; c < 11; c++){
      const cell = document.createElement("div");
      const edge = r === 0 || r === 10 || c === 0 || c === 10;
      cell.className = "cell" + (edge ? " edge" : " center");
      if (edge){
        // индекс по периметру
        const idx = ringIndexOf(r, c);
        cell.dataset.idx = idx;
        if (typeof idx === "number"){
          const lab = document.createElement("div");
          lab.className = "idx";
          lab.textContent = idx;
          cell.appendChild(lab);
        }
      }
      boardEl.appendChild(cell);
      cells.push(cell);
    }
  }

  function ringIndexOf(row, col){
    // вернуть индекс 0..39 если это край поля, иначе null
    const found = ringCoords.findIndex(([rr,cc]) => rr===row && cc===col);
    return found >= 0 ? found : null;
    // (внутренним клеткам вернём null)
  }

  function getCellByIdx(idx){
    idx = ((idx % 40) + 40) % 40;
    const [r,c] = ringCoords[idx];
    return boardEl.children[r*11 + c];
  }

  // ==== тулзы ====
  function getParam(name){
    const url = new URL(location.href);
    return url.searchParams.get(name);
  }
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  // ==== фишки ====
  function renderTokens(){
    // очистить токены
    document.querySelectorAll(".token").forEach(el => el.remove());
    // прорисовать по позициям
    for (const p of state.players){
      const cell = getCellByIdx(p.pos || 0);
      const token = document.createElement("div");
      token.className = `token ${COLOR_CLASS[p.color] || "t-red"}`;
      token.dataset.pid = p.id;
      cell.appendChild(token);
    }
  }

  // ==== ход и бросок ====
  function currentPlayer(){
    return state.players[state.current % state.players.length];
  }
  function isMyTurn(){
    return state.me && currentPlayer().id === state.me;
  }

  async function onRoll(){
    if (!isMyTurn()) return;
    rollBtn.disabled = true;

    const d1 = 1 + Math.floor(Math.random()*6);
    const d2 = 1 + Math.floor(Math.random()*6);
    const steps = d1 + d2;
    diceLabel.textContent = `Выпало: ${d1} и ${d2} (сумма ${steps})`;

    await moveToken(currentPlayer(), steps);

    // TODO: здесь можно вызвать серверную обработку клетки
    // await fetch(`/api/game/land?lobby=${state.lobbyId}`, {method:"POST", body: JSON.stringify({player: state.me})})

    endBtn.disabled = false;
  }

  async function moveToken(player, steps){
    // аккуратная анимация по шагам
    for (let i=0;i<steps;i++){
      player.pos = ((player.pos||0) + 1) % 40;
      renderTokens();
      await sleep(220);
    }
  }

  function endTurn(){
    if (!isMyTurn()) return;
    endBtn.disabled = true;
    state.current = (state.current + 1) % state.players.length;
    updateTurnUI();
    rollBtn.disabled = !isMyTurn();

    // TODO: синхронизация хода
    // fetch(`/api/game/turn?lobby=${state.lobbyId}`, {method:"POST", body: JSON.stringify({current: state.current})})
  }

  function updateTurnUI(){
    const p = currentPlayer();
    turnInfo.textContent = `Ходит: ${p?.name ?? "—"}`;
  }

  // ==== старт: получить состав игроков ====
  async function bootstrap(){
    // 1) загрузим состояние (если не передали в window.__GAME__)
    if (!state.players?.length){
      try{
        const resp = await fetch(`/api/game/state?lobby=${encodeURIComponent(state.lobbyId)}`);
        if (resp.ok){
          const data = await resp.json();
          Object.assign(state, data);
        }else{
          // на крайний случай — мок на 2 игроков
          state.players = [
            { id:"me",   name:"Я",    color:"red",    pos:0, money:1500 },
            { id:"u-2",  name:"Друг", color:"yellow", pos:0, money:1500 },
          ];
          state.me = "me";
        }
      }catch(e){
        // мок если offline
        state.players = [
          { id:"me",   name:"Я",    color:"red",    pos:0, money:1500 },
          { id:"u-2",  name:"Друг", color:"yellow", pos:0, money:1500 },
        ];
        state.me = "me";
      }
    }

    // 2) UI
    roomInfo.textContent = `Комната #${state.lobbyId}`;
    renderTokens();
    updateTurnUI();
    rollBtn.disabled = !isMyTurn();
    endBtn.disabled = true;

    // 3) если есть серверные события — подключись
    setupSSE();
  }

  function setupSSE(){
    // слушаем старт/ходы/позиции с сервера (если реализовано)
    try{
      const es = new EventSource(`/events/${encodeURIComponent(state.lobbyId)}`);
      es.onmessage = (e)=>{
        const msg = JSON.parse(e.data || "{}");
        switch(msg.type){
          case "state":
            Object.assign(state, msg.payload || {});
            renderTokens(); updateTurnUI();
            break;
          case "move":
            {
              const pl = state.players.find(p => p.id === msg.player);
              if (pl){ pl.pos = msg.pos; renderTokens(); }
            }
            break;
          case "turn":
            state.current = msg.current ?? state.current;
            updateTurnUI();
            rollBtn.disabled = !isMyTurn();
            endBtn.disabled = true;
            break;
          case "started":
            // если кто-то нажал «Старт», всех перекидывает в игру —
            // мы уже в игре, можно обновить state.players из бэкенда при желании
            break;
        }
      };
    }catch(_){}
  }

  // ==== bind UI ====
  rollBtn.addEventListener("click", onRoll);
  endBtn.addEventListener("click", endTurn);

  bootstrap();
})();
