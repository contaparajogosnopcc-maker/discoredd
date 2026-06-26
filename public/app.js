// ============================================================
// Discord Site - Chat + Admin + Call
// ============================================================

let user = null, token = null, ws = null, selectedUserId = null;
let localStream = null, peerConnections = new Map();
let inCall = false, callUserId = null;

const ICE_SERVERS = { iceServers: [{ urls: 'stun:[stun.l.google.com:19302](https://stun.l.google.com:19302)' }] };

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

// ============================================================
// WEBSOCKET
// ============================================================
function connectWS() {
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
ws = new WebSocket(`${proto}//${location.host}`);
ws.onopen = () => { document.getElementById('statusBar').className = 'status'; document.getElementById('statusText').textContent = 'Conectado'; };
ws.onmessage = (e) => {
const m = JSON.parse(e.data);
if (m.type === 'presences') renderOnline(m.data);
if (m.type === 'chat') addMessage(m.message);
if (m.type === 'chat_history') { document.getElementById('chatMessages').innerHTML = ''; m.messages.forEach(addMessage); }
if (m.type === 'chat_clear') { document.getElementById('chatMessages').innerHTML = ''; addSystemMsg('🧹 Chat limpo pelo Admin'); }
if (m.type === 'user_kicked') { addSystemMsg('👢 Admin removeu um usuário'); }
if (m.type === 'user_banned') { addSystemMsg('🔨 Admin baniu um usuário'); }
// Call signaling
if (m.type === 'call_offer') handleCallOffer(m);
if (m.type === 'call_answer') handleCallAnswer(m);
if (m.type === 'call_ice') handleCallICE(m);
if (m.type === 'call_ended') endCall(false);
if (m.type === 'call_declined') { alert('Chamada recusada'); endCall(false); }
};
ws.onclose = () => { document.getElementById('statusBar').className = 'status disconnected'; setTimeout(connectWS, 3000); };
}

function sendWS(data) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

// ============================================================
// INIT
// ============================================================
async function init() {
connectWS();
const t = getToken();
if (t) { try { const r = await api('/api/user'); if (r.ok) { user = await r.json(); dash(); return; } } catch(e) {} localStorage.removeItem('dt'); token = null; }
login();
}

function login() { document.getElementById('loginBox').classList.remove('hidden'); document.getElementById('dash').classList.add('hidden'); }

function dash() {
document.getElementById('loginBox').classList.add('hidden'); document.getElementById('dash').classList.remove('hidden');
const av = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : '[https://cdn.discordapp.com/embed/avatars/0.png](https://cdn.discordapp.com/embed/avatars/0.png)';
document.getElementById('avatar').src = av;
document.getElementById('username').textContent = user.global_name || user.username;
const tag = document.getElementById('tag');
if (user.discriminator && user.discriminator !== '0') { tag.textContent = '#' + user.discriminator; tag.style.display = ''; } else tag.style.display = 'none';
if (user.isAdmin) document.getElementById('adminPanel').classList.remove('hidden');
document.getElementById('sendBtn').onclick = sendMsg;
document.getElementById('chatInput').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };
document.getElementById('logoutBtn').onclick = logout;
document.getElementById('modalClose').onclick = closeModal;
document.getElementById('modalKick').onclick = () => adminAction('kick');
document.getElementById('modalBan').onclick = () => adminAction('ban');
document.getElementById('modalCall').onclick = () => { closeModal(); startCall(selectedUserId); };
document.getElementById('hangupBtn').onclick = () => endCall(true);
api('/api/presence', { method: 'POST', body: JSON.stringify({ details: 'No chat', state: 'Conversando' }) }).catch(()=>{});
}

// ============================================================
// CHAT
// ============================================================
async function sendMsg() {
const input = document.getElementById('chatInput'), text = input.value.trim();
if (!text) return; input.value = ''; input.focus();
try { await api('/api/messages', { method: 'POST', body: JSON.stringify({ text }) }); } catch(e) {}
}

function addMessage(m) {
const c = document.getElementById('chatMessages'), isMine = user && m.userId === user.id;
const av = m.avatar ? `https://cdn.discordapp.com/avatars/${m.userId}/${m.avatar}.png?size=32` : '[https://cdn.discordapp.com/embed/avatars/0.png](https://cdn.discordapp.com/embed/avatars/0.png)';
const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const div = document.createElement('div');
div.className = `msg ${isMine ? 'mine' : 'other'} ${m.isAdmin ? 'admin-msg' : ''}`;
div.innerHTML = `<div class="msg-header"><img src="${av}" class="msg-avatar"><span class="msg-name">${m.username}</span>${m.isAdmin ? '<span class="msg-admin-badge">ADMIN</span>' : ''}<span class="msg-time">${time}</span></div><div class="msg-text">${escapeHtml(m.text)}</div>`;
c.appendChild(div); c.scrollTop = c.scrollHeight;
}

