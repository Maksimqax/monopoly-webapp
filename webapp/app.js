const tg = window.Telegram?.WebApp;
if (tg) tg.expand();

const qs = new URLSearchParams(location.search);
const ROOM = document.getElementById('room');
ROOM.value = qs.get('room') || '';
const log = (m)=>{ const el=document.getElementById('log'); el.textContent += m+"\n"; el.scrollTop = el.scrollHeight; };

const apiBase = location.origin.replace(/\/webapp.*$/,''); // served same origin via backend proxy
const initData = tg?.initData || '';

const boardEl = document.getElementById('board');
const playersEl = document.getElementById('players');
const youEl = document.getElementById('you');
const turnEl = document.getElementById('turn');

function drawBoard(board){
  boardEl.innerHTML='';
  board.forEach((c,i)=>{
    const d=document.createElement('div');
    d.className='cell';
    let extra='';
    if(c.type==='tax') d.classList.add('tax');
    if(c.type==='chance') d.classList.add('chance');
    if(c.type==='jail') d.classList.add('jail');
    if(c.type==='gotojail') d.classList.add('goto');
    if(c.type==='free') d.classList.add('free');
    if(c.type==='street' && c.owner) extra = ` (👤 ${c.owner})`;
    d.textContent = `${i}. ${c.name}${extra}`;
    boardEl.appendChild(d);
  });
}

function drawPlayers(state){
  playersEl.innerHTML='';
  Object.values(state.players).forEach(p=>{
    const d=document.createElement('div');
    d.className='badge'+(p.id==state.turn?' me':'');
    d.textContent = `${p.name} | $${p.money} | pos:${p.pos}` + (p.in_jail?' | jail':'');
    playersEl.appendChild(d);
  });
}

function draw(state){
  drawBoard(state.board);
  drawPlayers(state);
  turnEl.textContent = state.turn ? 'Ход: '+state.players[state.turn].name : '';
}

function wsConnect(room){
  const ws = new WebSocket(`${location.origin.replace('http','ws')}/ws?room=${room}`);
  ws.onmessage = (e)=>{
    const msg = JSON.parse(e.data);
    if (msg.type==='state'){
      draw(msg.data);
    } else if (msg.type==='event'){
      log(JSON.stringify(msg.data));
    }
  };
  ws.onclose = ()=> setTimeout(()=>wsConnect(room), 1500);
}
document.getElementById('btnJoin').onclick = async()=>{
  const room=ROOM.value.trim(); if(!room){alert('room?');return;}
  const r=await fetch('/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData,room})});
  const data=await r.json();
  if(data.ok){ draw(data.state); wsConnect(room); log('joined '+room); }
};
document.getElementById('btnStart').onclick = async()=>{
  const room=ROOM.value.trim(); if(!room) return;
  await fetch('/api/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room})});
};
document.getElementById('btnRoll').onclick = async()=>{
  const room=ROOM.value.trim(); if(!room) return;
  const r=await fetch('/api/roll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,initData})});
  const data=await r.json(); if(data.ok) log('dice '+data.dice);
};
document.getElementById('btnBuy').onclick = async()=>{
  const room=ROOM.value.trim(); if(!room) return;
  const user = JSON.parse(atob(new URLSearchParams(initData).get('user')+'=='));
  await fetch('/api/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,pid:String(user.id)})});
};
document.getElementById('btnEnd').onclick = async()=>{
  const room=ROOM.value.trim(); if(!room) return;
  await fetch('/api/end_turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room})});
};
