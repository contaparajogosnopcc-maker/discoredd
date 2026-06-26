let user = null;
let token = null;
let ws = null;
let selectedUserId = null;
let localStream = null;
let peerConnections = new Map();
let inCall = false;
let callUserId = null;

// Servidores ICE robustos: STUN Google + TURN Metered (gratuito e confiável)
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 2
};

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
  if (opts.body && typeof opts.body === 'string') h['Content-Type'] = 'application/json';
  return fetch(path, { ...opts, headers: h });
}

// ==================== WEBSOCKET ====================
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const t = getToken();
  ws = new WebSocket(proto + '//' + location.host + '/?token=' + (t || ''));

  ws.onopen = () => {
    document.getElementById('statusBar').className = 'status-bar';
    document.getElementById('statusText').textContent = 'Conectado';
  };

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'presences') renderOnline(m.data);
    if (m.type === 'chat') addMessage(m.message);
    if (m.type === 'chat_history') { clearMessages(); m.messages.forEach(addMessage); }
    if (m.type === 'chat_clear') { clearMessages(); addSystemMsg('Chat limpo pelo Admin'); }
    if (m.type === 'user_kicked') { addSystemMsg('Admin removeu um usuário'); }
    if (m.type === 'user_banned') { addSystemMsg('Admin baniu um usuário'); }
    if (m.type === 'call_offer') handleCallOffer(m);
    if (m.type === 'call_answer') handleCallAnswer(m);
    if (m.type === 'call_ice') handleCallICE(m);
    if (m.type === 'call_ended') endCall(false);
    if (m.type === 'call_declined') { alert('Chamada recusada'); endCall(false); }
  };

  ws.onclose = () => {
    document.getElementById('statusBar').className = 'status-bar disconnected';
    document.getElementById('statusText').textContent = 'Reconectando...';
    setTimeout(connectWS, 3000);
  };
}

function sendWS(data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ==================== INIT ====================
async function init() {
  const t = getToken();
  if (t) {
    try {
      const r = await api('/api/user');
      if (r.ok) {
        user = await r.json();
        showMain();
        connectWS();
        return;
      }
    } catch (e) {}
    localStorage.removeItem('dt');
    token = null;
  }
  showLogin();
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('mainScreen').classList.add('hidden');
}

function showMain() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('mainScreen').classList.remove('hidden');

  const av = user.avatar
    ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64'
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  document.getElementById('avatar').src = av;
  document.getElementById('username').textContent = user.global_name || user.username;
  const tag = document.getElementById('tag');
  if (user.discriminator && user.discriminator !== '0') {
    tag.textContent = '#' + user.discriminator;
    tag.style.display = '';
  } else {
    tag.style.display = 'none';
  }

  if (user.isAdmin) document.getElementById('adminPanel').classList.remove('hidden');

  document.getElementById('sendBtn').onclick = sendMsg;
  document.getElementById('chatInput').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('menuToggle').onclick = toggleSidebar;
  document.getElementById('modalClose').onclick = closeModal;
  document.getElementById('modalKick').onclick = () => adminAction('kick');
  document.getElementById('modalBan').onclick = () => adminAction('ban');
  document.getElementById('modalCall').onclick = () => { closeModal(); startCall(selectedUserId); };
  document.getElementById('hangupBtn').onclick = () => endCall(true);

  api('/api/presence', { method: 'POST', body: JSON.stringify({ details: 'No Nexus Chat', state: 'Conversando' }) }).catch(() => {});
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

document.addEventListener('click', function(e) {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('menuToggle');
  if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
    if (!sidebar.contains(e.target) && e.target !== toggle) {
      sidebar.classList.remove('open');
    }
  }
});

// ==================== CHAT ====================
async function sendMsg() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.focus();
  try { await api('/api/messages', { method: 'POST', body: JSON.stringify({ text }) }); } catch (e) {}
}

function clearMessages() {
  document.getElementById('chatMessages').innerHTML = '';
}