function addSystemMsg(t) { const c = document.getElementById('chatMessages'), d = document.createElement('div'); d.className = 'system-msg'; d.textContent = t; c.appendChild(d); c.scrollTop = c.scrollHeight; }
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ============================================================
// ONLINE + ADMIN
// ============================================================
function renderOnline(list) {
const c = document.getElementById('onlineList'), cnt = document.getElementById('onlineCount');
if (!list?.length) { c.innerHTML = '<div class="loading">Ninguem online</div>'; if(cnt) cnt.textContent = ''; return; }
c.innerHTML = list.map(p => {
const av = p.avatar ? `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=32` : '[https://cdn.discordapp.com/embed/avatars/0.png](https://cdn.discordapp.com/embed/avatars/0.png)';
const isMe = user?.id === p.userId, adminClick = user?.isAdmin && !isMe;
return `<div class="online-item ${adminClick ? 'admin-clickable' : ''}" data-userid="${p.userId}" data-username="${p.globalName||p.username}" ${adminClick ? `onclick="openAdminModal('p.userId′,′{p.userId}','p.userId′,′{p.globalName||p.username}')"`: ''}>
      <img src="${av}" class="online-av"><span class="online-name">${p.globalName||p.username} ${isMe?'(voce)':''} ${p.isAdmin?'<span class="admin-badge-sm">ADMIN</span>':''}</span>
      ${!isMe ?`<button class="call-btn" onclick="event.stopPropagation();startCall('${p.userId}')" title="Ligar">📞</button>` : ''}
      <span class="online-dot"></span></div>`;
}).join('');
if(cnt) cnt.textContent = `${list.length} online`;
}

function openAdminModal(uid, uname) {
selectedUserId = uid;
document.getElementById('modalUsername').textContent = uname;
document.getElementById('adminModal').classList.remove('hidden');
}
function closeModal() { document.getElementById('adminModal').classList.add('hidden'); selectedUserId = null; }

async function adminAction(action) {
if (!selectedUserId) return;
const ep = action === 'kick' ? `/api/admin/user/${selectedUserId}` : `/api/admin/ban/${selectedUserId}`;
const method = action === 'kick' ? 'DELETE' : 'POST';
try { await api(ep, { method }); } catch(e) {}
closeModal();
}

async function adminClearChat() {
if (!confirm('Limpar todo o chat?')) return;
try { await api('/api/admin/chat', { method: 'DELETE' }); } catch(e) {}
}

// ============================================================
// CALL (WebRTC)
// ============================================================
async function startCall(targetId) {
if (inCall) { alert('Voce ja esta em uma chamada'); return; }
callUserId = targetId;
inCall = true;

try {
localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
document.getElementById('localVideo').srcObject = localStream;
document.getElementById('callPanel').classList.remove('hidden');

const pc = new RTCPeerConnection(ICE_SERVERS);
peerConnections.set(targetId, pc);

localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

pc.onicecandidate = (e) => {
if (e.candidate) sendWS({ type: 'call_ice', target: targetId, candidate: e.candidate });
};

pc.ontrack = (e) => {
document.getElementById('remoteVideo').srcObject = e.streams[0];
};

const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
sendWS({ type: 'call_offer', target: targetId, offer: offer });

} catch(e) {
alert('Erro ao acessar camera/microfone: ' + e.message);
endCall(false);
}
}

async function handleCallOffer(m) {
if (inCall) { sendWS({ type: 'call_declined', target: m.from }); return; }
if (!confirm(`${m.fromName || 'Alguem'} esta ligando. Atender?`)) {
sendWS({ type: 'call_declined', target: m.from });
return;
}
callUserId = m.from;
inCall = true;

try {
localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
document.getElementById('localVideo').srcObject = localStream;
document.getElementById('callPanel').classList.remove('hidden');

const pc = new RTCPeerConnection(ICE_SERVERS);
peerConnections.set(m.from, pc);

localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

pc.onicecandidate = (e) => {
if (e.candidate) sendWS({ type: 'call_ice', target: m.from, candidate: e.candidate });
};

pc.ontrack = (e) => {
document.getElementById('remoteVideo').srcObject = e.streams[0];
};

await pc.setRemoteDescription(new RTCSessionDescription(m.offer));
const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);
sendWS({ type: 'call_answer', target: m.from, answer: answer });

} catch(e) {
alert('Erro na chamada: ' + e.message);
endCall(false);
}
}

async function handleCallAnswer(m) {
const pc = peerConnections.get(m.from);
if (pc) await pc.setRemoteDescription(new RTCSessionDescription(m.answer));
}

async function handleCallICE(m) {
const pc = peerConnections.get(m.from);
if (pc && m.candidate) await pc.addIceCandidate(new RTCIceCandidate(m.candidate));
}

function endCall(notify) {
if (notify && callUserId) sendWS({ type: 'call_ended', target: callUserId });
peerConnections.forEach(pc => pc.close());
peerConnections.clear();
if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
document.getElementById('localVideo').srcObject = null;
document.getElementById('remoteVideo').srcObject = null;
document.getElementById('callPanel').classList.add('hidden');
inCall = false; callUserId = null;
}

async function logout() {
endCall(true);
await api('/api/presence', { method: 'DELETE' }).catch(()=>{});
if (ws) ws.close();
localStorage.removeItem('dt'); token = null; user = null; login();
}

init();

