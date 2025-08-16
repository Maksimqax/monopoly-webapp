/* webapp/app.js — устойчивый к модалкам JS для лобби и игры */

(() => {
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Страница?
  const isGamePage  = !!qs('#board');
  const isLobbyPage = !!qs('[data-lobby-page], #btnCreateLobby, [data-action="create-lobby"]');

  // -------- общие утилиты --------
  // Гасим любой submit, чтобы Telegram WebApp не ломал клики
  document.addEventListener('submit', (e) => e.preventDefault(), true);

  // Все кнопки внутри форм — делаем type="button"
  qsa('form button:not([type])').forEach(b => b.setAttribute('type','button'));

  // Принудительное закрытие любых «сторонних» модалок
  function forceCloseNativeModals() {
    qsa('.modal.show, [data-modal].open').forEach(m => {
      m.classList.remove('show','open');
      m.style.display = 'none';
      m.setAttribute('aria-hidden','true');
    });
    // иногда бэкдропы остаются:
    qsa('.modal-backdrop').forEach(b => b.remove());
  }

  // Мини-диалог (всегда кликается в WebApp)
  function ensureMiniPrompt() {
    let box = qs('#miniPrompt');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'miniPrompt';
    box.style.cssText =
      'position:fixed;inset:0;display:none;z-index:99999;background:rgba(0,0,0,.5);align-items:center;justify-content:center;';
    box.innerHTML = `
      <div style="width:92vw;max-width:420px;background:#111821;border:1px solid #2b3a4d;border-radius:14px;padding:14px">
        <div id="mpTitle" style="margin-bottom:8px;font-weight:600">Действие</div>
        <div id="mpFields"></div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button id="mpCancel" type="button" style="flex:1;height:42px;border-radius:10px;border:1px solid #2b3a4d;background:#162233;color:#e6edf3">Отмена</button>
          <button id="mpOk"     type="button" style="flex:1;height:42px;border-radius:10px;border:1px solid #2295ff;background:#2295ff;color:#00101f;font-weight:600">OK</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    return box;
  }
  function miniPrompt({title, fields}) {
    return new Promise((resolve) => {
      const box = ensureMiniPrompt();
      box.style.display = 'flex';
      qs('#mpTitle', box).textContent = title || 'Действие';
      const $wrap = qs('#mpFields', box);
      $wrap.innerHTML = '';
      const vals = {};
      for (const f of fields) {
        const row = document.createElement('div');
        row.style.margin = '8px 0';
        row.innerHTML = `
          <div style="font-size:12px;opacity:.8;margin-bottom:6px">${f.label||''}</div>
        `;
        const input = f.type === 'select' ? document.createElement('select') : document.createElement('input');
        input.style.cssText = 'width:100%;height:42px;border-radius:10px;border:1px solid #2b3a4d;background:#0f141a;color:#e6edf3;padding:0 12px';
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.value)       input.value = f.value;
        input.name = f.name;
        if (f.type === 'select') {
          (f.options||[]).forEach(([val, txt]) => {
            const o = document.createElement('option');
            o.value = val; o.textContent = txt;
            input.appendChild(o);
          });
        }
        row.appendChild(input);
        $wrap.appendChild(row);
      }
      const close = (ok) => {
        if (ok) qsa('input,select', $wrap).forEach(el => vals[el.name] = el.value);
        box.style.display = 'none';
        resolve(ok ? vals : null);
      };
      qs('#mpCancel', box).onclick = () => close(false);
      qs('#mpOk',     box).onclick = () => close(true);
    });
  }

  // API
  const api = {
    list:  (q='') => `/api/lobby/list?query=${encodeURIComponent(q)}`,
    create:`/api/lobby/create`,
    join:  `/api/lobby/join`,
    leave: `/api/lobby/leave`,
    start: `/api/lobby/start`,
    state: (l)=> `/api/lobby/state?lobby=${encodeURIComponent(l)}`,
    sse:   (l)=> `/api/events?lobby=${encodeURIComponent(l)}`
  };
  const POST = async (url, data) => {
    const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)});
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  // ======== LOBBY ========
  async function bootstrapLobby() {
    const $btnCreate  = qs('#btnCreateLobby,[data-action="create-lobby"]');
    const $btnRefresh = qs('#btnRefresh,[data-action="refresh"]');
    const $search     = qs('#searchLobby,[data-action="search"]');
    const $list       = qs('#lobbyList,[data-list="lobbies"]') || document.body;

    async function loadList(q='') {
      try {
        const r = await fetch(api.list(q));
        const json = await r.json();
        const arr = Array.isArray(json) ? json : (json.items || []);
        qsa('[data-lobby-item]', $list).forEach(n=>n.remove());
        arr.forEach(item => {
          const card = document.createElement('div');
          card.setAttribute('data-lobby-item', item.id);
          card.style.cssText = 'margin:10px;padding:12px;border:1px solid #2b3a4d;border-radius:12px;background:#0f141a;display:flex;justify-content:space-between;align-items:center';
          card.innerHTML = `
            <div>
              <div style="font-weight:600">${item.name||'(без названия)'}</div>
              <div style="opacity:.7;font-size:12px">#${item.id} · ${item.slots||'—'} · ${item.isPrivate?'приватное':'открытое'}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${(item.colors||[]).map(c=>`<span style="width:10px;height:10px;border-radius:50%;background:${c};display:inline-block"></span>`).join('')}
              <button type="button" class="join"  data-id="${item.id}" style="height:36px;border-radius:10px;border:1px solid #2b3a4d;background:#162233;color:#e6edf3">Войти</button>
              ${item.canStart ? `<button type="button" class="start" data-id="${item.id}" style="height:36px;border-radius:10px;border:1px solid #2295ff;background:#2295ff;color:#00101f;font-weight:600">Запустить</button>` : ''}
              ${item.canLeave ? `<button type="button" class="leave" data-id="${item.id}" style="height:36px;border-radius:10px;border:1px solid #2b3a4d;background:#162233;color:#e6edf3">Покинуть</button>` : ''}
            </div>`;
          $list.appendChild(card);
        });
      } catch (e) {
        console.error(e);
      }
    }

    // Делегирование кликов (не зависит от разметки)
    document.addEventListener('click', async (ev) => {
      const t = ev.target.closest('button');
      if (!t) return;

      // 1) Войти
      if (t.classList.contains('join')) {
        ev.preventDefault(); ev.stopPropagation();
        forceCloseNativeModals(); // если открыта «твоя» модалка — закрыть

        const lobbyId = t.dataset.id;
        const vals = await miniPrompt({
          title: 'Войти в лобби',
          fields: [
            {name:'name',  label:'Ваше имя', placeholder:'Имя'},
            {name:'color', label:'Цвет фишки', type:'select', options:[
              ['red','Красный'],['blue','Синий'],['green','Зелёный'],
              ['yellow','Жёлтый'],['purple','Фиолетовый'],['cyan','Голубой']
            ]},
            {name:'pass',  label:'Пароль (если есть)', placeholder:'Пароль'},
          ]
        });
        if (!vals) return;
        try {
          await POST(api.join, { lobby: lobbyId, name: vals.name || 'Игрок', pass: vals.pass || '', color: vals.color || 'red' });
          listenStarted(lobbyId);
          await loadList($search?.value || '');
        } catch (e) { alert('Не удалось войти: '+e.message); }
        return;
      }

      // 2) Покинуть
      if (t.classList.contains('leave')) {
        ev.preventDefault(); ev.stopPropagation();
        const lobbyId = t.dataset.id;
        try { await POST(api.leave, {lobby:lobbyId}); await loadList($search?.value||''); }
        catch (e) { alert('Не удалось покинуть: '+e.message); }
        return;
      }

      // 3) Запустить
      if (t.classList.contains('start')) {
        ev.preventDefault(); ev.stopPropagation();
        const lobbyId = t.dataset.id;
        try {
          await POST(api.start, {lobby:lobbyId});
          location.href = `/game.html?lobby=${encodeURIComponent(lobbyId)}`;
        } catch (e) { alert('Не удалось запустить: '+e.message); }
        return;
      }
    });

    // Создать лобби
    if ($btnCreate) $btnCreate.addEventListener('click', async () => {
      forceCloseNativeModals(); // на всякий случай
      const vals = await miniPrompt({
        title: 'Создать лобби',
        fields: [
          {name:'name',   label:'Название', placeholder:'Моё лобби'},
          {name:'players',label:'Игроков (2–5)', placeholder:'2'},
          {name:'color',  label:'Твой цвет', type:'select', options:[
            ['red','Красный'],['blue','Синий'],['green','Зелёный'],
            ['yellow','Жёлтый'],['purple','Фиолетовый'],['cyan','Голубой']
          ]},
          {name:'pass',   label:'Пароль (опционально)', placeholder:'...'},
        ]
      });
      if (!vals) return;
      const payload = {
        name: vals.name || 'Лобби',
        pass: vals.pass || '',
        players: Math.max(2, Math.min(5, parseInt(vals.players||2,10))),
        color: vals.color || 'red',
      };
      try {
        const created = await POST(api.create, payload);
        const lobbyId = created?.id || created?.lobby || created;
        listenStarted(lobbyId);
        await loadList($search?.value||'');
      } catch (e) { alert('Не удалось создать: '+e.message); }
    });

    if ($btnRefresh) $btnRefresh.addEventListener('click', () => loadList($search?.value||''));
    if ($search)     $search.addEventListener('input',  () => loadList($search.value||''));

    await loadList($search?.value||'');
  }

  // SSE: ждём старта игры
  function listenStarted(lobbyId) {
    try {
      const es = new EventSource(`/api/events?lobby=${encodeURIComponent(lobbyId)}`);
      es.onmessage = (ev) => {
        if (!ev.data) return;
        const msg = JSON.parse(ev.data);
        if (msg.type === 'started') {
          es.close();
          location.href = `/game.html?lobby=${encodeURIComponent(lobbyId)}`;
        }
      };
      es.onerror = () => setTimeout(() => listenStarted(lobbyId), 1200);
    } catch (e) { console.error(e); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (isLobbyPage) bootstrapLobby().catch(console.error);
    // страница игры — отдельный файл game.js
  });
})();
