const api = {
  async list() {
    const r = await fetch("/api/lobbies");
    return r.json();
  },
  async create({name, password, max_players}) {
    const r = await fetch("/api/lobbies", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({name, password, max_players, owner: "you"})
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async join(id, password) {
    const r = await fetch(`/api/lobbies/${id}/join`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({who:"you", password})
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

async function refresh() {
  const data = await api.list();
  els.list.innerHTML = "";
  data.lobbies.forEach(l => {
    const li = document.createElement("li");
    li.className = "lobby";
    li.innerHTML = `
      <div class="name">${l.name} <span class="id">#${l.id}</span></div>
      <div class="meta">${l.players}/${l.max_players} · ${l.locked ? "🔒 приватное" : "открытое"}</div>
      <div class="actions">
        ${l.locked
          ? `<button data-id="${l.id}" class="joinLocked">Войти</button>`
          : `<button data-id="${l.id}" class="joinOpen">Войти</button>`}
      </div>
    `;
    els.list.appendChild(li);
  });

  // навесить обработчики
  els.list.querySelectorAll(".joinOpen").forEach(btn => {
    btn.onclick = async () => {
      try {
        await api.join(btn.dataset.id, "");
        alert("Вы вошли в лобби " + btn.dataset.id);
      } catch (e) {
        alert("Ошибка: " + e.message);
      }
    };
  });
  els.list.querySelectorAll(".joinLocked").forEach(btn => {
    btn.onclick = () => openJoinDialog(btn.dataset.id);
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

// события
els.createBtn.onclick = openCreateDialog;
els.refreshBtn.onclick = refresh;

els.dlgCancel.onclick = () => els.dlg.close();
els.dlgOk.onclick = async () => {
  try {
    const name = els.dlgName.value.trim();
    const password = els.dlgPass.value.trim();
    const max_players = parseInt(els.dlgMax.value, 10);
    const res = await api.create({name, password, max_players});
    els.dlg.close();
    alert("Лобби создано: #" + res.id);
    refresh();
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
    alert("Вы вошли в лобби #" + id);
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

// первый рендер
refresh();
