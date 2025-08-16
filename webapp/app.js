/* webapp/app.js — безопасный общий скрипт для LOBBY и GAME страниц */

(() => {
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Понимание страницы
  const isGamePage  = !!qs('#board');       // есть canvas игры
  const isLobbyPage = !!qs('[data-lobby-page], #btnCreateLobby, [data-action="create-lobby"]');

  // Утилиты
  const api = {
    list:  (q='') => `/api/lobby/list?query=${encodeURIComponent(q)}`, // GET
    create:`/api/lobby/create`,                                        // POST {name,pass,players,color}
    join:  `/api/lobby/join`,                                          // POST {lobby,name,pass,color}
    leave: `/api/lobby/leave`,                                         // POST {lobby}
    start: `/api/lobby/start`,                                         // POST {lobby}
    state: (l) => `/api/lobby/state?lobby=${encodeURIComponent(l)}`,    // GET (для лобби тоже полезно)
    sse:   (l) => `/api/events?lobby=${encodeURIComponent(l)}`,         // GET (SSE)
  };

  const POST = async (url, data) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  // ---------------- LOBBY PAGE ----------------
  async function bootstrapLobby() {
    // Кнопки/поля. Стараюсь искать по id и по data-action (чтобы не ломаться от разметки)
    const $btnCreate = qs('#btnCreateLobby,[data-action="create-lobby"]');
    const $btnRefresh= qs('#btnRefresh,[data-action="refresh"]');
    const $search    = qs('#searchLobby,[data-action="search"]');
    const $listHolder= qs('#lobbyList,[data-list="lobbies"]') || document.body;

    // Модалка (создать/войти)
    const $dlgCreate  = qs('#dlgCreate');
    const $dlgJoin    = qs('#dlgJoin');

    // Если модалки нет – создадим универсальную маленькую (попап) на лету.
    function ensureMiniPrompt() {
      let box = qs('#miniPrompt');
      if (box) return box;
      box = document.createElement('div');
      box.id = 'miniPrompt';
      box.style.cssText =
        'position:fixed;inset:0;display:none;z-index:9999;background:rgba(0,0,0,.5);' +
        'align-items:center;justify-content:center;';
      box.innerHTML = `
        <div style="width: 92vw; max-width: 420px; background:#111821; border:1px solid #2b3a4d; border-radius:14px; padding:14px;">
          <div id="mpTitle" style="margin-bottom:8px; font-weight:600;">Действие</div>
          <div id="mpFields"></div>
          <div style="display:flex; gap:10px; margin-top:12px;">
            <button id="mpCancel" type="button" style="flex:1;height:42px;border-radius:10px;border:1px solid #2b3a4d;background:#162233;color:#e6edf3">Отмена</button>
            <button id="mpOk" type="button" style="flex:1;height:42px;border-radius:10px;border:1px solid #2295ff;background:#2295ff;color:#00101f;font-weight:600">OK</button>
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
        const $fields = qs('#mpFields', box);
        $fields.innerHTML = '';

        const values = {};
        for (const f of fields) {
          const wrap = document.createElement('div');
          wrap.style.margin = '8px 0';
          const label = document.createElement('div');
          label.textContent = f.label || '';
          label.style.fontSize = '12px';
          label.style.opacity = '.8';
          label.style.marginBottom = '6px';
          const input = f.type === 'select'
            ? document.createElement('select')
            : document.createElement('input');

          input.style.cssText =
            'width:100%;height:42px;border-radius:10px;border:1px solid #2b3a4d;background:#0f141a;color:#e6edf3;padding:0 12px;';
          if (f.placeholder) input.placeholder = f.placeholder;
          if (f.value)       input.value = f.value;
          input.name = f.name;

          if (f.type === 'select') {
            (f.options || []).forEach(([val, text]) => {
              const opt = document.createElement('option');
              opt.value = val;
              opt.textContent = text;
              input.appendChild(opt);
            });
          }
          wrap.appendChild(label);
          wrap.appendChild(input);
          $fields.appendChild(wrap);
        }

        const onClose = (ok) => {
          if (ok) {
            qsa('input,select', $fields).forEach(el => values[el.name] = el.value);
            resolve(values);
          } else {
            resolve(null);
          }
          box.style.display = 'none';
        };
        qs('#mpCancel', box).onclick = () => onClose(false);
        qs('#mpOk',     box).onclick = () => onClose(true);
      });
    }

    // Рендер списка лобби (простой список; карточки у тебя свои — оставляю минимальный шаблон)
    async function loadList(query = '') {
      try {
        const r = await fetch(api.list(query));
        const json = await r.json();
        // ожидаем массив объектов: {id,name,isPrivate,slots,colors,canJoin}
        const arr = Array.isArray(json) ? json : (json.items || []);

        // Очистка
        const old = qsa('[data-lobby-item]', $listHolder);
        old.forEach(n => n.remove());

        arr.forEach(item => {
          const card = document.createElement('div');
          card.setAttribute('data-lobby-item', item.id);
          card.style.cssText =
            'margin:10px;border:1px solid #2b3a4d;border-radius:12px;padding:12px;background:#0f141a;display:flex;align-items:center;justify-content:space-between;';
          card.innerHTML = `
            <div>
              <div style="font-weight:600">${item.name || '(без названия)'}</div>
              <div style="opacity:.75;font-size:12px">#${item.id} · ${item.slots || '—'} · ${item.isPrivate ? 'приватное' : 'открытое'}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${(item.colors||[]).map(c=>`<span style="width:10px;height:10px;border-radius:50%;display:inline-block;background:${c}"></span>`).join('')}
              <button type="button" class="join btn" data-id="${item.id}" style="height:36px;border-radius:10px;border:1px solid #2b3a4d;background:#162233;color:#e6edf3">Войти</button>
              ${item.canStart ? `<button type="button" class="start btn primary" data-id="${item.id}" style="height:36px;border-radius:10px;border:1px solid #2295ff;background:#2295ff;color:#00101f;font-weight:600">Запустить</button>` : ''}
              ${item.canLeave ? `<button type="button" class="leave btn" data-id="${item.id}" style="height:36px;border-radius:10px;border:1px solid #2b3a4d;background:#162233;color:#e6edf3">Покинуть</button>` : ''}
            </div>
          `;
          $listHolder.appendChild(card);
        });
      } catch (e) {
        console.error(e);
      }
    }

    // Слушаем клики по карточкам (join / leave / start)
    document.addEventListener('click', async (ev) => {
      const t = ev.target.closest('button');
      if (!t) return;

      // JOIN
      if (t.classList.contains('join')) {
        const lobbyId = t.dataset.id;
        const vals = await miniPrompt({
          title: 'Войти в лобби',
          fields: [
            {name:'name',  label:'Ваше имя', placeholder:'Имя'},
            {name:'color', label:'Цвет фишки', type:'select',
              options: [
                ['red','Красный'], ['blue','Синий'],
                ['green','Зелёный'], ['yellow','Жёлтый'],
                ['purple','Фиолетовый'], ['cyan','Голубой'],
              ]},
            {name:'pass',  label:'Пароль (если есть)', placeholder:'Пароль'},
          ]
        });
        if (!vals) return;
        try {
          await POST(api.join, { lobby: lobbyId, name: vals.name || 'Игрок', pass: vals.pass || '', color: vals.color || 'red' });
          // подключаемся к SSE и ждём старт игры — или сразу загружаем state
          listenStarted(lobbyId);
          // можно сразу открыть «панель комнаты» если она у тебя есть — тут просто обновим список
          await loadList($search?.value || '');
        } catch (e) {
          alert('Не удалось войти: ' + e.message);
        }
        return;
      }

      // LEAVE
      if (t.classList.contains('leave')) {
        const lobbyId = t.dataset.id;
        try {
          await POST(api.leave, { lobby: lobbyId });
          await loadList($search?.value || '');
        } catch (e) {
          alert('Не удалось покинуть: ' + e.message);
        }
        return;
      }

      // START (только владелец)
      if (t.classList.contains('start')) {
        const lobbyId = t.dataset.id;
        try {
          await POST(api.start, { lobby: lobbyId });
          // всем придёт started по SSE; на всякий случай редиректнём создателя сразу:
          location.href = `/game.html?lobby=${encodeURIComponent(lobbyId)}`;
        } catch (e) {
          alert('Не удалось запустить: ' + e.message);
        }
        return;
      }
    });

    // «Создать лобби»
    if ($btnCreate) $btnCreate.addEventListener('click', async () => {
      const vals = await miniPrompt({
        title: 'Создать лобби',
        fields: [
          {name:'name',   label:'Название лобби', placeholder:'Моё лобби'},
          {name:'players',label:'Игроков (2–5)', placeholder:'2'},
          {name:'color',  label:'Твой цвет', type:'select',
            options: [
              ['red','Красный'], ['blue','Синий'],
              ['green','Зелёный'], ['yellow','Жёлтый'],
              ['purple','Фиолетовый'], ['cyan','Голубой'],
            ]},
          {name:'pass',   label:'Пароль (необязательно)', placeholder:'...'},
        ]
      });
      if (!vals) return;

      const payload = {
        name:    vals.name || 'Лобби',
        pass:    vals.pass || '',
        players: Math.max(2, Math.min(5, parseInt(vals.players || 2, 10))),
        color:   vals.color || 'red'
      };
      try {
        const created = await POST(api.create, payload);
        const lobbyId = created?.id || created?.lobby || created;
        listenStarted(lobbyId);               // подписка на старт
        await loadList($search?.value || '');
      } catch (e) {
        alert('Не удалось создать лобби: ' + e.message);
      }
    });

    // Обновить/Поиск
    if ($btnRefresh) $btnRefresh.addEventListener('click', () => loadList($search?.value || ''));
    if ($search)     $search.addEventListener('input',  () => loadList($search.value || ''));

    // первый показ
    await loadList($search?.value || '');
  }

  // Ждать started и редиректить в game.html
  function listenStarted(lobbyId) {
    try {
      const es = new EventSource(api.sse(lobbyId));
      es.onmessage = (ev) => {
        if (!ev.data) return;
        const msg = JSON.parse(ev.data);
        if (msg.type === 'started') {
          es.close();
          location.href = `/game.html?lobby=${encodeURIComponent(lobbyId)}`;
        }
      };
      es.onerror = () => setTimeout(() => listenStarted(lobbyId), 1200);
    } catch (e) {
      console.error(e);
    }
  }

  // ---------------- GAME PAGE ----------------
  // (на самой странице игры ничего не делаем — код в webapp/game.js)
  // Важно, чтобы здесь не было ошибок, если элементов игры нет.

  // ---------------- BOOTSTRAP ----------------
  document.addEventListener('DOMContentLoaded', () => {
    // Никаких падений, каждая часть запускается только «на своей» странице.
    if (isLobbyPage) bootstrapLobby().catch(console.error);
    // isGamePage → game.js сам запустится
  });
})();
