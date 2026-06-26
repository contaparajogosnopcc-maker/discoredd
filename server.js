// ============================================================
// Discord Rich Presence - Render Edition
// Servidor único: HTTP + WebSocket + OAuth2
// ============================================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SITE_URL = [process.env.SITE](https://process.env.SITE)_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${SITE_URL}/callback`;

// Validação
if (!CLIENT_ID || !CLIENT_SECRET) {
console.warn('⚠️  AVISO: CLIENT_ID e CLIENT_SECRET não configurados.');
console.warn('   O login com Discord não funcionará até configurar as variáveis de ambiente.');
}

// ============================================================
// ARMAZENAMENTO DE PRESENÇAS
// ============================================================
const sessions = new Map();     // token -> user data
const presences = new Map();    // userId -> presence data

// Limpeza de presenças inativas (> 5 min)
setInterval(() => {
const now = Date.now();
for (const [id, data] of presences) {
if (now - data.lastUpdate > 5 * 60 * 1000) {
presences.delete(id);
}
}
}, 60000);

// ============================================================
// EXPRESS APP
// ============================================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Rota inicial
app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de login → redireciona para Discord
app.get('/login', (req, res) => {
if (!CLIENT_ID) {
return res.status(500).send('CLIENT_ID não configurado');
}

const authUrl = '[https://discord.com/api/oauth2/authorize](https://discord.com/api/oauth2/authorize)?' + new URLSearchParams({
client_id: CLIENT_ID,
redirect_uri: REDIRECT_URI,
response_type: 'code',
scope: 'identify',
prompt: 'consent'
}).toString();

res.redirect(authUrl);
});

// Callback do Discord OAuth2
app.get('/callback', async (req, res) => {
const { code } = req.query;

if (!code) {
return res.status(400).send(htmlPage('Erro', 'Código de autorização não fornecido.'));
}

try {
// Trocar código por token
const tokenRes = await fetch('[https://discord.com/api/oauth2/token](https://discord.com/api/oauth2/token)', {
method: 'POST',
headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
body: new URLSearchParams({
client_id: CLIENT_ID,
client_secret: CLIENT_SECRET,
grant_type: 'authorization_code',
code,
redirect_uri: REDIRECT_URI
})
});

const tokenData = await tokenRes.json();
if (!tokenData.access_token) {
console.error('Token error:', tokenData);
return res.status(400).send(htmlPage('Falha na Autenticação', 'Não foi possível obter o token.'));
}

// Obter dados do usuário
const userRes = await fetch('[https://discord.com/api/users/@me](https://discord.com/api/users/@me)', {
headers: { Authorization: `Bearer ${tokenData.access_token}` }
});
const userData = await userRes.json();

if (!userData.id) {
return res.status(400).send(htmlPage('Erro', 'Não foi possível obter dados do usuário.'));
}

// Gerar token simples
const sessionToken = generateToken();
sessions.set(sessionToken, {
id: userData.id,
username: userData.username,
global_name: userData.global_name,
avatar: userData.avatar,
discriminator: userData.discriminator
});

console.log(`✅ Login: ${userData.username}#${userData.discriminator}`);

// Redirecionar com token na URL
res.redirect(`/?token=${sessionToken}`);

} catch (err) {
console.error('Callback error:', err);
res.status(500).send(htmlPage('Erro Interno', 'Algo deu errado.'));
}
});

// API: Obter dados do usuário
app.get('/api/user', (req, res) => {
const token = (req.headers.authorization || '').replace('Bearer ', '');
const user = sessions.get(token);

if (!user) {
return res.status(401).json({ error: 'Não autenticado' });
}

res.json(user);
});

// API: Atualizar presença
app.post('/api/presence', (req, res) => {
const token = (req.headers.authorization || '').replace('Bearer ', '');
const user = sessions.get(token);

if (!user) {
return res.status(401).json({ error: 'Não autenticado' });
}

const { details, state } = req.body || {};

presences.set(user.id, {
user: {
id: user.id,
username: user.username,
globalName: user.global_name,
avatar: user.avatar
},
presence: {
details: details || 'Usando o site demo',
state: state || 'Explorando o Rich Presence',
startTimestamp: Date.now()
},
lastUpdate: Date.now()
});

broadcastPresences();

res.json({ success: true, message: 'Presença atualizada!' });
});

// API: Listar presenças
app.get('/api/presence', (req, res) => {
const list = [];
presences.forEach((data, userId) => {
list.push({
userId,
username: data.user.username,
globalName: data.user.globalName,
avatar: data.user.avatar,
presence: data.presence,
lastUpdate: data.lastUpdate
});
});
list.sort((a, b) => b.lastUpdate - a.lastUpdate);
res.json(list);
});

// API: Remover presença (logout)
app.delete('/api/presence', (req, res) => {
const token = (req.headers.authorization || '').replace('Bearer ', '');
const user = sessions.get(token);

if (user) {
presences.delete(user.id);
sessions.delete(token);
broadcastPresences();
}

res.json({ success: true });
});

// ============================================================
// WEBSOCKET
// ============================================================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastPresences() {
const list = [];
presences.forEach((data, userId) => {
list.push({
userId,
username: data.user.username,
globalName: data.user.globalName,
avatar: data.user.avatar,
presence: data.presence,
lastUpdate: data.lastUpdate
});
});
list.sort((a, b) => b.lastUpdate - a.lastUpdate);

const message = JSON.stringify({ type: 'presences', data: list });

wss.clients.forEach(client => {
if (client.readyState === WebSocket.OPEN) {
client.send(message);
}
});
}

wss.on('connection', (ws) => {
console.log('🔌 WebSocket conectado');

// Enviar presenças atuais
const list = [];
presences.forEach((data, userId) => {
list.push({
userId,
username: data.user.username,
globalName: data.user.globalName,
avatar: data.user.avatar,
presence: data.presence,
lastUpdate: data.lastUpdate
});
});

ws.send(JSON.stringify({ type: 'presences', data: list }));

ws.on('close', () => console.log('🔌 WebSocket desconectado'));
});

// Ping para manter conexão viva
setInterval(() => {
wss.clients.forEach(client => {
if (client.readyState === WebSocket.OPEN) {
client.ping();
}
});
}, 30000);

// ============================================================
// UTILITÁRIOS
// ============================================================
function generateToken() {
return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function htmlPage(title, message) {
return `
<!DOCTYPE html><html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center}
    .box{background:rgba(255,255,255,.05);padding:40px;border-radius:16px;max-width:400px}
    h1{color:#5865F2;margin-bottom:15px}
    p{margin-bottom:20px;line-height:1.6}
    a{color:#5865F2;text-decoration:none;font-weight:600}
    a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="box">
    <h1>${title}</h1>
    <p>${message}</p>
    <p><a href="/">← Voltar ao início</a></p>
  </div>
</body>
</html>`;
}
// ============================================================
// INICIAR SERVIDOR
// ============================================================
server.listen(PORT, () => {
console.log('═══════════════════════════════════');
console.log('🎮 Discord Rich Presence - Render');
console.log('═══════════════════════════════════');
console.log(`🚀 Rodando na porta ${PORT}`);
console.log(`🔗 ${SITE_URL}`);
console.log('═══════════════════════════════════');
});

