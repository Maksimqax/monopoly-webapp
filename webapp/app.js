// ------- базовые утилиты -------
const API = {
  get: (url) => fetch(url, {headers: hdr()}).then(js),
  post: (url, data) =>
    fetch(url, {
      method: "POST",
      headers: {...hdr(), "Content-Type": "application/json"},
      body: JSON.stringify(data || {})
    }).then(js)
};

function js(r) { if (!r.ok) return r.json().then(e=>{throw e}); return r.json(); }
function uuid() {
  let u = localStorage.getItem("uid");
  if (!u) { u = crypto.randomUUID?.() || (Date.now()+"-"+Math.random()); localStorage.setItem("uid", u); }
  return u;
}
function hdr(){ return {"X-UID": uuid()}; }
function el(id){ return document.getElementById(id); }
function q(sel, root=document){ return root.querySelector(sel); }
function ce(tag, props={}){ const n = document.createElement(tag); Object.assign(n, props); return n; }

const COLORS = ["red","blue","green","yellow","purple"];
const COLOR_NAMES = { red:"Красный", blue:"Синий", green:"Зелёный", yellow:"Жёлтый", purple:"Фиолетовый" };

let lastName = localStorage.getItem("player_name") || "";
let activeSub = null;   // EventSource подписка на текущее лобби (если мы в нём)

// ------- отрисовка списка -------
const $list = el("list");
const $search = el("search");

el("btnRefresh").onclick = load;
el("btnCreate").onclick = () => showCreate(true);

function showCreate(open){
  el("c_player").value = lastName;
  el("dlgCreate").classList.toggle("hidden", !open);
}
el("c_cancel").onclick = () => showCreate(false);

el("c_ok").onclick = async () => {
  try{
    lastName = el("c_player").value.trim() || "Игрок";
    localStorage.setItem("player_name", lastName);
    const body = {
      name: el("c_name").value.trim() || "Лобби",
      max_players: +el("c_max").value,
      private: el("c_private").checked,
      password: el("c_password").value || null,
      color: el("c_color").value,
      player_name: lastName
    };
    const r = await API.post("/api/lobby/create", body);
    showCreate(false);
    await load(); // обновим список
    subscribeIfMember(r.lobby); // сразу подписка для автоперехода при старте
  }catch(e){ alert(e.detail || "Ошибка создания"); }
};

// join-dialog
const $dlgJoin = el("dlgJoin");
const $jName = el("j_name");
const $jPlayer = el("j_player");
const $jColor = el("j_color");
const $jPassRow = el("j_pass_row");
const $jPassword = el("j_password");

let joinLobbyId = null;
el("j_cancel").onclick = () => ($dlgJoin.classList.add("hidden"), joinLobbyId=null);
el("j_ok").onclick = async ()=>{
  if (!joinLobbyId) return;
  try{
    lastName = $jPlayer.value.trim() || "Игрок";
    localStorage.setItem("player_name", lastName);
    const body = {
      lobby: joinLobbyId,
      password: $jPassRow.classList.contains("hidden") ? null : ($jPassword.value || null),
      color: $jColor.value,
      player_name: lastName
    };
    const r = await API.post("/api/lobby/join", body);
    $dlgJoin.classList.add("hidden");
    joinLobbyId = null;
    await load();
    subscribeIfMember(r.lobby);
  }catch(e){ alert(e.detail || "Не удалось войти"); }
};

async function load(){
  const data = await API.get("/api/lobbies");
  const term = $search.value.trim().toLowerCase();

  $list.innerHTML = "";
  for (const l of data.items){
    if (term && !l.name.toLowerCase().includes(term)) continue;

    const taken = l.players.map(p=>p.color);
    const me = l.players.find(p=>p.uid === uuid());
    const owner = l.players.find(p=>p.owner);

    const line = ce("div", {className:"card lobby-line"});
    const left = ce("div", {className:"left"});
    left.append(
      ce("div", {className:"title", innerText: l.name}),
      ce("div", {className:"muted", innerText: `#${l.id}`}),
      ce("div", {className:"pill", innerText: `${l.players_count}/${l.max_players}`}),
      ce("div", {className:"pill", innerText: l.private ? "приватное" : "открытое"})
    );
    // точки цветов
    for (const c of taken){
      left.append(ce("span", {className:`dot ${c}`}));
    }
    line.append(left);

    const right = ce("div", {className:"right"});
    const btnJoin = ce("button", {innerText:"Войти"});
    btnJoin.disabled = l.started || (l.players_count >= l.max_players);
    btnJoin.onclick = () => openJoinDialog(l);
    right.append(btnJoin);

    // если я уже в лобби — покажем "Покинуть"
    if (me){
      const leave = ce("button", {innerText:"Покинуть"});
      leave.onclick = async ()=>{
        await API.post("/api/lobby/leave", {lobby: l.id});
        await load();
      };
      right.append(leave);

      // если я владелец — "Запустить"
      if (me.owner){
        const start = ce("button", {innerText:"Запустить", className:"primary"});
        start.onclick = async ()=>{
          try{
            await API.post("/api/lobby/start", {lobby: l.id});
            // владелец уходит сразу
            window.location.href = `/game.html?lobby=${encodeURIComponent(l.id)}`;
          }catch(e){ alert(e.detail || "Не удалось запустить"); }
        };
        // активируем только при >=2 игроков
        start.disabled = (l.players_count < 2);
        right.append(start);
      }

      // подписка на SSE — чтобы улететь на игру при старте
      subscribeIfMember(l);
    }

    line.append(right);
    $list.append(line);
  }
}

function openJoinDialog(lobby){
  joinLobbyId = lobby.id;
  $jName.textContent = lobby.name ? `«${lobby.name}»` : `#${lobby.id}`;
  $jPlayer.value = lastName;

  // Список доступных цветов
  const taken = lobby.players.map(p=>p.color);
  const free = COLORS.filter(c => !taken.includes(c));
  $jColor.innerHTML = "";
  for (const c of free){
    const opt = ce("option", {value:c, innerText: COLOR_NAMES[c]});
    $jColor.append(opt);
  }
  if (!$jColor.value && free.length) $jColor.value = free[0];

  // пароль только если приватное
  if (lobby.private){
    $jPassRow.classList.remove("hidden");
  } else {
    $jPassRow.classList.add("hidden");
    $jPassword.value = "";
  }
  $dlgJoin.classList.remove("hidden");
}

// Подписка на SSE, если мы участник лобби
function subscribeIfMember(lobby){
  const me = (lobby.players || []).find(p => p.uid === uuid());
  if (!me) return;

  // Если уже подписаны на это лобби — не создаём вторую
  if (activeSub && activeSub.lobbyId === lobby.id) return;
  // Закрыть пред. подписку
  if (activeSub && activeSub.es) try{ activeSub.es.close(); }catch(_){}
  activeSub = null;

  const es = new EventSource(`/events/${encodeURIComponent(lobby.id)}`);
  es.onmessage = (e)=>{
    try{
      const msg = JSON.parse(e.data);
      if (msg.type === "started"){
        window.location.href = `/game.html?lobby=${encodeURIComponent(lobby.id)}`;
      }
      // можно обновлять список при msg.type === "state"
    }catch(_){}
  };
  es.onerror = ()=>{/* игнор, сервер шлёт keepalive */};

  activeSub = {es, lobbyId: lobby.id};
}

// поиск
$search.oninput = () => load();

// первая загрузка
load();

