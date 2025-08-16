// ======= УТИЛИТЫ =======
function uid() {
  if (!localStorage.uid) {
    localStorage.uid = "u_" + Math.random().toString(36).slice(2);
  }
  return localStorage.uid;
}
function playerName() {
  if (!localStorage.playerName) localStorage.playerName = "Игрок";
  return localStorage.playerName;
}
function fetchJSON(url, opts={}) {
  opts.headers = Object.assign({}, opts.headers || {}, {
    "X-UID": uid(),
    "Content-Type": "application/json",
  });
  return fetch(url, opts).then(r => {
    if (!r.ok) return r.text().then(t => { throw new Error(t || r.statusText); });
    return r.json();
  });
}

// ======= UI =======
const $list = document.getElementById("list");
const $search = document.getElementById("search");
const $dlgCreate = document.getElementById("dlgCreate");

document.getElementById("btnRefresh").onclick = refresh;
document.getElementById("btnCreate").onclick = () => $dlgCreate.classList.remove("hidden");

// диалог создания
document.getElementById("c_cancel").onclick = () => $dlgCreate.classList.add("hidden");
document.getElementById("c_ok").onclick = async () => {
  const body = {
    name: document.getElementById("c_name").value.trim() || "Лобби",
    max_players: +document.getElementById("c_max").value,
    private: document.getElementById("c_private").checked,
    password: document.getElementById("c_password").value || null,
    color: document.getElementById("c_color").value,
    player_name: document.getElementById("c_player").value.trim() || playerName(),
  };
  localStorage.playerName = body.player_name;
  try {
    const res = await fetchJSON("/api/lobby/create", {method: "POST", body: JSON.stringify(body)});
    $dlgCreate.classList.add("hidden");
    // подписываемся и ждём старта
    waitAndAutoOpen(res.lobby.id);
    refresh();
  } catch(e) { alert(e.message); }
};

$search.oninput = refresh;

async function refresh() {
  try {
    const data = await fetchJSON("/api/lobbies");
    renderList(data.items.filter(it => it.name.toLowerCase().includes($search.value.toLowerCase())));
  } catch(e) { console.error(e); }
}

function renderList(items) {
  $list.innerHTML = "";
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "card lobby-line";

    let colors = "";
    for (const p of item.players) {
      colors += `<span class="dot" style="background:${p.color}"></span>`;
    }

    div.innerHTML = `
      <div style="flex:1 1 auto">
        <div><b>${escapeHtml(item.name)}</b>  <span class="muted">#${item.id}</span></div>
        <div class="muted">${item.players_count}/${item.max_players} · ${item.private ? "приватное" : "открытое"} · ${colors}</div>
      </div>
      <div class="row">
        <button class="btnJoin">Войти</button>
        <button class="btnLeave hidden">Покинуть</button>
        <button class="btnStart hidden primary">Старт</button>
      </div>
    `;

    const isMe = inLobby(item.id);
    const amOwner = isMe && whoAmI(item.id)?.owner;

    const btnJoin = div.querySelector(".btnJoin");
    const btnLeave = div.querySelector(".btnLeave");
    const btnStart = div.querySelector(".btnStart");

    btnJoin.onclick = () => joinDialog(item);
    btnLeave.onclick = () => leaveLobby(item.id);
    btnStart.onclick = () => startLobby(item.id);

    // Показываем/скрываем кнопки
    btnJoin.classList.toggle("hidden", isMe);
    btnLeave.classList.toggle("hidden", !isMe);
    btnStart.classList.toggle("hidden", !amOwner);

    $list.appendChild(div);
  });
}

function escapeHtml(s){return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

// локальная «память» о том, где мы состоим
function inLobby(id) {
  const you = localStorage["lobby_you_" + id];
  return !!you;
}
function whoAmI(id) {
  const s = localStorage["lobby_you_" + id];
  try { return JSON.parse(s || "null"); } catch { return null; }
}

// ======= JOIN / LEAVE / START  =======
async function joinDialog(item) {
  if (item.private) {
    const pwd = prompt("Пароль для входа?");
    if (pwd === null) return;
    await joinLobby(item.id, pwd);
  } else {
    await joinLobby(item.id, null);
  }
}
async function joinLobby(lobbyId, password) {
  // нельзя одновременно находиться в нескольких лобби
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("lobby_you_")) {
      alert("Вы уже находитесь в лобби. Сначала выйдите.");
      return;
    }
  }
  const color = prompt("Выберите цвет (red, blue, green, yellow, purple)", "red") || "red";
  try {
    const res = await fetchJSON("/api/lobby/join", {
      method: "POST",
      body: JSON.stringify({
        lobby: lobbyId,
        password,
        color,
        player_name: playerName(),
      })
    });
    localStorage["lobby_you_" + lobbyId] = JSON.stringify(res.lobby.players.find(p => p.uid === uid()) || {});
    waitAndAutoOpen(lobbyId);   // <— подписка + автооткрытие по "started"
    refresh();
  } catch(e) { alert(e.message); }
}
async function leaveLobby(lobbyId) {
  try {
    await fetchJSON("/api/lobby/leave", {
      method: "POST",
      body: JSON.stringify({lobby: lobbyId})
    });
    localStorage.removeItem("lobby_you_" + lobbyId);
    refresh();
  } catch(e) { alert(e.message); }
}
async function startLobby(lobbyId) {
  try {
    await fetchJSON("/api/lobby/start", {
      method: "POST",
      body: JSON.stringify({lobby: lobbyId})
    });
    // события "started" разойдутся по SSE — у всех будет редирект
  } catch(e) { alert(e.message); }
}

// ======= SSE: ждём "started" и уходим в game.html =======
function waitAndAutoOpen(lobbyId) {
  if (!window._sse) window._sse = {};
  if (window._sse[lobbyId]) return;

  const es = new EventSource(`/events/${encodeURIComponent(lobbyId)}`);
  window._sse[lobbyId] = es;

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data || "{}");
      if (data.type === "started") {
        es.close();
        window.location.href = `/game.html?lobby=${encodeURIComponent(lobbyId)}`;
      }
      if (data.type === "state") {
        // можно обновлять отображение игроков, но мы просто обновим список
        refresh();
      }
    } catch {}
  };

  es.onerror = () => {
    // Можно переподключаться, если хочется
    // setTimeout(() => { delete window._sse[lobbyId]; waitAndAutoOpen(lobbyId); }, 2000);
  };
}

// первичная загрузка
refresh();
