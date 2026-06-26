// ============================================================
// Nexus Chat - Versão Ultra Completa
// ============================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_URL = [process.env.SITE](https://process.env.SITE)_URL || '[http://localhost](http://localhost):' + PORT;
const REDIRECT_URI = SITE_URL + '/callback';
const ADMIN_ID = '1112900049765154867';

// ==================== ARMAZENAMENTO ====================
const sessions = new Map();
const presences = new Map();
const messages = [];
const bannedUsers = new Set();
const userWsMap = new Map();
const reports = [];
const moderationLogs = [];
const MAX_MSG = 500;

// Perfis customizados
const profiles = new Map(); // userId -> { nickname, nameColor, bubbleColor, wallpaper, bio, xp, level, roleId }

// Cargos (roles)
const roles = new Map(); // roleId -> { id, name, color, permissions }
let nextRoleId = 1;

// Upload
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
destination: uploadDir,
filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).substring(2) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ==================== FUNÇÕES AUXILIARES ====================
function getProfile(userId) {
if (!profiles.has(userId)) {
profiles.set(userId, {
nickname: null, nameColor: '#ffffff', bubbleColor: null, wallpaper: null,
bio: '', xp: 0, level: 1, roleId: null
});
}
return profiles.get(userId);
}

function addXP(userId, amount) {
const p = getProfile(userId);
p.xp += amount;
const newLevel = Math.floor(Math.sqrt(p.xp / 50)) + 1;
if (newLevel > p.level) {
p.level = newLevel;
return true; // upou
}
return false;
}

function logModeration(adminUsername, action, target, details) {
moderationLogs.push({
id: Date.now().toString(36),
admin: adminUsername,
action,
target,
details,
timestamp: Date.now()
});
if (moderationLogs.length > 200) moderationLogs.shift();
}

function getDisplayName(userId, sessionData) {
const profile = getProfile(userId);
return profile.nickname || sessionData.global_name || sessionData.username;
}

// ==================== EXPRESS ====================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/login', (req, res) => {
const u = '[https://discord.com/api/oauth2/authorize](https://discord.com/api/oauth2/authorize)?' + new URLSearchParams({
client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', prompt: 'consent'
}).toString();
res.redirect(u);
});

app.get('/callback', async (req, res) => {
const { code } = req.query;
if (!code) return res.send(html('Erro', 'Codigo nao fornecido.'));
try {
const tr = await fetch('[https://discord.com/api/oauth2/token](https://discord.com/api/oauth2/token)', {
method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI })
});
const td = await tr.json();
if (!td.access_token) return res.send(html('Falha', 'Token invalido.'));
const ur = await fetch('[https://discord.com/api/users/@me](https://discord.com/api/users/@me)', { headers: { Authorization: 'Bearer ' + td.access_token } });
const ud = await ur.json();
if (bannedUsers.has(ud.id)) return res.send(html('Banido', 'Voce foi banido.'));
const st = Math.random().toString(36).substring(2) + Date.now().toString(36);
sessions.set(st, {
id: ud.id, username: ud.username, global_name: ud.global_name,
avatar: ud.avatar, discriminator: ud.discriminator, isAdmin: ud.id === ADMIN_ID
});
console.log('Login: ' + ud.username + (ud.id === ADMIN_ID ? ' (ADMIN)' : ''));
res.redirect('/?token=' + st);
} catch (e) { res.send(html('Erro', 'Algo deu errado.')); }
});

function auth(req) {
const t = (req.headers.authorization || '').replace('Bearer ', '');
return sessions.get(t) || null;
}
function admin(req) { const u = auth(req); return u && u.isAdmin ? u : null; }

// ==================== API USUÁRIO ====================
app.get('/api/user', (req, res) => {
const u = auth(req);
if (!u) return res.status(401).json({ error: 'Nao autenticado' });
const profile = getProfile(u.id);
res.json({ ...u, profile });
});

// ==================== API PERFIL ====================
app.put('/api/profile', (req, res) => {
const u = auth(req);
if (!u) return res.status(401).json({ error: 'Nao autenticado' });
const { nickname, nameColor, bubbleColor, wallpaper, bio } = req.body || {};
const p = getProfile(u.id);
if (nickname !== undefined) p.nickname = nickname?.trim().substring(0, 32) || null;
if (nameColor) p.nameColor = nameColor;
if (bubbleColor !== undefined) p.bubbleColor = bubbleColor || null;
if (wallpaper !== undefined) p.wallpaper = wallpaper || null;
if (bio !== undefined) p.bio = bio?.substring(0, 200) || '';
profiles.set(u.id, p);
broadcast({ type: 'profile_updated', userId: u.id, profile: p });
res.json({ success: true, profile: p });
});

