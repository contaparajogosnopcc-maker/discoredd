// ============================================================
// Nexus Chat - Frontend Completo
// ============================================================

let user = null, token = null, ws = null, selectedUserId = null;
let localStream = null, peerConnections = new Map(), inCall = false, callUserId = null;
let allRoles = [];

const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
]};

// ==================== UTILS ====================
function getToken() {
  if (token) return token;
  const p = new URLSearchParams(location.search), t = p.get('token');
  if (t) { token = t; localStorage.setItem('dt', t); history.replaceState({}, document.title, location.pathname); return t; }
  const s = localStorage.getItem('dt'); if (s) { token = s; return s; }
  return null;
}

async function api(path, opts = {}) {
  const t = getToken(), h = { ...opts.headers };
  if (t) h['Authorization'] = 'Bearer ' + t;
  if (opts.body && typeof opts.body === 'string') h['Content-Type'] = 'application/json';
  return fetch(path, { ...opts, headers: h });
}

function showModal(id) { document.getElementById(id).classList.remove('hidden'); document.getElementById('modalOverlay').classList.remove('hidden'); }
function hideModals() { document.querySelectorAll('.modal-card').forEach(m => m.classList.add('hidden')); document.getElementById('modalOverlay').classList.add('hidden'); }
document.getElementById('modalOverlay').onclick = hideModals;

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function playSound() { try { const ctx = new (window.AudioContext||window.webkitAudioContext)(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value=800; g.gain.value=0.1; o.start(); o.stop(ctx.currentTime+0.1); } catch(e) {} }

// ==================== WS ====================
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/?token=' + (getToken() || ''));
  ws.onopen = () => { document.getElementById('statusBar').className = 'status-bar'; document.getElementById('statusText').textContent = 'Conectado'; };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'presences') renderOnline(m.data);
    if (m.type === 'chat') { addMessage(m.message); playSound(); }
    if (m.type === 'chat_history') { clearMessages(); m.messages.forEach(addMessage); }
    if (m.type === 'chat_clear') { clearMessages(); addSystemMsg('Chat limpo pelo Admin'); }
    if (m.type === 'user_kicked') addSystemMsg('Admin removeu um usuário');
    if (m.type === 'user_banned') addSystemMsg('Admin baniu um usuário');
    if (m.type === 'profile_updated' && user && m.userId === user.id) { user.profile = m.profile; updateMyUI(); }
    if (m.type === 'level_up') addSystemMsg('🎉 ' + m.username + ' subiu para o nível ' + m.level + '!');
    if (m.type === 'roles_updated') allRoles = m.roles;
    if (m.type === 'roles') allRoles = m.roles;
    if (m.type === 'new_report' && user?.isAdmin) alert('Nova denúncia recebida!');
    if (m.type === 'call_offer') handleCallOffer(m);
    if (m.type === 'call_answer') handleCallAnswer(m);
    if (m.type === 'call_ice') handleCallICE(m);
    if (m.type === 'call_ended') endCall(false);
    if (m.type === 'call_declined') { alert('Chamada recusada'); endCall(false); }
  };
  ws.onclose = () => { document.getElementById('statusBar').className = 'status-bar disconnected'; setTimeout(connectWS, 3000); };
}
function sendWS(d) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(d)); }

// ==================== INIT ====================
async function init() {
  const t = getToken();
  if (t) { try { const r = await api('/api/user'); if (r.ok) { user = await r.json(); showMain(); connectWS(); return; } } catch(e){} localStorage.removeItem('dt'); token = null; }
  showLogin();
}
function showLogin() { document.getElementById('loginScreen').classList.remove('hidden'); document.getElementById('mainScreen').classList.add('hidden'); }
function showMain() {
  document.getElementById('loginScreen').classList.add('hidden'); document.getElementById('mainScreen').classList.remove('hidden');
  updateMyUI();
  if (user.isAdmin) document.getElementById('adminPanel').classList.remove('hidden');
  document.getElementById('sendBtn').onclick = sendMsg;
  document.getElementById('chatInput').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };
  document.getElementById('attachBtn').onclick = () => document.getElementById('fileInput').click();
  document.getElementById('fileInput').onchange = uploadFile;
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('menuToggle').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('rankingBtn').onclick = openRanking;
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('hangupBtn').onclick = () => endCall(true);
  api('/api/presence', { method: 'POST', body: JSON.stringify({ details: 'No Nexus Chat', state: 'Conversando' }) }).catch(()=>{});
}

function updateMyUI() {
  if (!user) return;
  const av = user.avatar ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64' : 'https://cdn.discordapp.com/embed/avatars/0.png';
  document.getElementById('avatar').src = av;
  const p = user.profile || {};
  document.getElementById('username').textContent = p.nickname || user.global_name || user.username;
  document.getElementById('xpBadge').textContent = 'Lv.' + (p.level || 1);
  if (p.wallpaper) document.getElementById('chatArea').style.backgroundImage = 'url(' + p.wallpaper + ')';
  else document.getElementById('chatArea').style.backgroundImage = '';
}

