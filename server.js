// ============================================================
// Discord Admin Panel + Chat - Site Final
// Admin ID: 1112900049765154867
// ============================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_URL = [process.env.SITE](https://process.env.SITE)_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${SITE_URL}/callback`;
const ADMIN_ID = '1112900049765154867';

const sessions = new Map();
const presences = new Map();
const messages = [];
const bannedUsers = new Set();
const MAX_MESSAGES = 200;

setInterval(() => {
const now = Date.now();
for (const [id, data] of presences) {
if (now - data.lastUpdate > 10 * 60 * 1000) presences.delete(id);
}
}, 60000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/login', (req, res) => {
const authUrl = '[https://discord.com/api/oauth2/authorize](https://discord.com/api/oauth2/authorize)?' + new URLSearchParams({
client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', prompt: 'consent'
}).toString();
res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
const { code } = req.query;
if (!code) return res.status(400).send(htmlPage('Erro', 'Código não fornecido.'));
try {
const tokenRes = await fetch('[https://discord.com/api/oauth2/token](https://discord.com/api/oauth2/token)', {
method: 'POST',
headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
});
const tokenData = await tokenRes.json();
if (!tokenData.access_token) return res.status(400).send(htmlPage('Falha', 'Token inválido.'));

const userRes = await fetch('[https://discord.com/api/users/@me](https://discord.com/api/users/@me)', {
headers: { Authorization: `Bearer ${tokenData.access_token}` }
});
const userData = await userRes.json();

if (bannedUsers.has(userData.id)) return res.send(htmlPage('Banido', 'Você foi banido deste site.'));

const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
sessions.set(sessionToken, {
id: userData.id, username: userData.username, global_name: userData.global_name,
avatar: userData.avatar, discriminator: userData.discriminator, isAdmin: userData.id === ADMIN_ID
});

console.log(`✅ Login: ${userData.username} ${userData.id === ADMIN_ID ? '(ADMIN)' : ''}`);
res.redirect(`/?token=${sessionToken}`);
} catch (err) {
res.status(500).send(htmlPage('Erro Interno', 'Algo deu errado.'));
}
});

function authUser(req) {
const token = (req.headers.authorization || '').replace('Bearer ', '');
return sessions.get(token) || null;
}

function requireAdmin(req) {
const user = authUser(req);
if (!user || !user.isAdmin) return null;
return user;
}

// API User
app.get('/api/user', (req, res) => {
const user = authUser(req);
if (!user) return res.status(401).json({ error: 'Não autenticado' });
res.json(user);
});

// API Presence
app.post('/api/presence', (req, res) => {
const user = authUser(req);
if (!user) return res.status(401).json({ error: 'Não autenticado' });
const { details, state } = req.body || {};
presences.set(user.id, {
user: { id: user.id, username: user.username, globalName: user.global_name, avatar: user.avatar, isAdmin: user.isAdmin },
presence: { details: details || 'No chat', state: state || 'Conversando', startTimestamp: Date.now() },
lastUpdate: Date.now()
});
broadcast({ type: 'presences', data: getPresenceList() });
res.json({ success: true });
});

app.get('/api/presence', (req, res) => res.json(getPresenceList()));

app.delete('/api/presence', (req, res) => {
const user = authUser(req);
if (user) { presences.delete(user.id); sessions.delete((req.headers.authorization || '').replace('Bearer ', '')); broadcast({ type: 'presences', data: getPresenceList() }); }
res.json({ success: true });
});

// API Chat
app.get('/api/messages', (req, res) => res.json(messages));

app.post('/api/messages', (req, res) => {
const user = authUser(req);
if (!user) return res.status(401).json({ error: 'Não autenticado' });
const { text } = req.body || {};
if (!text?.trim()) return res.status(400).json({ error: 'Mensagem vazia' });
if (text.length > 500) return res.status(400).json({ error: 'Máx 500 caracteres' });

const msg = {
id: Date.now().toString(36) + Math.random().toString(36).substring(2),
userId: user.id, username: user.global_name || user.username,
avatar: user.avatar, text: text.trim(), timestamp: Date.now(), isAdmin: user.isAdmin
};
messages.push(msg);
if (messages.length > MAX_MESSAGES) messages.shift();
broadcast({ type: 'chat', message: msg });
res.json({ success: true, message: msg });
});

// API Admin
app.delete('/api/admin/chat/clear', (req, res) => {
if (!requireAdmin(req)) return res.status(403).json({ error: 'Apenas admin.' });
messages.length = 0;
broadcast({ type: 'chat_clear', clearedBy: 'Admin' });
res.json({ success: true });
});

app.delete('/api/admin/user/:userId', (req, res) => {
if (!requireAdmin(req)) return res.status(403).json({ error: 'Apenas admin.' });
const targetId = req.params.userId;
if (targetId === ADMIN_ID) return res.status(400).json({ error: 'Não pode se kickar.' });
presences.delete(targetId);
for (const [t, s] of sessions) { if (s.id === targetId) sessions.delete(t); }
broadcast({ type: 'presences', data: getPresenceList() });
broadcast({ type: 'user_kicked', userId: targetId });
res.json({ success: true });
});

app.post('/api/admin/ban/:userId', (req, res) => {
if (!requireAdmin(req)) return res.status(403).json({ error: 'Apenas admin.' });
const targetId = req.params.userId;
if (targetId === ADMIN_ID) return res.status(400).json({ error: 'Não pode se banir.' });
bannedUsers.add(targetId);
presences.delete(targetId);
for (const [t, s] of sessions) { if (s.id === targetId) sessions.delete(t); }
for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].userId === targetId) messages.splice(i, 1); }
broadcast({ type: 'presences', data: getPresenceList() });
broadcast({ type: 'user_banned', userId: targetId });
res.json({ success: true });
});

app.delete('/api/admin/ban/:userId', (req, res) => {
if (!requireAdmin(req)) return res.status(403).json({ error: 'Apenas admin.' });
bannedUsers.delete(req.params.userId);
res.json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(data) {
const msg = JSON.stringify(data);
wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function getPresenceList() {
const list = [];
presences.forEach((data, userId) => list.push({
userId, username: data.user.username, globalName: data.user.globalName,
avatar: data.user.avatar, presence: data.presence, lastUpdate: data.lastUpdate, isAdmin: data.user.isAdmin
}));
return list.sort((a, b) => b.lastUpdate - a.lastUpdate);
}

wss.on('connection', ws => {
ws.send(JSON.stringify({ type: 'presences', data: getPresenceList() }));
ws.send(JSON.stringify({ type: 'chat_history', messages }));
});

setInterval(() => wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.ping(); }), 30000);

function htmlPage(title, msg) {
return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${title}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center}.box{background:rgba(255,255,255,.05);padding:40px;border-radius:16px;max-width:400px}h1{color:#5865F2;margin-bottom:15px}p{margin-bottom:20px}a{color:#5865F2;text-decoration:none;font-weight:600}</style></head><body><div class="box"><h1>${title}</h1><p>${msg}</p><p><a href="/">← Voltar</a></p></div></body></html>`;
}

server.listen(PORT, () => console.log(`🚀 Site rodando na porta ${PORT} | Admin ID: ${ADMIN_ID}`));

