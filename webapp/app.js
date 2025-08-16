const params = new URLSearchParams(location.search);
let CURRENT = params.get("u") || localStorage.getItem("u");
if (!CURRENT) { CURRENT = "player_" + Math.floor(Math.random()*10000); localStorage.setItem("u", CURRENT); }

const api = {
  async list(){ return (await fetch("/api/lobbies")).json(); },
  async create(payload){ const r=await fetch("/api/lobbies",{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,owner:CURRENT})}); if(!r.ok) throw new Error(await r.text()); return r.json(); },
  async join(id,pass,color){ const r=await fetch(`/api/lobbies/${id}/join`,{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({who:CURRENT,password:pass,color})}); if(!r.ok) throw new Error(await r.text()); return r.json(); },
  async leave(id){ const r=await fetch(`/api/lobbies/${id}/leave`,{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({who:CURRENT})}); if(!r.ok) throw new Error(await r.text()); return r.json(); },
  async start(id){ const r=await fetch(`/api/lobbies/${id}/start`,{method:"POST",headers:{'Content-Type':'application/json'},body:JSON.stringify({who:CURRENT})}); if(!r.ok) throw new Error(await r.text()); return r.json(); },
};

const els={
  list:document.getElementById("lobbiesList"),
  createBtn:document.getElementById("createBtn"),
  refreshBtn:document.getElementById("refreshBtn"),
  search:document.getElementById("search"),
  dlg:document.getElementById("createDialog"),
  dlgName:document.getElementById("dlgName"),
  dlgPass:document.getElementById("dlgPass"),
  dlgMax:document.getElementById("dlgMax"),
  dlgColor:document.getElementById("dlgColor"),
  dlgOk:document.getElementById("dlgOk"),
  dlgCancel:document.getElementById("dlgCancel"),
  joinDlg:document.getElementById("joinDialog"),
  joinTitle:document.getElementById("joinTitle"),
  joinPass:document.getElementById("joinPass"),
  joinColor:document.getElementById("joinColor"),
  joinOk:document.getElementById("joinOk"),
  joinCancel:document.getElementById("joinCancel"),
  joinOpenDlg:document.getElementById("joinOpenDialog"),
  joinOpenTitle:document.getElementById("joinOpenTitle"),
  joinOpenColor:document.getElementById("joinOpenColor"),
  joinOpenOk:document.getElementById("joinOpenOk"),
  joinOpenCancel:document.getElementById("joinOpenCancel"),
};

let CACHE=[];

function isMember(l){ return (l.members||[]).includes(CURRENT); }
function busy(){ return CACHE.some(l => !l.started && isMember(l)); }
function dot(c){ return `<span class="dot" style="background:${c}"></span>`; }

function row(l){
  const member=isMember(l), full=l.players>=l.max_players, canStart=(l.owner===CURRENT && l.players>=2 && !l.started);
  let buttons="";
  if(l.started){
    if(member) buttons+=`<button data-id="${l.id}" class="gotoBtn">К игре</button>`;
  }else{
    if(member) buttons+=`<button data-id="${l.id}" class="leaveBtn">Покинуть</button>`;
    else if(l.locked) buttons+=`<button data-id="${l.id}" class="joinLocked" ${full?"disabled":""}>Войти</button>`;
    else buttons+=`<button data-id="${l.id}" class="joinOpen" ${full?"disabled":""}>Войти</button>`;
    if(canStart) buttons+=`<button data-id="${l.id}" class="startBtn">Запустить</button>`;
  }
  const cols = Object.values(l.taken_colors||{}).map(dot).join("");
  return `<li class="lobby">
    <div class="name">${l.name} <span class="id">#${l.id}</span></div>
    <div class="meta">${l.players}/${l.max_players} · ${l.locked?'🔒 приватное':'открытое'} ${cols?(' · '+cols):''}</div>
    <div class="actions">${buttons}</div>
  </li>`;
}

function render(){
  const q=(els.search.value||"").toLowerCase();
  const list=q?CACHE.filter(l=> (l.name||"").toLowerCase().includes(q)) : CACHE;
  els.list.innerHTML=list.map(row).join("");

  els.list.querySelectorAll(".joinOpen").forEach(b=>b.onclick=()=>{
    if(busy()) return alert("Сначала покиньте текущее лобби");
    els.joinOpenDlg.dataset.id=b.dataset.id;
    els.joinOpenTitle.textContent=`Лобби #${b.dataset.id} — выберите цвет`;
    els.joinOpenColor.value="red"; els.joinOpenDlg.showModal();
  });
  els.list.querySelectorAll(".joinLocked").forEach(b=>b.onclick=()=>{
    if(busy()) return alert("Сначала покиньте текущее лобби");
    els.joinDlg.dataset.id=b.dataset.id;
    els.joinTitle.textContent=`Лобби #${b.dataset.id} — пароль и цвет`;
    els.joinPass.value=""; els.joinColor.value="red"; els.joinDlg.showModal();
  });
  els.list.querySelectorAll(".leaveBtn").forEach(b=>b.onclick=async()=>{
    await api.leave(b.dataset.id); await refresh();
  });
  els.list.querySelectorAll(".startBtn").forEach(b=>b.onclick=async()=>{
    const r=await api.start(b.dataset.id);
    // сразу в игру
    location.href=`/game?lobby=${b.dataset.id}`;
  });
  els.list.querySelectorAll(".gotoBtn").forEach(b=>b.onclick=()=>{
    location.href=`/game?lobby=${b.dataset.id}`;
  });

  els.createBtn.disabled = busy();
}

async function refresh(){ const data=await api.list(); CACHE=data.lobbies||[]; render(); }

els.createBtn.onclick=()=>{
  els.dlgName.value=""; els.dlgPass.value=""; els.dlgMax.value="4"; els.dlgColor.value="red";
  els.dlg.showModal();
};
els.refreshBtn.onclick=refresh; els.search.oninput=render;
els.dlgCancel.onclick=()=>els.dlg.close();
els.dlgOk.onclick=async()=>{
  try{
    await api.create({name:els.dlgName.value.trim(), password:els.dlgPass.value.trim(), max_players:parseInt(els.dlgMax.value,10), color:els.dlgColor.value});
    els.dlg.close(); await refresh();
  }catch(e){ alert("Ошибка: "+e.message); }
};
els.joinCancel.onclick=()=>els.joinDlg.close();
els.joinOk.onclick=async()=>{
  try{ await api.join(els.joinDlg.dataset.id, els.joinPass.value.trim(), els.joinColor.value);
       els.joinDlg.close(); await refresh(); }catch(e){ alert("Ошибка: "+e.message); }
};
els.joinOpenCancel.onclick=()=>els.joinOpenDlg.close();
els.joinOpenOk.onclick=async()=>{
  try{ await api.join(els.joinOpenDlg.dataset.id, "", els.joinOpenColor.value);
       els.joinOpenDlg.close(); await refresh(); }catch(e){ alert("Ошибка: "+e.message); }
};

refresh();
