// ======= базовая утилита fetch =======
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch {}
    throw new Error(msg);
  }
  // некоторые ответы могут быть пустыми
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

// ======= элементы =======
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const list = $('#lobbies');
const btnRefresh = $('#btnRefresh');
const btnCreate = $('#btnCreate');
const dlg = $('#createDlg');
const inName = $('#inName');
const inPwd = $('#inPwd');
const inPlayers = $('#inPlayers');
const inColor = $('#inColor');
const btnCreateGo = $('#btnCreateGo');

// ======= рендер списка лобби =======
async function loadLobbies() {
  list.innerHTML = `<div class="meta">Загружается...</div>`;
  try {
    const data = await api('/lobbies'); // GET /api/lobbies
    if (!Array.isArray(data) || data.length === 0) {
      list.innerHTML = `<div class="meta">Пока нет лобби. Создайте первое.</div>`;
      return;
    }
    list.innerHTML = '';
    for (const lobby of data) {
      list.appendChild(renderLobby(lobby));
    }
  } catch (e) {
    list.innerHTML = `<div class="meta" style="color:#ff8787">Не удалось загрузить лобби: ${e.message}</div>`;
  }
}

function renderLobby(lobby) {
  const el = document.createElement('div');
  el.className = 'card';

  const left = document.createElement('div');
  left.className = 'row';
  const title = document.createElement('div');
  title.innerHTML = `<strong>${escapeHtml(lobby.name || 'Без названия')}</strong> <span class="meta">#${lobby.id}</span>`;
  left.appendChild(title);

  const meta = document.createElement('div');
  const locked = lobby.password_set ? `<span class="lock">🔒 закрыто</span>` : '';
  meta.className = 'meta';
  meta.innerHTML = `Игроки: ${lobby.players?.length || 0} / ${lobby.max_players || 4} ${locked}`;
  left.appendChild(meta);

  const right = document.createElement('div');
  right.className = 'row';
  // Только для теста — просто кнопка "Войти" (работу JOIN можно добавить далее)
  const joinBtn = document.createElement('button');
  joinBtn.className = 'btn';
  joinBtn.textContent = lobby.password_set ? 'Войти (пароль)' : 'Войти';
  joinBtn.onclick = () => joinFlow(lobby);
  right.appendChild(joinBtn);

  el.appendChild(left);
  el.appendChild(right);
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[m]));
}

// ======= создание лобби =======
function openCreateDialog() {
  // Если <dialog> поддерживается — откроем красиво
  if (dlg && dlg.showModal) {
    inName.value = '';
    inPwd.value = '';
    inPlayers.value = '4';
    inColor.value = 'red';
    dlg.showModal();
    inName.focus();
  } else {
    // Fallback: prompt
    const name = prompt('Название лобби:');
    if (name === null) return;
    const pwd = prompt('Пароль (необязательно, Enter если нет):') || '';
    const max = parseInt(prompt('Количество игроков (2–5):', '4'), 10) || 4;
    const color = prompt('Цвет фишки (red/blue/green/yellow/purple):', 'red') || 'red';
    createLobby({ name, password: pwd, max_players: clamp(max, 2, 5), color });
  }
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

async function createLobby(payload) {
  try {
    await api('/lobbies', { method: 'POST', body: payload }); // POST /api/lobbies
    await loadLobbies();
  } catch (e) {
    alert('Не удалось создать лобби: ' + e.message);
  }
}

btnCreateGo?.addEventListener('click', async (ev) => {
  ev.preventDefault();
  const name = (inName.value || '').trim();
  if (!name) { alert('Введите название'); return; }
  const password = (inPwd.value || '').trim();
  const max_players = clamp(parseInt(inPlayers.value, 10) || 4, 2, 5);
  const color = inColor.value || 'red';
  dlg.close();
  await createLobby({ name, password, max_players, color });
});

// ======= join (простой поток для проверки) =======
async function joinFlow(lobby) {
  try {
    let password = '';
    if (lobby.password_set) {
      password = prompt('Введите пароль для входа:') || '';
    }
    const player_name = prompt('Ваш ник в игре:', '') || '';
    if (!player_name) return;
    const color = prompt('Цвет фишки (red/blue/green/yellow/purple):', 'red') || 'red';
    // POST /api/lobbies/{id}/join
    const joined = await api(`/lobbies/${encodeURIComponent(lobby.id)}/join`, {
      method: 'POST',
      body: { player_name, color, password }
    });
    alert(`Вы в лобби #${joined.id}. Ожидайте начала игры у создателя.`);
    // Можно перезагрузить список, чтобы отразить +1 игрока
    await loadLobbies();
  } catch (e) {
    alert('Не удалось войти: ' + e.message);
  }
}

// ======= события =======
btnRefresh?.addEventListener('click', loadLobbies);
btnCreate?.addEventListener('click', openCreateDialog);

// init
loadLobbies();
