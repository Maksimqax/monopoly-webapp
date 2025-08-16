// ===== простая идентификация игрока для тестов =====
// 1) ?u=Имя в URL
// 2) иначе из localStorage
// 3) иначе генерируем player_XXXX
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

function colorDot(color) {
  return `<span class="dot" style="background:${color}"></span>`;
}

function lobbyRow(l) {
  // кнопки
  let actions = "";

  // Кнопка Войти (если лобби не забито)
  const full = l.players >= l.max_players;
  const joinDisabled = full ? "disabled" : "";

  if (l.locked) {
    actions += `<button data-id="${l.id}" class="joinLocked" ${joinDisabled}>Войти</button>`;
  } else {
    actions += `<button data-id="${l.id}" class="joinOpen" ${joinDisabled}>Войти</button>`;
  }

  // Кнопка Запустить (у владельца)
  if (l.owner === CURRENT) {
    const canStart = l.players >= 2 && !l.started;
    actions += `<button data-id="${l.id}" class="startBtn" ${canStart ? "" : "disabled"}>Запустить</button>`;
  }

  // показать занятые цвета
  const cols = Object.values(l.taken_colors || {}).map(c => colorDot(c)).join("");

  return `
    <li class="lobby">
      <div class="name">${l.name} <span class="id">#${l.id}</span></div>
      <div class="meta">${l.players}/${l.max_players} · ${l.locked ? "🔒 приватное" : "открытое"}  ${cols ? " · " + cols : ""}</div>
      <div class="actions">${actions}</div>
    </li>
  `;
}

async function refresh() {
  const data = await api.list();
  els.list.innerHTML = data.lobbies.map(lobbyRow).join("");

  // Войти в открытое (покажем диалог цвета)
  els.list.querySelectorAll(".joinOpen").forEach(btn => {
    btn.onclick = () => {
      if (btn.disabled) return;
      els.joinOpenDlg.dataset.id = btn.dataset.id;
      els.joinOpenTitle.textContent = `Лобби #${btn.dataset.id} — выберите свой цвет`;
      els.joinOpenColor.value = "red";
      els.joinOpenDlg.showModal();
    };
  });

  // Войти в приватное (цвет + пароль)
  els.list.querySelectorAll(".joinLocked").forEach(btn => {
    btn.onclick = () => {
      if (btn.disabled) return;
      els.joinDlg.dataset.id = btn.dataset.id;
      els.joinTitle.textContent = `Лобби #${btn.dataset.id} — пароль и цвет`;
      els.joinPass.value = "";
      els.joinColor.value = "red";
      els.joinDlg.showModal();
    };
  });

  // Запуск
  els.list.querySelectorAll(".startBtn").forEach(btn => {
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
}

function openCreateDialog() {
  els.dlgName.value = "";
  els.dlgPass.value = "";
  els.dlgMax.value = "4";
  els.dlgColor.value = "red";
  els.dlg.showModal();
}

// EVENTS
els.createBtn.onclick = openCreateDialog;
els.refreshBtn.onclick = refresh;

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
