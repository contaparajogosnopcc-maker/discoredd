// ============================================================
// Discord Rich Presence - Render Edition
// WebSocket real + Fallback para polling
// ============================================================

let user = null;
let token = null;
let ws = null;
let start = null;
let timer = null;
let reconnectTimer = null;

const API = ''; // Mesmo servidor

// ============================================================
// TOKEN
// ============================================================
function getToken() {
  if (token) return token;
  const p = new URLSearchParams(location.search);
  const t = p.get('token');
  if (t) { token = t; localStorage.setItem('dt', t); history.replaceState({}, document.title, location.pathname); return t; }
  const s = localStorage.getItem('dt');
  if (s) { token = s; return s; }
  return null;
}

async function api(path, opts = {}) {
  const t = getToken();
  const h = { ...opts.headers };
  if (t) h['Authorization'] = 'Bearer ' + t;
  if (opts.body) h['Content-Type'] = 'application/json';
  return fetch(API + path, { ...opts, headers: h });
}

// ============================================================
// WEBSOCKET
// ============================================================
function connectWS() {
  if (ws) { ws.close(); ws = null; }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => {
    console.log('✅ WebSocket conectado');
    document.getElementById('statusText').textContent = 'Conectado (WS)';
    document.getElementById('status').className = 'status';
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'presences') {
        renderOnline(msg.data);
      }
    } catch {}
  };

  ws.onclose = () => {
    console.log('❌ WebSocket fechado');
    document.getElementById('statusText').textContent = 'Reconectando...';
    document.getElementById('status').className = 'status reconnecting';
    // Reconectar em 3 segundos
    reconnectTimer = setTimeout(connectWS, 3000);
  };

  ws.onerror = () => {
    console.log('⚠️ Erro WebSocket, usando polling');
    document.getElementById('statusText').textContent = 'Online (polling)';
  };
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================
async function init() {
  connectWS();

  const t = getToken();
  if (t) {
    try {
      const r = await api('/api/user');
      if (r.ok) { user = await r.json(); dash(); return; }
    } catch(e) {}
    localStorage.removeItem('dt'); token = null;
  }
  login();
}

function login() {
  document.getElementById('loginBox').classList.remove('hidden');
  document.getElementById('dash').classList.add('hidden');
}

function dash() {
  document.getElementById('loginBox').classList.add('hidden');
  document.getElementById('dash').classList.remove('hidden');

  const av = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : 'https://cdn.discordapp.com/embed/avatars/0.png';
  document.getElementById('avatar').src = av;
  document.getElementById('prevAvatar').src = av;
  const name = user.global_name || user.username;
  document.getElementById('username').textContent = name;
  document.getElementById('prevName').textContent = name;
  
  const tag = document.getElementById('tag');
  if (user.discriminator && user.discriminator !== '0') {
    tag.textContent = '#' + user.discriminator;
    tag.style.display = '';
  } else {
    tag.style.display = 'none';
  }

  document.getElementById('detailsInput').value = 'Explorando o site demo';
  document.getElementById('stateInput').value = 'Testando Rich Presence';
  updatePreview();
  
  document.getElementById('updateBtn').onclick = update;
  document.getElementById('logoutBtn').onclick = logout;
  
  start = Date.now();
  timer = setInterval(() => {
    const e = Math.floor((Date.now() - start) / 1000);
    document.getElementById('prevTime').textContent = `⏱️ ${Math.floor(e/60)} min ${e%60}s ativo`;
  }, 1000);
  
  setTimeout(update, 500);
}

// ============================================================
// ATUALIZAR PRESENÇA
// ============================================================
async function update() {
  const d = document.getElementById('detailsInput').value || 'Explorando o site demo';
  const s = document.getElementById('stateInput').value || 'Testando Rich Presence';
  msg('Atualizando...');
  try {
    const r = await api('/api/presence', { method: 'POST', body: JSON.stringify({ details: d, state: s }) });
    if (r.ok) { msg('✅ Atualizado!'); updatePreview(); start = Date.now(); setTimeout(() => msg(''), 2500); }
    else msg('❌ Erro', true);
  } catch(e) { msg('❌ Conexão', true); }
}

function updatePreview() {
  document.getElementById('prevDetails').textContent = document.getElementById('detailsInput').value;
  document.getElementById('prevState').textContent = document.getElementById('stateInput').value;
}

// ============================================================
// RENDER ONLINE
// ============================================================
function renderOnline(list) {
  const c = document.getElementById('onlineList');
  const cnt = document.getElementById('onlineCount');
  
  if (!list?.length) {
    c.innerHTML = '<div class="loading">Nenhum usuário online</div>';
    if(cnt) cnt.textContent = '';
    return;
  }
  
  c.innerHTML = list.map(p => {
    const av = p.avatar ? `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=64` : 'https://cdn.discordapp.com/embed/avatars/0.png';
    const me = user?.id === p.userId;
    return `<div class="online-card"><img src="${av}" class="online-av"><div class="online-info"><div class="online-name">${p.globalName||p.username} ${me?'<span style="color:#6366F1">(você)</span>':''}</div><div class="online-det">${p.presence.details} · ${ago(p.lastUpdate)}</div></div><div class="online-dot"></div></div>`;
  }).join('');
  
  if(cnt) cnt.textContent = `${list.length} online`;
}

function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.floor(s/60)}min`;
  return `há ${Math.floor(s/3600)}h`;
}

// ============================================================
// LOGOUT
// ============================================================
async function logout() {
  await api('/api/presence', { method: 'DELETE' }).catch(()=>{});
  clearInterval(timer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) ws.close();
  localStorage.removeItem('dt');
  token = null; user = null;
  login();
}

// ============================================================
// MENSAGEM
// ============================================================
function msg(m, e) {
  const el = document.getElementById('msg');
  el.textContent = m;
  el.className = 'msg' + (m ? ' show' : '') + (e ? ' err' : '');
}

// ============================================================
// INICIAR
// ============================================================
console.log('🎮 Discord Rich Presence - Render Edition');
init();
