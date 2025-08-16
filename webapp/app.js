// webapp/app.js
let ROOM_ID = null;
let PLAYER_ID = null;

const $ = s => document.querySelector(s);
const elRooms = $("#rooms");
const elMenu = $("#menu");
const elLobby = $("#lobby");
const elBoard = $("#board");
const dlgCreate = $("#dlgCreate");
const dlgJoin = $("#dlgJoin");
const createForm = $("#createForm");
const joinForm = $("#joinForm");

const elPlayers = $("#players");
const elLobbyTitle = $("#lobbyTitle");
const elStart = $("#startBtn");
const elBack = $("#backToMenu");

const elTiles = $("#tiles");
const elPlist = $("#plist");
const elLog = $("#log");
const elTurn = $("#turnInfo");

const elRoll = $("#rollBtn");
const elBuy = $("#buyBtn");
const elAuctionStart = $("#auctionBtn");
const elBuild = $("#buildBtn");
const elSell = $("#sellBtn");
const elMort = $("#mortBtn");
const elUnmort = $("#unmortBtn");
const elTrade = $("#tradeBtn");
const elEnd = $("#endBtn");

// Аукцион
const elAucBox = $("#auction");
const elAucInfo = $("#aucInfo");
const elAucBid = $("#aucBid");
const elAucPass = $("#aucPass");

// Сделка
const dlgTrade = $("#dlgTrade");
const tradeForm = $("#tradeForm");
const tradeTargets = $("#tradeTargets");

