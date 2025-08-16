// ===== простая идентификация игрока (для тестов) =====
const params = new URLSearchParams(location.search);
let CURRENT = params.get("u") || localStorage.getItem("u");
if (!CURRENT) {
  CURRENT = "player_" + Math.floor(Math.random() * 10000);
  localStorage.setItem("u", CURRENT);
}

const api = {
  async list() {
    const r = await fetch("/api/lobbies");
    return r.json();
  },
  async create({ name, password, max_players, color }) {
    const r = await fetch("/api/lobbies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password, max_players, owner: CURRENT, color }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async join(id, password, color) {
    const r = await fetch(`/api/lobbies/${id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who: CURRENT, password, color }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async leave(id) {
    const r = await fetch(`/api/lobbies/${id}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who: CURRENT }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async start(id) {
    const r = await fetch(`/api/lobbies/${id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who: CURRENT }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
};

const els = {
  list: document.getElementById("lobbiesList"),
  createBtn: document.getElementById("createBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  search: document.getElementById("search"),

  dlg: document.getElementById("createDialog"),
  dlgName: document.getElementById("dlgName"),
  dlgPass: document.getElementById("dlgPass"),
  dlgMax: document.getElementById("dlgMax"),
  dlgColor: document.getElementById("dlgColor"),
  dlgOk: document.getElementById("dlgOk"),
  dlgCancel: document.getElementById("dlgCancel"),

  joinDlg: document.getElementById("joinDialog"),
  joinTitle: document.getElementById("joinTitle"),
  joinPass: document.getElementById("joinPass"),
  joinColor: document.getElementById("joinColor"),
  joinOk: document.getElementById("joinOk"),
  joinCancel: document.getElementById("joinCancel"),

  joinOpenDlg: document.getElementById("joinOpenDialog"),
  joinOpenTitle: document.getElementById("joinOpenTitle"),
  joinOpenColor: document.getElementById("joinOpenColor"),
  joinOpenOk: document.getElementById("joinOpenOk"),
  joinOpenCancel: document.getElementById("joinOpenCancel"),
};

let LOBBIES_CACHE = [];

function colorDot(color) {
  return `<span class="dot" style="background:${color}"></span>`;
}

function isMember(l) {
  return (l.members || []).includes(CURRENT);
}

function anyActiveMembership() {
  return LOBBIES_CACHE.some((l) => !l.started && isMember(l));
}

function lobbyRow(l) {
  const full = l.players >= l.max_players;
  const member = isMember(l);

  // кнопки действий
  let actions = "";

  if (member) {
    actions += `<button data-id="${l.id}" class="leaveBtn">Покинуть</button>`;
  } else {
    const joinDisabled = full ? "disabled" : "";
    if (l.locked) {
      actions += `<button data-id="${l.id}" class="joinLocked" ${joinDisabled}>Войти</button>`;
    } else {
      actions += `<button data-id="${l.id}" class="joinOpen" ${joinDisabled}>Войти</button>`;
    }
  }

  if (l.owner === CURRENT) {
    const canStart = l.players >= 2 && !l.started;
    actions += `<button data-id="${l.id}" class="startBtn" ${canStart ? "" : "disabled"}>Запустить</button>`;
  }

  const cols = Object.values(l.taken_colors || {})
    .map((c) => colorDot(c))
    .join("");

  return `
    <li class="lobby">
      <div class="name">${l.name} <span class="id">#${l.id}</span></div>
      <div class="meta">${l.players}/${l.max_players} · ${l.locked ? "🔒 приватное" : "открытое"} ${cols ? " · " + cols : ""}</div>
      <div class="actions">${actions}</div>
    </li>
  `;
}

function renderList() {
  // фильтр по названию
  const q = (els.search.value || "").trim().toLowerCase();
  const filtered = q
    ? LOBBIES_CACHE.filter((l) => (l.name || "").toLowerCase().includes(q))
    : LOBBIES_CACHE;

  els.list.innerHTML = filtered.map(lobbyRow).join("");

  // навешиваем обработчики
  els.list.querySelectorAll(".joinOpen").forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      if (anyActiveMembership()) {
        alert("Сначала покиньте ваше текущее лобби");
        return;
      }
      els.joinOpenDlg.dataset.id = btn.dataset.id;
      els.joinOpenTitle.textContent = `Лобби #${btn.dataset.id} — выберите цвет`;
      els.joinOpenColor.value = "red";
      els.joinOpenDlg.showModal();
    };
  });

  els.list.querySelectorAll(".joinLocked").forEach((btn) => {
    btn.onclick = () => {
      if (btn.disabled) return;
      if (anyActiveMembership()) {
        alert("Сначала покиньте ваше текущее лобби");
        return;
      }
      els.joinDlg.dataset.id = btn.dataset.id;
      els.joinTitle.textContent = `Лобби #${btn.dataset.id} — пароль и цвет`;
      els.joinPass.value = "";
      els.joinColor.value = "red";
      els.joinDlg.showModal();
    };
  });

  els.list.querySelectorAll(".leaveBtn").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api.leave(btn.dataset.id);
        await refresh();
      } catch (e) {
        alert("Ошибка: " + e.message);
      }
    };
  });

  els.list.querySelectorAll(".startBtn").forEach((btn) => {
    btn.onclick = async () => {
      if (btn.disabled) return;
      try {
        const res = await api.start(btn.dataset.id);
        alert(res.message || "Игра запущена");
        await refresh();
      } catch (e) {
        alert("Ошибка: " + e.message);
      }
    };
  });

  // блокировать создание, если уже в активном лобби
  const busy = anyActiveMembership();
  els.createBtn.disabled = busy;
  els.createBtn.title = busy ? "Вы уже состоите в активном лобби" : "";
}

async function refresh() {
  const data = await api.list();
  LOBBIES_CACHE = data.lobbies || [];
  renderList();
}

// UI: создание
function openCreateDialog() {
  els.dlgName.value = "";
  els.dlgPass.value = "";
  els.dlgMax.value = "4";
  els.dlgColor.value = "red";
  els.dlg.showModal();
}

els.createBtn.onclick = openCreateDialog;
els.refreshBtn.onclick = refresh;
els.search.oninput = renderList;

els.dlgCancel.onclick = () => els.dlg.close();
els.dlgOk.onclick = async () => {
  try {
    const name = els.dlgName.value.trim();
    const password = els.dlgPass.value.trim();
    const max_players = parseInt(els.dlgMax.value, 10);
    const color = els.dlgColor.value;
    await api.create({ name, password, max_players, color });
    els.dlg.close();
    await refresh();
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

els.joinCancel.onclick = () => els.joinDlg.close();
els.joinOk.onclick = async () => {
  try {
    const id = els.joinDlg.dataset.id;
    const pass = els.joinPass.value.trim();
    const color = els.joinColor.value;
    await api.join(id, pass, color);
    els.joinDlg.close();
    await refresh();
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

els.joinOpenCancel.onclick = () => els.joinOpenDlg.close();
els.joinOpenOk.onclick = async () => {
  try {
    const id = els.joinOpenDlg.dataset.id;
    const color = els.joinOpenColor.value;
    await api.join(id, "", color);
    els.joinOpenDlg.close();
    await refresh();
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

// init
refresh();
