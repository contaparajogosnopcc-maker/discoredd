const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${SITE_URL}/callback`;

const sessions = new Map();
const presences = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, data] of presences) {
    if (now - data.lastUpdate > 5 * 60 * 1000) presences.delete(id);
  }
}, 60000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/login', (req, res) => {
  const authUrl = 'https://discord.com/api/oauth2/authorize?' + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
    prompt: 'consent'
  }).toString();
  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Código não fornecido');
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.status(400).send('Falha no token');
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    const userData = await userRes.json();
    const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessions.set(sessionToken, { id: userData.id, username: userData.username, global_name: userData.global_name, avatar: userData.avatar, discriminator: userData.discriminator });
    res.redirect(`/?token=${sessionToken}`);
  } catch (err) {
    res.status(500).send('Erro interno');
  }
});

app.get('/api/user', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  res.json(user);
});

app.post('/api/presence', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  const { details, state } = req.body || {};
  presences.set(user.id, {
    user: { id: user.id, username: user.username, globalName: user.global_name, avatar: user.avatar },
    presence: { details: details || 'Usando o site demo', state: state || 'Explorando o Rich Presence', startTimestamp: Date.now() },
    lastUpdate: Date.now()
  });
  broadcastPresences();
  res.json({ success: true });
});

app.get('/api/presence', (req, res) => {
  const list = [];
  presences.forEach((data, userId) => list.push({ userId, username: data.user.username, globalName: data.user.globalName, avatar: data.user.avatar, presence: data.presence, lastUpdate: data.lastUpdate }));
  list.sort((a, b) => b.lastUpdate - a.lastUpdate);
  res.json(list);
});

app.delete('/api/presence', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = sessions.get(token);
  if (user) { presences.delete(user.id); sessions.delete(token); broadcastPresences(); }
  res.json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastPresences() {
  const list = [];
  presences.forEach((data, userId) => list.push({ userId, username: data.user.username, globalName: data.user.globalName, avatar: data.user.avatar, presence: data.presence, lastUpdate: data.lastUpdate }));
  const msg = JSON.stringify({ type: 'presences', data: list });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

wss.on('connection', ws => {
  const list = [];
  presences.forEach((data, userId) => list.push({ userId, username: data.user.username, globalName: data.user.globalName, avatar: data.user.avatar, presence: data.presence, lastUpdate: data.lastUpdate }));
  ws.send(JSON.stringify({ type: 'presences', data: list }));
});

setInterval(() => wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.ping(); }), 30000);

server.listen(PORT, () => console.log(`🚀 Rodando na porta ${PORT}`));