async function api(path, opts){
  const r = await fetch(API + path, {headers:{'Content-Type':'application/json'}, ...opts});
  if(!r.ok){
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

// ---------- Меню ----------
async function loadRooms(){
  const list = await api("/api/rooms");
  elRooms.innerHTML = "";
  list.forEach(r=>{
    const status = r.status==="finished"? "• завершена" : r.status==="started" ? "• идёт игра" : "";
    const div = document.createElement("div");
    div.className = "room";
    div.innerHTML = `
      <div>
        <div><b>${r.name}</b> ${r.locked? "🔒":""}</div>
        <div class="meta">${r.players}/${r.max_players} ${status}</div>
      </div>
      <div class="row">
        ${r.status==="open" ? `<button data-id="${r.id}" class="joinBtn">Войти</button>` : `<button disabled>Недоступно</button>`}
      </div>`;
    elRooms.appendChild(div);
  });
  [...document.querySelectorAll(".joinBtn")].forEach(btn=>{
    btn.onclick = ()=> openJoin(btn.dataset.id);
  });
}
$("#refreshRooms").onclick = loadRooms;

$("#openCreate").onclick = async ()=>{ await dlgCreate.showModal(); };

createForm.addEventListener("close", async ()=>{
  if(dlgCreate.returnValue!=="ok") return;
  const fd = new FormData(createForm);
  try{
    const {room_id, player_id} = await api("/api/rooms", {
      method:"POST",
      body: JSON.stringify({
        name: fd.get("name"),
        password: fd.get("password") || null,
        max_players: Number(fd.get("max_players")),
        owner_name: fd.get("owner_name"),
        owner_color: fd.get("owner_color"),
      })
    });
    ROOM_ID = room_id; PLAYER_ID = player_id;
    openLobby();
  }catch(err){ alert(err.message); }
});

async function openJoin(roomId){
  ROOM_ID = roomId;
  $("#joinRoomInfo").textContent = `Комната: ${roomId}`;
  await dlgJoin.showModal();
}
joinForm.addEventListener("close", async ()=>{
  if(dlgJoin.returnValue!=="ok") return;
  const fd = new FormData(joinForm);
  try{
    const r = await api(`/api/rooms/${ROOM_ID}/join`,{
      method:"POST",
      body: JSON.stringify({
        name: fd.get("name"),
        color: fd.get("color"),
        password: fd.get("password") || null
      })
    });
    PLAYER_ID = r.player_id;
    openLobby();
  }catch(err){ alert(err.message); }
});

function show(section){
  [elMenu, elLobby, elBoard].forEach(s=>s.classList.add("hidden"));
  section.classList.remove("hidden");
}

function openLobby(){
  show(elLobby);
  elLobbyTitle.textContent = `Лобби: ${ROOM_ID}`;
  pollLobby();
}

elBack.onclick = ()=>{ show(elMenu); loadRooms(); };

elStart.onclick = async ()=>{
  try{
    await api(`/api/rooms/${ROOM_ID}/start`, {method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
    openBoard();
  }catch(e){ alert(e.message); }
};

async function pollLobby(){
  if(elLobby.classList.contains("hidden")) return;
  try{
    const st = await api(`/api/rooms/${ROOM_ID}/state`);
    renderLobby(st);
    if(st.started) { openBoard(); return; }
  }catch(e){ console.warn(e.message); }
  setTimeout(pollLobby, 1200);
}

function renderLobby(st){
  elPlayers.innerHTML = "";
  st.players.forEach(p=>{
    const b = document.createElement("span");
    b.className = "badge";
    b.innerHTML = `<span class="owner-dot" style="background:${p.color}"></span> ${p.name}`;
    elPlayers.appendChild(b);
  });
  elStart.style.display = (st.players[0] && st.players[0].id===PLAYER_ID) ? "inline-flex" : "none";
}

// ---------- Поле ----------

function openBoard(){
  show(elBoard);
  pollBoard();
}

async function pollBoard(){
  if(elBoard.classList.contains("hidden")) return;
  try{
    const st = await api(`/api/rooms/${ROOM_ID}/state`);
    renderBoard(st);
  }catch(e){ console.warn(e.message); }
  setTimeout(pollBoard, 1000);
}

function renderBoard(st){
  if(st.winner){
    const w = st.players.find(p=>p.id===st.winner);
    elTurn.textContent = w ? `Победитель: ${w.name}` : "Игра завершена";
    [elRoll, elBuy, elAuctionStart, elBuild, elSell, elMort, elUnmort, elTrade, elEnd].forEach(b=>b.disabled = true);
  }else{
    const curr = st.players.find(p=>p.id===st.turn);
    elTurn.textContent = curr ? `Ход: ${curr.name}` : '';
  }

  // плитки
  elTiles.innerHTML = "";
  st.board.forEach((t,i)=>{
    const owner = t.owner ? st.players.find(p=>p.id===t.owner) : null;
    let info = t.kind;
    if(t.kind==="property"){
      info = `${t.group||""} — ${t.mortgaged? "🔒 залог" : (t.house_level>0 ? `🏠x${t.house_level>4?'🏨':t.house_level}` : `рента ${t.base_rent}`)}`;
    }else if(t.kind==="railroad"){ info = `ж/д ${t.mortgaged?'🔒':''}`; }
    else if(t.kind==="utility"){ info = `служба ${t.mortgaged?'🔒':''}`; }
    else if(t.kind==="tax"){ info = `налог ${t.tax_amount}`; }

    const li = document.createElement("li");
    li.innerHTML = `<span class="tile-name">[${i}] ${t.name}</span>
      <span>${info}</span>
      <span>${owner ? `<i class="owner-dot" title="${owner.name}" style="background:${owner.color}"></i>` : ""}</span>`;
    elTiles.appendChild(li);
  });

  // игроки
  elPlist.innerHTML = "";
  st.players.forEach(p=>{
    const li = document.createElement("li");
    li.innerHTML = `<span><i class="owner-dot" style="background:${p.color}"></i> ${p.name} ${p.bankrupt?'(банкрот)':''} (клетка ${p.pos}) ${p.in_jail? "⛓️":""}</span>
    <b class="money">$${p.money}</b>`;
    elPlist.appendChild(li);
  });

  // лог
  elLog.innerHTML = st.log.map(x=> `<div>• ${x}</div>`).join("");

  // аукцион
  renderAuction(st);

  // кнопки (доступность)
  const me = st.players.find(p=>p.id===PLAYER_ID);
  const myTurn = !st.winner && st.turn === PLAYER_ID && !st.auction.active;
  elRoll.disabled = !myTurn;
  elEnd.disabled = !myTurn;

  let canBuy=false, canBuild=false, canSell=false, canMort=false, canUnmort=false, canAuction=false, canTrade=false;

  if(me){
    const tile = st.board[me.pos];
    if(tile){
      canBuy = myTurn && ["property","railroad","utility"].includes(tile.kind) && !tile.owner;
      canAuction = canBuy; // аукцион возможен в той же ситуации
      canBuild = myTurn && tile.kind==="property" && tile.owner===PLAYER_ID && !tile.mortgaged;
      canSell = myTurn && tile.kind==="property" && tile.owner===PLAYER_ID && tile.house_level>0;
      canMort = myTurn && ["property","railroad","utility"].includes(tile.kind) && tile.owner===PLAYER_ID && tile.house_level===0 && !tile.mortgaged;
      canUnmort = myTurn && ["property","railroad","utility"].includes(tile.kind) && tile.owner===PLAYER_ID && tile.mortgaged;
      // сделку позволяем только на клетке, которая нам принадлежит (без домов, не в залоге)
      canTrade = myTurn && tile.owner===PLAYER_ID && tile.kind!=="start" && tile.kind!=="tax" && tile.kind!=="chance" && tile.kind!=="force"
                 && tile.kind!=="jail" && tile.kind!=="gotojail" && tile.kind!=="empty" && tile.house_level===0 && !tile.mortgaged;
    }
  }
  elBuy.disabled = !canBuy;
  elAuctionStart.disabled = !canAuction;
  elBuild.disabled = !canBuild;
  elSell.disabled = !canSell;
  elMort.disabled = !canMort;
  elUnmort.disabled = !canUnmort;
  elTrade.disabled = !canTrade;

  // список таргетов для сделки
  if(canTrade){
    tradeTargets.innerHTML = "";
    st.players.filter(p=>p.id!==PLAYER_ID && !p.bankrupt).forEach(p=>{
      const opt = document.createElement("option");
      opt.value = p.id; opt.textContent = p.name;
      tradeTargets.appendChild(opt);
    });
  }

  // активная сделка (уведомления)
  if(st.trade.active){
    const meIsTarget = st.trade.target === PLAYER_ID;
    if(meIsTarget){
      elTurn.textContent = `Сделка: ${st.trade.text} — (принять/отклонить кнопками ниже)`;
    }
  }
}

function renderAuction(st){
  if(st.auction.active){
    elAucBox.classList.remove("hidden");
    const tile = st.board[st.auction.tile_idx];
    const names = st.auction.participants.map(id=>{
      const p = st.players.find(x=>x.id===id); return p ? p.name : id;
    }).join(", ");
    const bidder = st.auction.participants[st.auction.bidder_idx];
    const bidderName = (st.players.find(p=>p.id===bidder)||{}).name || "...";
    elAucInfo.innerHTML = `<b>${tile.name}</b><br>Ставка: $${st.auction.current_bid || 0} ${st.auction.current_winner?`(лидер: ${(st.players.find(p=>p.id===st.auction.current_winner)||{}).name})`:''}<br>Ходит: ${bidderName}<br><small>Участники: ${names}</small>`;
    const myTurnAuction = bidder === PLAYER_ID;
    elAucBid.disabled = !myTurnAuction;
    elAucPass.disabled = !myTurnAuction;
  }else{
    elAucBox.classList.add("hidden");
  }
}

// действия
elRoll.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/roll`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elBuy.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/buy`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elAuctionStart.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/auction/start`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elAucBid.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/auction/bid`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID, amount:10})});
}catch(e){ alert(e.message); }};

