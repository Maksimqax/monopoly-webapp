// NB: пока используем "you" как псевдоним текущего игрока.
// Позже подставим реального пользователя из Telegram initData.
const CURRENT = "you";

const api = {
  async list() {
    const r = await fetch("/api/lobbies");
    return r.json();
  },
  async create({name, password, max_players}) {
    const r = await fetch("/api/lobbies", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({name, password, max_players, owner: CURRENT})
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async join(id, password) {
    const r = await fetch(`/api/lobbies/${id}/join`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({who: CURRENT, password})
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async start(id) {
    const r = await fetch(`/api/lobbies/${id}/start`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({who: CURRENT})
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
};

const els = {
  list: document.getElementById("lobbiesList"),
  createBtn: document.getElementById("createBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  dlg: document.getElementById("createDialog"),
  dlgName: document.getElementById("dlgName"),
  dlgPass: document.getElementById("dlgPass"),
  dlgMax: document.getElementById("dlgMax"),
  dlgOk: document.getElementById("dlgOk"),
  dlgCancel: document.getElementById("dlgCancel"),
  joinDlg: document.getElementById("joinDialog"),
  joinTitle: document.getElementById("joinTitle"),
  joinPass: document.getElementById("joinPass"),
  joinOk: document.getElementById("joinOk"),
  joinCancel: document.getElementById("joinCancel"),
};

function lobbyRow(l) {
  // кнопки
  let actions = "";

  // Войти
  const joinDisabled = l.players >= l.max_players ? "disabled" : "";
  if (l.locked) {
    actions += `<button data-id="${l.id}" class="joinLocked" ${joinDisabled}>Войти</button>`;
  } else {
    actions += `<button data-id="${l.id}" class="joinOpen" ${joinDisabled}>Войти</button>`;
  }

  // Запустить (если я — владелец)
  if (l.owner === CURRENT) {
    const canStart = l.players >= 2 && !l.started;
    actions += `<button data-id="${l.id}" class="startBtn" ${canStart ? "" : "disabled"}>Запустить</button>`;
  }

  return `
    <li class="lobby">
      <div class="name">${l.name} <span class="id">#${l.id}</span></div>
      <div class="meta">${l.players}/${l.max_players} · ${l.locked ? "🔒 приватное" : "открытое"}</div>
      <div class="actions">${actions}</div>
    </li>
  `;
}

async function refresh() {
  const data = await api.list();
  els.list.innerHTML = data.lobbies.map(lobbyRow).join("");

  // JOIN открытые
  els.list.querySelectorAll(".joinOpen").forEach(btn => {
    btn.onclick = async () => {
      if (btn.disabled) return;
      try {
        await api.join(btn.dataset.id, "");
        await refresh();
      } catch (e) {
        alert("Ошибка: " + e.message);
      }
    };
  });
  // JOIN с паролем
  els.list.querySelectorAll(".joinLocked").forEach(btn => {
    btn.onclick = () => {
      if (btn.disabled) return;
      openJoinDialog(btn.dataset.id);
    };
  });
  // START (только владелец)
  els.list.querySelectorAll(".startBtn").forEach(btn => {
    btn.onclick = async () => {
      if (btn.disabled) return;
      try {
        const res = await api.start(btn.dataset.id);
        alert(res.message || "Игра запущена");
        // TODO: здесь же можем перейти на страницу поля /game?id=...
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
  els.dlg.showModal();
}

function openJoinDialog(id) {
  els.joinDlg.dataset.id = id;
  els.joinTitle.textContent = `Лобби #${id} требует пароль`;
  els.joinPass.value = "";
  els.joinDlg.showModal();
}

// events
els.createBtn.onclick = openCreateDialog;
els.refreshBtn.onclick = refresh;

els.dlgCancel.onclick = () => els.dlg.close();
els.dlgOk.onclick = async () => {
  try {
    const name = els.dlgName.value.trim();
    const password = els.dlgPass.value.trim();
    const max_players = parseInt(els.dlgMax.value, 10);
    await api.create({name, password, max_players});
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
    await api.join(id, pass);
    els.joinDlg.close();
    await refresh();
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

// init
refresh();
