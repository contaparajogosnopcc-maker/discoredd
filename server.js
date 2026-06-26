const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_URL = process.env.SITE_URL || 'http://localhost:' + PORT;
const REDIRECT_URI = SITE_URL + '/callback';
const ADMIN_ID = '1112900049765154867';

const sessions = new Map();       // token -> user data
const presences = new Map();      // userId -> presence
const messages = [];
const bannedUsers = new Set();
const MAX_MSG = 200;

// Mapeamento: WebSocket -> userId
const wsToUser = new Map();
// Mapeamento: userId -> WebSocket
const userToWs = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, d] of presences) { if (now - d.lastUpdate > 10*60*1000) presences.delete(id); }
}, 60000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/login', (req, res) => {
  const u = 'https://discord.com/api/oauth2/authorize?' + new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', prompt: 'consent'
  }).toString();
  res.redirect(u);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.send(html('Erro', 'Codigo nao fornecido.'));
  try {
    const tr = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
    });
    const td = await tr.json();
    if (!td.access_token) return res.send(html('Falha','Token invalido.'));
    const ur = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + td.access_token } });
    const ud = await ur.json();
    if (bannedUsers.has(ud.id)) return res.send(html('Banido','Voce foi banido.'));
    const st = Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessions.set(st, {
      id: ud.id, username: ud.username, global_name: ud.global_name,
      avatar: ud.avatar, discriminator: ud.discriminator, isAdmin: ud.id === ADMIN_ID
    });
    console.log('Login: ' + ud.username + (ud.id===ADMIN_ID?' (ADMIN)':''));
    res.redirect('/?token=' + st);
  } catch(e) { res.send(html('Erro','Algo deu errado.')); }
});

function auth(req) {
  const t = (req.headers.authorization||'').replace('Bearer ','');
  return sessions.get(t) || null;
}
function admin(req) { const u = auth(req); return u && u.isAdmin ? u : null; }

app.get('/api/user', (req, res) => {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: 'Nao autenticado' });
  res.json(u);
});

app.post('/api/presence', (req, res) => {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: 'Nao autenticado' });
  const { details, state } = req.body || {};
  presences.set(u.id, {
    user: { id:u.id, username:u.username, globalName:u.global_name, avatar:u.avatar, isAdmin:u.isAdmin },
    presence: { details: details||'No chat', state: state||'Conversando', startTimestamp: Date.now() },
    lastUpdate: Date.now()
  });
  broadcast({ type:'presences', data: getPresences() });
  res.json({ success: true });
});

app.get('/api/presence', (req, res) => res.json(getPresences()));

app.delete('/api/presence', (req, res) => {
  const u = auth(req);
  if (u) { presences.delete(u.id); sessions.delete((req.headers.authorization||'').replace('Bearer ','')); broadcast({ type:'presences', data: getPresences() }); }
  res.json({ success: true });
});

app.get('/api/messages', (req, res) => res.json(messages));

app.post('/api/messages', (req, res) => {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: 'Nao autenticado' });
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Vazio' });
  if (text.length > 500) return res.status(400).json({ error: 'Max 500' });
  const msg = {
    id: Date.now().toString(36)+Math.random().toString(36).substring(2),
    userId: u.id, username: u.global_name||u.username, avatar: u.avatar,
    text: text.trim(), timestamp: Date.now(), isAdmin: u.isAdmin
  };
  messages.push(msg);
  if (messages.length > MAX_MSG) messages.shift();
  broadcast({ type:'chat', message: msg });
  res.json({ success: true, message: msg });
});

app.delete('/api/admin/chat', (req, res) => {
  if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
  messages.length = 0;
  broadcast({ type:'chat_clear' });
  res.json({ success: true });
});

app.delete('/api/admin/user/:id', (req, res) => {
  if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
  const tid = req.params.id;
  if (tid === ADMIN_ID) return res.status(400).json({ error: 'Nao pode se kickar' });
  presences.delete(tid);
  for (const [t,s] of sessions) { if (s.id === tid) sessions.delete(t); }
  broadcast({ type:'presences', data: getPresences() });
  broadcast({ type:'user_kicked', userId: tid });
  res.json({ success: true });
});

app.post('/api/admin/ban/:id', (req, res) => {
  if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
  const tid = req.params.id;
  if (tid === ADMIN_ID) return res.status(400).json({ error: 'Nao pode se banir' });
  bannedUsers.add(tid);
  presences.delete(tid);
  for (const [t,s] of sessions) { if (s.id === tid) sessions.delete(t); }
  for (let i=messages.length-1; i>=0; i--) { if (messages[i].userId===tid) messages.splice(i,1); }
  broadcast({ type:'presences', data: getPresences() });
  broadcast({ type:'user_banned', userId: tid });
  res.json({ success: true });
});

app.delete('/api/admin/ban/:id', (req, res) => {
  if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
  bannedUsers.delete(req.params.id);
  res.json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(d) {
  const m = JSON.stringify(d);
  wss.clients.forEach(c => { if (c.readyState===WebSocket.OPEN) c.send(m); });
}

function getPresences() {
  const l = [];
  presences.forEach((d,uid) => l.push({
    userId:uid, username:d.user.username, globalName:d.user.globalName,
    avatar:d.user.avatar, presence:d.presence, lastUpdate:d.lastUpdate, isAdmin:d.user.isAdmin
  }));
  return l.sort((a,b)=>b.lastUpdate-a.lastUpdate);
}

// Enviar mensagem para um usuário específico
function sendToUser(userId, data) {
  const ws = userToWs.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws, req) => {
  // Extrair token da query string da URL
  const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
  const token = urlParams.get('token');
  
  let userId = 'unknown';
  
  if (token && sessions.has(token)) {
    const userData = sessions.get(token);
    userId = userData.id;
    wsToUser.set(ws, userId);
    userToWs.set(userId, ws);
    console.log('WS conectado: ' + userData.username + ' (' + userId + ')');
  }

  ws.send(JSON.stringify({ type:'presences', data: getPresences() }));
  ws.send(JSON.stringify({ type:'chat_history', messages }));

  ws.on('message', raw => {
    try {
      const data = JSON.parse(raw);
      
      // Roteamento de chamadas - envia apenas para o usuário alvo
      if (['call_offer','call_answer','call_ice','call_ended','call_declined'].includes(data.type)) {
        const targetWs = userToWs.get(data.target);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          // Adiciona informações de quem enviou
          const session = sessions.get(token);
          targetWs.send(JSON.stringify({
            ...data,
            from: userId,
            fromName: session ? (session.global_name || session.username) : 'Usuario'
          }));
        }
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    const uid = wsToUser.get(ws);
    if (uid) {
      userToWs.delete(uid);
      wsToUser.delete(ws);
      console.log('WS desconectado: ' + uid);
    }
  });
});

setInterval(() => wss.clients.forEach(c => { if (c.readyState===WebSocket.OPEN) c.ping(); }), 30000);

function html(t,m) {
  return '<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>'+t+'</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center}.box{background:rgba(255,255,255,.05);padding:40px;border-radius:16px;max-width:400px}h1{color:#5865F2;margin-bottom:15px}p{margin-bottom:20px}a{color:#5865F2;text-decoration:none;font-weight:600}</style></head><body><div class="box"><h1>'+t+'</h1><p>'+m+'</p><p><a href="/">Voltar</a></p></div></body></html>';
}

server.listen(PORT, () => console.log('Site rodando na porta ' + PORT));