elAucPass.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/auction/pass`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elBuild.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/build`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elSell.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/sell`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elMort.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/mortgage`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elUnmort.onclick = async ()=>{ try{
  await api(`/api/rooms/${ROOM_ID}/unmortgage`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

elTrade.onclick = async ()=>{
  await dlgTrade.showModal();
};
tradeForm.addEventListener("close", async ()=>{
  if(dlgTrade.returnValue!=="ok") return;
  const fd = new FormData(tradeForm);
  try{
    await api(`/api/rooms/${ROOM_ID}/trade/propose`,{
      method:"POST",
      body: JSON.stringify({
        player_id: PLAYER_ID,
        target_id: fd.get("target"),
        money: Number(fd.get("money")||0),
        // предлагаем текущую клетку
        tile_idx: (await api(`/api/rooms/${ROOM_ID}/state`)).players.find(p=>p.id===PLAYER_ID).pos
      })
    });
  }catch(e){ alert(e.message); }
});

elEnd.onclick = async ()=>{ try{
  // если на мне висит предложение сделки — принимать/отклонять через alert/confirm
  const st = await api(`/api/rooms/${ROOM_ID}/state`);
  if(st.trade.active && st.trade.target === PLAYER_ID){
    if(confirm(`Сделка: ${st.trade.text}\n\nПринять?`)){
      await api(`/api/rooms/${ROOM_ID}/trade/accept`, {method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
    } else {
      await api(`/api/rooms/${ROOM_ID}/trade/reject`, {method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
    }
  }
  await api(`/api/rooms/${ROOM_ID}/end`,{method:"POST", body: JSON.stringify({player_id: PLAYER_ID})});
}catch(e){ alert(e.message); }};

// старт
loadRooms();