// ==================== CHAT ====================
async function sendMsg() {
  const input = document.getElementById('chatInput'), text = input.value.trim();
  if (!text) return;
  input.value = '';
  try { await api('/api/messages', { method: 'POST', body: JSON.stringify({ text }) }); } catch(e){}
}

async function uploadFile() {
  const file = document.getElementById('fileInput').files[0];
  if (!file) return;
  const form = new FormData(); form.append('file', file);
  try {
    const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: form });
    const d = await r.json();
    if (d.success) await api('/api/messages', { method: 'POST', body: JSON.stringify({ text: '', fileUrl: d.fileUrl, fileName: d.fileName }) });
  } catch(e){}
  document.getElementById('fileInput').value = '';
}

function clearMessages() { document.getElementById('chatMessages').innerHTML = ''; }

function addMessage(m) {
  const c = document.getElementById('chatMessages');
  const empty = c.querySelector('.chat-empty'); if (empty) empty.remove();
  const isMine = user && m.userId === user.id;
  const av = m.avatar ? 'https://cdn.discordapp.com/avatars/' + m.userId + '/' + m.avatar + '.png?size=32' : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const role = allRoles.find(r => r.id === m.roleId);
  const roleTag = role ? '<span class="role-tag" style="background:' + role.color + '">' + role.name + '</span>' : '';

  const div = document.createElement('div');
  div.className = 'msg ' + (isMine ? 'mine' : 'other') + (m.isAdmin && !isMine ? ' admin' : '');
  if (m.nameColor && !isMine) div.style.color = m.nameColor;
  if (m.bubbleColor && !isMine) div.style.background = m.bubbleColor;

  let content = '<div class="msg-header"><img src="' + av + '" class="msg-avatar"><span class="msg-name" style="color:' + (m.nameColor||'#fff') + '" onclick="openProfile(\'' + m.userId + '\')">' + escapeHtml(m.username) + '</span>' + roleTag + (m.isAdmin?'<span class="msg-badge">ADMIN</span>':'') + '<span class="msg-time">' + time + '</span></div>';
  if (m.text) content += '<div class="msg-text">' + escapeHtml(m.text) + '</div>';
  if (m.fileUrl) {
    if (m.fileUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)) content += '<img src="' + m.fileUrl + '" class="msg-image" onclick="window.open(\'' + m.fileUrl + '\')">';
    else content += '<a href="' + m.fileUrl + '" target="_blank" class="msg-file">📎 ' + escapeHtml(m.fileName||'Arquivo') + '</a>';
  }
  content += '<button class="report-btn" onclick="reportMessage(\'' + m.id + '\')">🚩</button>';
  div.innerHTML = content;
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}

function addSystemMsg(t) {
  const c = document.getElementById('chatMessages');
  const empty = c.querySelector('.chat-empty'); if (empty) empty.remove();
  const d = document.createElement('div'); d.className = 'system-msg'; d.textContent = t; c.appendChild(d); c.scrollTop = c.scrollHeight;
}

