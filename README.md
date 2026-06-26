
# 🎮 Discord Rich Presence - Render

Site que conecta sua conta Discord e mostra atividades em tempo real via **WebSocket**.

## ✨ Funcionalidades

- 🔐 Login seguro via OAuth2 do Discord
- 👤 Perfil do usuário (avatar, nome, tag)
- ⚡ **WebSocket real** (sem polling!)
- 🟢 Lista de usuários online com suas atividades
- 🎨 Preview do Rich Presence

## 🚀 Deploy no Render

### 1. Discord Developer Portal

- Acesse [https://discord.com/developers/applications](https://discord.com/developers/applications)
- Crie uma aplicação
- Em **OAuth2 → Redirects**, adicione:

```
https://seu-app.onrender.com/callback
```

### 2. Deploy no Render

- Acesse [https://render.com](https://render.com)
- Crie conta com GitHub
- Clique **New +** → **Web Service**
- Conecte o repositório
- Configure:

- **Name**: discord-presence
- **Runtime**: Node
- **Build Command**: `npm install`
- **Start Command**: `node server.js`

### 3. Variáveis de Ambiente (no Render)

- `CLIENT_ID` → Client ID do Discord
- `CLIENT_SECRET` → Client Secret do Discord
- `SITE_URL` → `https://seu-app.onrender.com`

### 4. Pronto!

O site estará no ar em `https://seu-app.onrender.com`

## 🖥️ Teste Local

```
npm install
CLIENT_ID=xxx CLIENT_SECRET=yyy SITE_URL=http://localhost:3000 node server.js
```

Acesse [http://localhost:3000](http://localhost:3000)

