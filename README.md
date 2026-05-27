# Luhun CRM Backend

Node.js API + admin dashboard for **Luhun's Official** (products, orders, inventory, storefront API).

## Local run

```bash
npm install
cp .env.example .env   # edit secrets
node server.js
```

- API: `http://localhost:4000/api`
- Admin: `http://localhost:4000/admin` (login: **Luhun** / **Luhun2026!** after bootstrap)
- Storefront (if `luhun-official` is sibling folder): `http://localhost:4000/store`

## Render deploy

| Setting | Value |
|--------|--------|
| Build | `npm install` |
| Start | `node server.js` |
| Health | `GET /api/health` (if configured) |

Set environment variables from `.env.example` (JWT secrets, `CORS_ORIGIN`, `BOOTSTRAP_ADMIN_*`, etc.).

## Netlify storefront

Point the static site at your Render URL:

`LUHUN_API_URL=https://YOUR-SERVICE.onrender.com/api`