// ==================== API PRESENÇA ====================
app.post('/api/presence', (req, res) => {
const u = auth(req);
if (!u) return res.status(401).json({ error: 'Nao autenticado' });
const { details, state } = req.body || {};
presences.set(u.id, {
user: { id: u.id, username: u.username, globalName: u.global_name, avatar: u.avatar, isAdmin: u.isAdmin },
presence: { details: details || 'No Nexus Chat', state: state || 'Conversando', startTimestamp: Date.now() },
lastUpdate: Date.now()
});
broadcast({ type: 'presences', data: getPresences() });
res.json({ success: true });
});

app.get('/api/presence', (req, res) => res.json(getPresences()));

app.delete('/api/presence', (req, res) => {
const u = auth(req);
if (u) { presences.delete(u.id); sessions.delete((req.headers.authorization || '').replace('Bearer ', '')); broadcast({ type: 'presences', data: getPresences() }); }
res.json({ success: true });
});

// ==================== API CHAT ====================
app.get('/api/messages', (req, res) => res.json(messages));

app.post('/api/messages', (req, res) => {
const u = auth(req);
if (!u) return res.status(401).json({ error: 'Nao autenticado' });
let { text, fileUrl, fileName } = req.body || {};
text = text?.trim();
if (!text && !fileUrl) return res.status(400).json({ error: 'Vazio' });
if (text && text.length > 1000) return res.status(400).json({ error: 'Max 1000' });

const displayName = getDisplayName(u.id, u);
const profile = getProfile(u.id);

const msg = {
id: Date.now().toString(36) + Math.random().toString(36).substring(2),
userId: u.id,
username: displayName,
avatar: u.avatar,
nameColor: profile.nameColor,
bubbleColor: profile.bubbleColor,
text: text || '',
fileUrl: fileUrl || null,
fileName: fileName || null,
timestamp: Date.now(),
isAdmin: u.isAdmin,
roleId: profile.roleId
};

messages.push(msg);
if (messages.length > MAX_MSG) messages.shift();

// XP
const upou = addXP(u.id, text ? Math.min(text.length, 50) + 5 : 10);
const updatedProfile = getProfile(u.id);

broadcast({ type: 'chat', message: msg });
if (upou) {
broadcast({ type: 'level_up', userId: u.id, username: displayName, level: updatedProfile.level });
}
res.json({ success: true, message: msg });
});

// ==================== API UPLOAD ====================
app.post('/api/upload', upload.single('file'), (req, res) => {
const u = auth(req);
if (!u) return res.status(401).json({ error: 'Nao autenticado' });
if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });
const fileUrl = '/uploads/' + req.file.filename;
res.json({ success: true, fileUrl, fileName: req.file.originalname });
});

// ==================== API REPORT ====================
app.post('/api/report', (req, res) => {
const u = auth(req);
if (!u) return res.status(401).json({ error: 'Nao autenticado' });
const { messageId, reason } = req.body || {};
if (!messageId) return res.status(400).json({ error: 'Mensagem necessaria' });
reports.push({
id: Date.now().toString(36),
messageId,
reporterId: u.id,
reporterName: getDisplayName(u.id, u),
reason: reason || 'Nao especificado',
timestamp: Date.now(),
resolved: false
});
// Notificar admin
broadcast({ type: 'new_report', report: reports[reports.length - 1] });
res.json({ success: true });
});

app.get('/api/admin/reports', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
res.json(reports);
});

app.put('/api/admin/reports/:id/resolve', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
const report = reports.find(r => r.id === req.params.id);
if (report) report.resolved = true;
res.json({ success: true });
});

// ==================== API RANKING ====================
app.get('/api/ranking', (req, res) => {
const list = [];
profiles.forEach((p, userId) => {
list.push({ userId, nickname: p.nickname, xp: p.xp, level: p.level, nameColor: p.nameColor });
});
list.sort((a, b) => b.xp - a.xp);
res.json(list.slice(0, 20));
});

// ==================== API CARGOS (ADMIN) ====================
app.get('/api/roles', (req, res) => {
res.json(Array.from(roles.values()));
});

app.post('/api/admin/roles', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
const { name, color, permissions } = req.body || {};
if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
const id = 'role_' + nextRoleId++;
roles.set(id, { id, name, color: color || '#ffffff', permissions: permissions || [] });
logModeration('Admin', 'Criar cargo', name, '');
broadcast({ type: 'roles_updated', roles: Array.from(roles.values()) });
res.json({ success: true, role: roles.get(id) });
});