function addMessage(m) {
  const c = document.getElementById('chatMessages');
  const empty = c.querySelector('.chat-empty');
  if (empty) empty.remove();

  const isMine = user && m.userId === user.id;
  const av = m.avatar
    ? 'https://cdn.discordapp.com/avatars/' + m.userId + '/' + m.avatar + '.png?size=32'
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const div = document.createElement('div');
  div.className = 'msg ' + (isMine ? 'mine' : 'other') + (m.isAdmin && !isMine ? ' admin' : '');
  div.innerHTML =
    '<div class="msg-header">' +
    '<img src="' + av + '" class="msg-avatar">' +
    '<span class="msg-name">' + escapeHtml(m.username) + '</span>' +
    (m.isAdmin ? '<span class="msg-badge">ADMIN</span>' : '') +
    '<span class="msg-time">' + time + '</span>' +
    '</div>' +
    '<div class="msg-text">' + escapeHtml(m.text) + '</div>';
  c.appendChild(div);
  c.scrollTop = c.scrollHeight;
}

function addSystemMsg(t) {
  const c = document.getElementById('chatMessages');
  const empty = c.querySelector('.chat-empty');
  if (empty) empty.remove();
  const d = document.createElement('div');
  d.className = 'system-msg';
  d.textContent = t;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

// ==================== ONLINE ====================
function renderOnline(list) {
  const c = document.getElementById('onlineList');
  const badge = document.getElementById('onlineBadge');
  if (!list || !list.length) {
    c.innerHTML = '<div class="empty-text">Ninguém online</div>';
    if (badge) badge.textContent = '0 online';
    return;
  }
  if (badge) badge.textContent = list.length + ' online';

  c.innerHTML = list.map(function(p) {
    var av = p.avatar
      ? 'https://cdn.discordapp.com/avatars/' + p.userId + '/' + p.avatar + '.png?size=64'
      : 'https://cdn.discordapp.com/embed/avatars/0.png';
    var isMe = user && user.id === p.userId;
    var isAdminTarget = user && user.isAdmin && !isMe;
    var clickHandler = isAdminTarget ? ' onclick="openAdminModal(\'' + p.userId + '\',\'' + (p.globalName || p.username).replace(/'/g, "\\'") + '\')"' : '';
    return '<div class="online-item' + (isAdminTarget ? ' admin-target' : '') + '"' + clickHandler + '>' +
      '<img src="' + av + '" class="online-av" loading="lazy">' +
      '<span class="online-name">' + escapeHtml(p.globalName || p.username) + (isMe ? ' (você)' : '') + (p.isAdmin ? ' <span class="admin-badge-sm">ADMIN</span>' : '') + '</span>' +
      (!isMe ? '<button class="call-btn" onclick="event.stopPropagation();startCall(\'' + p.userId + '\')">📞</button>' : '') +
      '<span class="online-dot"></span>' +
      '</div>';
  }).join('');
}

// ==================== ADMIN ====================
function openAdminModal(uid, uname) {
  selectedUserId = uid;
  document.getElementById('modalUsername').textContent = uname;
  document.getElementById('adminModal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('adminModal').classList.add('hidden');
  selectedUserId = null;
}
async function adminAction(action) {
  if (!selectedUserId) return;
  var ep = action === 'kick' ? '/api/admin/user/' + selectedUserId : '/api/admin/ban/' + selectedUserId;
  var method = action === 'kick' ? 'DELETE' : 'POST';
  try { await api(ep, { method: method }); } catch (e) {}
  closeModal();
}
async function adminClearChat() {
  if (!confirm('Limpar todas as mensagens?')) return;
  try { await api('/api/admin/chat', { method: 'DELETE' }); } catch (e) {}
}

// ==================== CHAMADA (CORRIGIDA) ====================
async function startCall(targetId) {
  if (inCall) { alert('Você já está em chamada'); return; }
  callUserId = targetId;
  inCall = true;

  try {
    // Solicitar áudio + vídeo com tratamento explícito
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      console.log('📹 Stream local obtido: áudio + vídeo');
    } catch (e) {
      console.warn('⚠️ Câmera não disponível, usando apenas áudio:', e.message);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('🎤 Stream local obtido: apenas áudio');
    }

    localStream = stream;
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callPanel').classList.remove('hidden');

    const pc = new RTCPeerConnection(ICE);
    peerConnections.set(targetId, pc);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('🧊 ICE candidate:', e.candidate.type, e.candidate.address || '');
        sendWS({ type: 'call_ice', target: targetId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      console.log('📥 Track remoto recebido:', e.track.kind);
      if (e.streams && e.streams[0]) {
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.play().catch(err => console.warn('🔇 Autoplay:', err));
      }
    };

    let disconnectTimer = null;
    pc.oniceconnectionstatechange = () => {
      console.log('🔗 ICE state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected') {
        // Aguardar 10 segundos antes de encerrar (pode reconectar)
        if (!disconnectTimer) {
          disconnectTimer = setTimeout(() => {
            console.log('⏰ Tempo esgotado, encerrando chamada');
            endCall(false);
          }, 10000);
        }
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      } else if (pc.iceConnectionState === 'failed') {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        endCall(false);
      }
    };

    pc.onconnectionstatechange = () => console.log('📡 Connection state:', pc.connectionState);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendWS({ type: 'call_offer', target: targetId, offer: offer });

  } catch (e) {
    alert('Erro ao acessar microfone: ' + e.message);
    console.error(e);
    endCall(false);
  }
}

async function handleCallOffer(m) {
  if (inCall) { sendWS({ type: 'call_declined', target: m.from }); return; }
  if (!confirm((m.fromName || 'Alguém') + ' está ligando. Atender?')) {
    sendWS({ type: 'call_declined', target: m.from });
    return;
  }

  callUserId = m.from;
  inCall = true;

  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      console.log('📹 Stream local obtido: áudio + vídeo');
    } catch (e) {
      console.warn('⚠️ Câmera não disponível, usando apenas áudio:', e.message);
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('🎤 Stream local obtido: apenas áudio');
    }

    localStream = stream;
    document.getElementById('localVideo').srcObject = localStream;
    document.getElementById('callPanel').classList.remove('hidden');

    const pc = new RTCPeerConnection(ICE);
    peerConnections.set(m.from, pc);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log('🧊 ICE candidate:', e.candidate.type);
        sendWS({ type: 'call_ice', target: m.from, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      console.log('📥 Track remoto recebido:', e.track.kind);
      if (e.streams && e.streams[0]) {
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.play().catch(err => console.warn('🔇 Autoplay:', err));
      }
    };

    let disconnectTimer = null;
    pc.oniceconnectionstatechange = () => {
      console.log('🔗 ICE state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected') {
        disconnectTimer = setTimeout(() => {
          console.log('⏰ Tempo esgotado, encerrando chamada');
          endCall(false);
        }, 10000);
      } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
      } else if (pc.iceConnectionState === 'failed') {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        endCall(false);
      }
    };

    pc.onconnectionstatechange = () => console.log('📡 Connection state:', pc.connectionState);

    await pc.setRemoteDescription(new RTCSessionDescription(m.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendWS({ type: 'call_answer', target: m.from, answer: answer });

  } catch (e) {
    alert('Erro na chamada: ' + e.message);
    console.error(e);
    endCall(false);
  }
}

async function handleCallAnswer(m) {
  const pc = peerConnections.get(m.from);
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(m.answer));
      console.log('✅ Answer aplicado');
    } catch (e) {
      console.error('Erro ao aplicar answer:', e);
    }
  }
}

async function handleCallICE(m) {
  const pc = peerConnections.get(m.from);
  if (pc && m.candidate) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(m.candidate));
    } catch (e) {
      console.error('Erro ICE:', e);
    }
  }
}

function endCall(notify) {
  if (notify && callUserId) sendWS({ type: 'call_ended', target: callUserId });
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  document.getElementById('localVideo').srcObject = null;
  const remoteVideo = document.getElementById('remoteVideo');
  if (remoteVideo) remoteVideo.srcObject = null;
  document.getElementById('callPanel').classList.add('hidden');
  inCall = false;
  callUserId = null;
  console.log('📴 Chamada encerrada');
}

// ==================== LOGOUT ====================
async function logout() {
  endCall(true);
  await api('/api/presence', { method: 'DELETE' }).catch(() => {});
  if (ws) ws.close();
  localStorage.removeItem('dt');
  token = null;
  user = null;
  showLogin();
}

// ==================== INICIAR ====================
init();
