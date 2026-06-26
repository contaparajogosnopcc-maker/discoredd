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

const sessions = new Map();
const presences = new Map();
const messages = [];
const bannedUsers = new Set();
const MAX_MSG = 200;

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
  if (!code) return res.status(400).send(html('Erro', 'Codigo nao fornecido.'));
  try {
    const tr = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
    });
    const td = await tr.json();
    if (!td.access_token) return res.status(400).send(html('Falha','Token invalido.'));
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
  } catch(e) { res.status(500).send(html('Erro','Algo deu errado.')); }
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

// ADMIN ROTAS
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
  res.json({