app.put('/api/admin/roles/:id', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
const role = roles.get(req.params.id);
if (!role) return res.status(404).json({ error: 'Cargo nao encontrado' });
const { name, color, permissions } = req.body || {};
if (name) [role.name](https://role.name) = name;
if (color) role.color = color;
if (permissions) role.permissions = permissions;
logModeration('Admin', 'Editar cargo', [role.name](https://role.name), '');
broadcast({ type: 'roles_updated', roles: Array.from(roles.values()) });
res.json({ success: true, role });
});

app.delete('/api/admin/roles/:id', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
const role = roles.get(req.params.id);
if (role) {
roles.delete(req.params.id);
// Remover cargo dos usuários
profiles.forEach(p => { if (p.roleId === req.params.id) p.roleId = null; });
logModeration('Admin', 'Excluir cargo', [role.name](https://role.name), '');
broadcast({ type: 'roles_updated', roles: Array.from(roles.values()) });
}
res.json({ success: true });
});

app.put('/api/admin/user/:id/role', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
const { roleId } = req.body || {};
const p = getProfile(req.params.id);
p.roleId = roleId || null;
profiles.set(req.params.id, p);
logModeration('Admin', 'Atribuir cargo', req.params.id, 'Cargo: ' + (roleId || 'Nenhum'));
broadcast({ type: 'profile_updated', userId: req.params.id, profile: p });
res.json({ success: true });
});

// ==================== API LOGS (ADMIN) ====================
app.get('/api/admin/logs', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
res.json(moderationLogs);
});

// ==================== API ADMIN (EXISTENTES) ====================
app.delete('/api/admin/chat', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
messages.length = 0;
logModeration('Admin', 'Limpar chat', '', '');
broadcast({ type: 'chat_clear' });
res.json({ success: true });
});

app.delete('/api/admin/user/:id', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
const tid = req.params.id;
if (tid === ADMIN_ID) return res.status(400).json({ error: 'Nao pode se kickar' });
presences.delete(tid);
for (const [t, s] of sessions) { if (s.id === tid) sessions.delete(t); }
logModeration('Admin', 'Kick', tid, '');
broadcast({ type: 'presences', data: getPresences() });
broadcast({ type: 'user_kicked', userId: tid });
res.json({ success: true });
});

app.post('/api/admin/ban/:id', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
const tid = req.params.id;
if (tid === ADMIN_ID) return res.status(400).json({ error: 'Nao pode se banir' });
bannedUsers.add(tid);
presences.delete(tid);
for (const [t, s] of sessions) { if (s.id === tid) sessions.delete(t); }
for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].userId === tid) messages.splice(i, 1); }
logModeration('Admin', 'Banir', tid, '');
broadcast({ type: 'presences', data: getPresences() });
broadcast({ type: 'user_banned', userId: tid });
res.json({ success: true });
});

app.delete('/api/admin/ban/:id', (req, res) => {
if (!admin(req)) return res.status(403).json({ error: 'Apenas admin' });
bannedUsers.delete(req.params.id);
logModeration('Admin', 'Desbanir', req.params.id, '');
res.json({ success: true });
});

// ==================== WEBSOCKET ====================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(d) {
const m = JSON.stringify(d);
wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(m); });
}

function sendToUser(userId, data) {
const ws = userWsMap.get(userId);
if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function getPresences() {
const l = [];
presences.forEach((d, uid) => {
const profile = getProfile(uid);
l.push({
userId: uid, username: d.user.username, globalName: d.user.globalName,
avatar: d.user.avatar, presence: d.presence, lastUpdate: d.lastUpdate, isAdmin: d.user.isAdmin,
nameColor: profile.nameColor, roleId: profile.roleId
});
});
return l.sort((a, b) => b.lastUpdate - a.lastUpdate);
}

wss.on('connection', (ws, req) => {
let userId = null;
try {
const url = new URL(req.url, '[http://localhost](http://localhost)');
const token = url.searchParams.get('token');
if (token && sessions.has(token)) {
userId = sessions.get(token).id;
userWsMap.set(userId, ws);
}
} catch (e) { }

ws.send(JSON.stringify({ type: 'presences', data: getPresences() }));
ws.send(JSON.stringify({ type: 'chat_history', messages }));
ws.send(JSON.stringify({ type: 'roles', roles: Array.from(roles.values()) }));

ws.on('message', raw => {
try {
const data = JSON.parse(raw);
if (['call_offer', 'call_answer', 'call_ice', 'call_ended', 'call_declined'].includes(data.type)) {
if (data.target) {
const session = Array.from(sessions.entries()).find(([t, s]) => s.id === userId);
const fromName = session ? getDisplayName(session[1].id, session[1]) : 'Usuario';
sendToUser(data.target, { ...data, from: userId, fromName });
}
}
} catch (e) { }
});

ws.on('close', () => {
if (userId) userWsMap.delete(userId);
});
});

setInterval(() => wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.ping(); }), 30000);

function html(t, m) {
return '<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>' + t + '</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center}.box{background:rgba(255,255,255,.05);padding:40px;border-radius:16px;max-width:400px}h1{color:#5865F2;margin-bottom:15px}p{margin-bottom:20px}a{color:#5865F2;text-decoration:none;font-weight:600}</style></head><body><div class="box"><h1>' + t + '</h1><p>' + m + '</p><p><a href="/">Voltar</a></p></div></body></html>';
}

server.listen(PORT, () => console.log('Nexus Chat rodando na porta ' + PORT));

