# Rust VIP Stack (Backend + Bot + Plugin)

Estrutura:
- `backend/`: API Express, Steam OpenID, InfinitePay, webhook, fila de eventos, endpoints plugin.
- `bot/`: Bot Discord com embed único, ações de vinculação/compra e polling de eventos.
- `plugin/`: Plugin Oxide/uMod para aplicar/remover/consultar VIP via backend.

Deploy Discloud:
- Backend com `TYPE=site` e porta `0.0.0.0:8080`.
- Bot com `TYPE=bot`, sem porta e sem URL pública.