// ==================== ONLINE ====================
function renderOnline(list) {
  const c = document.getElementById('onlineList'), badge = document.getElementById('onlineBadge');
  if (!list?.length) { c.innerHTML = '<div class="empty-text">Ninguém online</div>'; if(badge) badge.textContent = '0 online'; return; }
  if(badge) badge.textContent = list.length + ' online';
  c.innerHTML = list.map(p => {
    const av = p.avatar ? 'https://cdn.discordapp.com/avatars/' + p.userId + '/' + p.avatar + '.png?size=64' : 'https://cdn.discordapp.com/embed/avatars/0.png';
    const isMe = user?.id === p.userId;
    const adminClick = user?.isAdmin && !isMe;
    return '<div class="online-item' + (adminClick ? ' admin-target' : '') + '"' + (adminClick ? ' onclick="openAdminModal(\'' + p.userId + '\',\'' + (p.globalName||p.username).replace(/'/g,"\\'") + '\')"' : '') + '><img src="' + av + '" class="online-av"><span class="online-name" style="color:' + (p.nameColor||'#fff') + '" onclick="openProfile(\'' + p.userId + '\')">' + escapeHtml(p.globalName||p.username) + (isMe?' (você)':'') + '</span>' + (!isMe?'<button class="call-btn" onclick="event.stopPropagation();startCall(\'' + p.userId + '\')">📞</button>':'') + '<span class="online-dot"></span></div>';
  }).join('');
}

// ==================== MODALS ====================
function openAdminModal(uid, uname) {
  selectedUserId = uid;
  const modal = document.getElementById('adminModal');
  modal.innerHTML = '<h3>🛡️ Gerenciar ' + uname + '</h3><div class="modal-actions"><button class="btn-warning" id="modalKick">👢 Kick</button><button class="btn-danger" id="modalBan">🔨 Banir</button><button class="btn-call" id="modalCall">📞 Ligar</button><button class="btn-warning" onclick="assignRole(\'' + uid + '\')">👥 Cargo</button></div><button class="btn-cancel" onclick="hideModals()">Cancelar</button>';
  document.getElementById('modalKick').onclick = () => { api('/api/admin/user/'+uid, { method:'DELETE' }); hideModals(); };
  document.getElementById('modalBan').onclick = () => { api('/api/admin/ban/'+uid, { method:'POST' }); hideModals(); };
  document.getElementById('modalCall').onclick = () => { hideModals(); startCall(uid); };
  showModal('adminModal');
}

async function openProfile(uid) {
  const modal = document.getElementById('profileModal');
  modal.innerHTML = '<p>Carregando...</p>'; showModal('profileModal');
  try {
    const r = await fetch('/api/presence'); const presences = await r.json();
    const pres = presences.find(p => p.userId === uid);
    const r2 = await api('/api/ranking'); const ranking = await r2.json();
    const rank = ranking.find(p => p.userId === uid);
    const name = pres ? (pres.globalName||pres.username) : uid;
    modal.innerHTML = '<h3>👤 ' + escapeHtml(name) + '</h3><p>Nível: ' + (rank?.level||1) + ' | XP: ' + (rank?.xp||0) + '</p><p>Rank: #' + (ranking.findIndex(p=>p.userId===uid)+1 || 'N/A') + '</p><button class="btn-cancel" onclick="hideModals()">Fechar</button>';
  } catch(e) { modal.innerHTML = '<p>Erro</p>'; }
}

function openSettings() {
  const p = user?.profile || {};
  document.getElementById('settingsModal').innerHTML = '<h3>🎨 Personalizar</h3><label>Apelido: <input id="setNickname" value="' + (p.nickname||'') + '" maxlength="32"></label><label>Cor do Nome: <input type="color" id="setNameColor" value="' + (p.nameColor||'#ffffff') + '"></label><label>Cor da Bolha: <input type="color" id="setBubbleColor" value="' + (p.bubbleColor||'#21262d') + '"></label><label>Wallpaper (URL): <input id="setWallpaper" value="' + (p.wallpaper||'') + '"></label><label>Bio: <textarea id="setBio" maxlength="200">' + (p.bio||'') + '</textarea></label><button class="btn-discord" onclick="saveSettings()">Salvar</button><button class="btn-cancel" onclick="hideModals()">Cancelar</button>';
  showModal('settingsModal');
}

async function saveSettings() {
  const data = {
    nickname: document.getElementById('setNickname').value,
    nameColor: document.getElementById('setNameColor').value,
    bubbleColor: document.getElementById('setBubbleColor').value,
    wallpaper: document.getElementById('setWallpaper').value,
    bio: document.getElementById('setBio').value
  };
  await api('/api/profile', { method:'PUT', body: JSON.stringify(data) });
  user.profile = data; updateMyUI(); hideModals();
}

async function openRanking() {
  const modal = document.getElementById('rankingModal');
  modal.innerHTML = '<p>Carregando...</p>'; showModal('rankingModal');
  const r = await api('/api/ranking'); const list = await r.json();
  modal.innerHTML = '<h3>🏆 Ranking</h3><div class="ranking-list">' + list.map((p,i) => '<div class="rank-item"><span>#' + (i+1) + '</span><span style="color:' + (p.nameColor||'#fff') + '">' + (p.nickname||p.userId) + '</span><span>Lv.' + p.level + ' (' + p.xp + ' XP)</span></div>').join('') + '</div><button class="btn-cancel" onclick="hideModals()">Fechar</button>';
}

// ROLES
async function openRoleManager() {
  const modal = document.getElementById('roleManagerModal');
  let html = '<h3>👥 Cargos</h3><div id="roleList"></div><input id="newRoleName" placeholder="Nome do cargo"><input type="color" id="newRoleColor" value="#ffffff"><button class="btn-discord" onclick="createRole()">Criar</button><button class="btn-cancel" onclick="hideModals()">Fechar</button>';
  modal.innerHTML = html;
  renderRoles();
  showModal('roleManagerModal');
}
function renderRoles() {
  const list = document.getElementById('roleList'); if (!list) return;
  list.innerHTML = allRoles.map(r => '<div class="role-item"><span style="color:' + r.color + '">' + r.name + '</span><button onclick="deleteRole(\'' + r.id + '\')">🗑️</button></div>').join('');
}
async function createRole() {
  const name = document.getElementById('newRoleName').value, color = document.getElementById('newRoleColor').value;
  if (!name) return;
  await api('/api/admin/roles', { method:'POST', body: JSON.stringify({ name, color }) });
  renderRoles();
}
async function deleteRole(id) { await api('/api/admin/roles/' + id, { method:'DELETE' }); renderRoles(); }
async function assignRole(uid) {
  const roleId = prompt('ID do cargo (vazio para remover):');
  await api('/api/admin/user/' + uid + '/role', { method:'PUT', body: JSON.stringify({ roleId: roleId || null }) });
  hideModals();
}

// REPORTS
async function openReportsPanel() {
  const modal = document.getElementById('reportsModal');
  const r = await api('/api/admin/reports'); const reports = await r.json();
  modal.innerHTML = '<h3>🚩 Denúncias</h3>' + reports.map(rp => '<div class="report-item"><p>Msg: ' + rp.messageId + ' - ' + rp.reason + '</p><p>Por: ' + rp.reporterName + (rp.resolved?' ✅':'') + '</p>' + (!rp.resolved?'<button onclick="resolveReport(\'' + rp.id + '\')">Resolver</button>':'') + '</div>').join('') + '<button class="btn-cancel" onclick="hideModals()">Fechar</button>';
  showModal('reportsModal');
}
async function resolveReport(id) { await api('/api/admin/reports/' + id + '/resolve', { method:'PUT' }); openReportsPanel(); }

// LOGS
async function openLogsPanel() {
  const modal = document.getElementById('logsModal');
  const r = await api('/api/admin/logs'); const logs = await r.json();
  modal.innerHTML = '<h3>📋 Logs</h3>' + logs.map(l => '<p>' + new Date(l.timestamp).toLocaleString() + ' - ' + l.admin + ' ' + l.action + ' ' + l.target + ' ' + l.details + '</p>').join('') + '<button class="btn-cancel" onclick="hideModals()">Fechar</button>';
  showModal('logsModal');
}

async function reportMessage(msgId) { const reason = prompt('Motivo:'); if (reason) api('/api/report', { method:'POST', body: JSON.stringify({ messageId: msgId, reason }) }); }
async function adminClearChat() { if (confirm('Limpar chat?')) await api('/api/admin/chat', { method:'DELETE' }); }

// ==================== CALL ====================
async function startCall(targetId) {
  if (inCall) { alert('Já em chamada'); return; }
  callUserId = targetId; inCall = true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callPanel').classList.remove('hidden');
    const pc = new RTCPeerConnection(ICE);
    peerConnections.set(targetId, pc);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.onicecandidate = e => { if (e.candidate) sendWS({ type:'call_ice', target:targetId, candidate:e.candidate }); };
    pc.ontrack = e => { if (e.streams[0]) { const rv = document.getElementById('remoteVideo'); rv.srcObject = e.streams[0]; rv.play().catch(()=>{}); } };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    sendWS({ type:'call_offer', target:targetId, offer:offer });
  } catch(e) { alert('Erro: microfone/câmera'); endCall(false); }
}
async function handleCallOffer(m) {
  if (inCall) { sendWS({ type:'call_declined', target:m.from }); return; }
  if (!confirm((m.fromName||'Alguém') + ' está ligando. Atender?')) { sendWS({ type:'call_declined', target:m.from }); return; }
  callUserId = m.from; inCall = true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callPanel').classList.remove('hidden');
    const pc = new RTCPeerConnection(ICE);
    peerConnections.set(m.from, pc);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.onicecandidate = e => { if (e.candidate) sendWS({ type:'call_ice', target:m.from, candidate:e.candidate }); };
    pc.ontrack = e => { if (e.streams[0]) { const rv = document.getElementById('remoteVideo'); rv.srcObject = e.streams[0]; rv.play().catch(()=>{}); } };
    await pc.setRemoteDescription(new RTCSessionDescription(m.offer));
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    sendWS({ type:'call_answer', target:m.from, answer:answer });
  } catch(e) { alert('Erro na chamada'); endCall(false); }
}
async function handleCallAnswer(m) { const pc = peerConnections.get(m.from); if (pc) await pc.setRemoteDescription(new RTCSessionDescription(m.answer)); }
async function handleCallICE(m) { const pc = peerConnections.get(m.from); if (pc && m.candidate) await pc.addIceCandidate(new RTCIceCandidate(m.candidate)); }
function endCall(notify) {
  if (notify && callUserId) sendWS({ type:'call_ended', target:callUserId });
  peerConnections.forEach(pc => pc.close()); peerConnections.clear();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('callPanel').classList.add('hidden');
  inCall = false; callUserId = null;
}

async function logout() { endCall(true); await api('/api/presence', { method:'DELETE' }).catch(()=>{}); if(ws) ws.close(); localStorage.removeItem('dt'); token=null; user=null; showLogin(); }

// ==================== START ====================
init();
