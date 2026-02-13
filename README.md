# Rust VIP Stack (Backend + Bot + Plugin)

Estrutura:
- `backend/`: API Express, Steam OpenID, InfinitePay, webhook, fila de eventos, endpoints plugin.
- `bot/`: Bot Discord com embed único, ações de vinculação/compra e polling de eventos.
- `plugin/`: Plugin Oxide/uMod para aplicar/remover/consultar VIP via backend.

Deploy Discloud:
- Backend com `TYPE=site` e porta `0.0.0.0:8080`.
- Bot com `TYPE=bot`, sem porta e sem URL pública.


Melhorias de integração bot/backend:
- Bot usa intents não-privilegiadas (`Guilds`, `GuildMessages`) para evitar `Used disallowed intents`.
- Bot valida conexão com o backend no startup via `GET /bot/ping`.
- Autenticação do backend para o bot aceita `x-api-key` e `Authorization: Bearer` (com trim), reduzindo falhas por espaços em variáveis.
- Endpoints de vinculação e checkout aceitam `POST` e `GET` (`/auth/steam/link` e `/payments/checkout`) para tolerar proxies que convertam método em redirecionamentos.
- Respostas ephemeral no Discord foram migradas para `flags` para remover aviso de depreciação.
