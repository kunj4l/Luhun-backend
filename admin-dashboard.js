'use strict';

/**
 * Built-in admin dashboard, served as a single HTML SPA at /admin.
 * Vanilla JS, no build step — talks to the JSON API at /api/*.
 */

function html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Admin · Luhun's Official</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=DM+Sans:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
:root {
  --bg-0:#0a0a0a; --bg-1:#111; --bg-2:#1a1a1a; --bg-3:#222;
  --border:#262626; --border-strong:#333;
  --text:#ececec; --text-mute:#9a9a9a; --text-dim:#666;
  --gold:#c8a96e; --gold-soft:#a98a4f;
  --good:#4ade80; --warn:#f59e0b; --bad:#ef4444; --info:#60a5fa;
  --serif:'Playfair Display',Georgia,serif;
  --sans:'DM Sans',-apple-system,sans-serif;
  --mono:'DM Mono',ui-monospace,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:var(--sans);background:var(--bg-0);color:var(--text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:var(--gold);text-decoration:none}
a:hover{color:#e0c08a}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,select,textarea{font-family:inherit;font-size:14px;background:var(--bg-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:9px 11px;width:100%;outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--gold-soft)}
.mono{font-family:var(--mono)}
.serif{font-family:var(--serif);letter-spacing:.01em}

/* Layout */
.app{display:flex;min-height:100vh}
.sidebar{width:240px;background:var(--bg-1);border-right:1px solid var(--border);padding:20px 0;position:fixed;top:0;bottom:0;overflow-y:auto}
.brand{padding:0 24px 22px;border-bottom:1px solid var(--border);margin-bottom:18px}
.brand .logo{font-family:var(--serif);font-size:22px;color:var(--gold);font-weight:700;letter-spacing:.02em}
.brand .sub{font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.16em;margin-top:4px}
.nav-group{padding:14px 12px 4px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.18em}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 24px;color:var(--text-mute);font-size:14px;cursor:pointer;border-left:2px solid transparent;transition:all .15s}
.nav-item:hover{color:var(--text);background:var(--bg-2)}
.nav-item.active{color:var(--gold);background:var(--bg-2);border-left-color:var(--gold)}
.nav-item .ico{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;opacity:.8}
.main{margin-left:240px;flex:1;min-width:0}
.topbar{height:62px;background:var(--bg-1);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 30px;position:sticky;top:0;z-index:10}
.topbar h1{font-family:var(--serif);font-size:22px;font-weight:500}
.topbar .right{display:flex;align-items:center;gap:14px}
.btn{padding:8px 14px;border-radius:6px;font-weight:500;font-size:13px;display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;transition:all .15s}
.btn-primary{background:var(--gold);color:#0a0a0a}
.btn-primary:hover{background:#dbb87b}
.btn-ghost{background:var(--bg-2);color:var(--text);border-color:var(--border)}
.btn-ghost:hover{background:var(--bg-3)}
.btn-sm{padding:5px 9px;font-size:12px}
.btn-danger{background:transparent;color:var(--bad);border-color:#3d1e1e}
.btn-danger:hover{background:#2a1414}
.content{padding:28px 30px}
.page-title{font-family:var(--serif);font-size:30px;font-weight:500;margin-bottom:4px}
.page-sub{color:var(--text-mute);margin-bottom:24px;font-size:13px}

/* Stat cards */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:26px}
.stat{background:var(--bg-1);border:1px solid var(--border);border-radius:10px;padding:18px 18px 16px}
.stat .label{color:var(--text-mute);font-size:11px;text-transform:uppercase;letter-spacing:.14em;margin-bottom:8px}
.stat .value{font-family:var(--mono);font-size:24px;color:var(--text);font-weight:500}
.stat .delta{font-size:11px;color:var(--text-dim);margin-top:6px}
.stat.gold .value{color:var(--gold)}

/* Card / Panel */
.card{background:var(--bg-1);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:18px}
.card-h{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.card-h h2{font-family:var(--serif);font-size:17px;font-weight:500}
.card-b{padding:0}
.card-pad{padding:18px}

/* Tables */
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.12em;padding:11px 14px;border-bottom:1px solid var(--border);background:var(--bg-2);font-weight:500}
td{padding:13px 14px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--bg-2)}
td .thumb{width:38px;height:38px;border-radius:5px;background:var(--bg-3);object-fit:cover}
td.mono,th.mono{font-family:var(--mono);font-size:12px}
td.num{text-align:right;font-family:var(--mono)}

/* Badges */
.badge{display:inline-block;padding:3px 9px;font-size:11px;border-radius:999px;font-weight:500;font-family:var(--mono);letter-spacing:.02em}
.badge.ok{background:#0e2818;color:var(--good)}
.badge.warn{background:#2a1f0a;color:var(--warn)}
.badge.bad{background:#2a1414;color:var(--bad)}
.badge.info{background:#0e1f33;color:var(--info)}
.badge.muted{background:var(--bg-3);color:var(--text-mute)}
.badge.gold{background:#2a210f;color:var(--gold)}

/* Bars */
.bar{height:6px;border-radius:3px;background:var(--bg-3);overflow:hidden;width:120px}
.bar > div{height:100%;background:var(--gold)}
.bar.warn > div{background:var(--warn)}
.bar.bad > div{background:var(--bad)}

/* Chart */
.chart{display:flex;align-items:flex-end;gap:4px;height:160px;padding:18px;background:var(--bg-1);border:1px solid var(--border);border-radius:10px;margin-bottom:18px}
.chart .col{flex:1;background:linear-gradient(180deg,var(--gold) 0%,var(--gold-soft) 100%);border-radius:3px 3px 0 0;position:relative;min-height:2px;opacity:.9;transition:opacity .15s}
.chart .col:hover{opacity:1}
.chart .col .tt{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--bg-3);color:var(--text);padding:3px 7px;border-radius:3px;font-size:10px;font-family:var(--mono);white-space:nowrap;display:none}
.chart .col:hover .tt{display:block}

/* Forms */
.field{margin-bottom:14px}
.field label{display:block;font-size:12px;color:var(--text-mute);margin-bottom:5px;text-transform:uppercase;letter-spacing:.08em}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;z-index:100;padding:20px}
.modal-overlay.active{display:flex}
.modal{background:var(--bg-1);border:1px solid var(--border-strong);border-radius:12px;max-width:640px;width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column}
.modal-h{padding:16px 22px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.modal-h h3{font-family:var(--serif);font-size:18px;font-weight:500}
.modal-h .close{font-size:22px;color:var(--text-dim);background:none}
.modal-b{padding:22px;overflow-y:auto}
.modal-f{padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px}

/* Toolbar */
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.toolbar .filters{display:flex;gap:8px;flex-wrap:wrap}
.toolbar input,.toolbar select{width:auto;min-width:160px}

/* Login */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(ellipse at top,rgba(200,169,110,.06),transparent 70%),var(--bg-0)}
.login-card{background:var(--bg-1);border:1px solid var(--border);border-radius:12px;padding:36px;width:100%;max-width:380px}
.login-card .logo{font-family:var(--serif);font-size:30px;color:var(--gold);font-weight:700;text-align:center;margin-bottom:6px}
.login-card .sub{text-align:center;color:var(--text-mute);font-size:13px;margin-bottom:28px}

/* Misc */
.row-actions{display:flex;gap:6px}
.empty{text-align:center;padding:60px 20px;color:var(--text-mute)}
.empty .ico{font-size:38px;opacity:.4;margin-bottom:8px}
.toast{position:fixed;bottom:20px;right:20px;background:var(--bg-3);border:1px solid var(--border-strong);border-left:3px solid var(--gold);padding:12px 18px;border-radius:6px;color:var(--text);font-size:13px;z-index:200;animation:slideIn .3s;max-width:360px}
.toast.ok{border-left-color:var(--good)}
.toast.bad{border-left-color:var(--bad)}
@keyframes slideIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
.inline-edit{width:80px;padding:4px 8px;text-align:right;font-family:var(--mono)}
.sku-tag{display:inline-block;font-family:var(--mono);font-size:11px;color:var(--text-mute);background:var(--bg-3);padding:2px 7px;border-radius:4px}
.proc-card{background:var(--bg-2);border:1px solid var(--border);border-radius:10px;padding:16px;display:flex;justify-content:space-between;align-items:center}
.proc-card .name{font-weight:500;font-size:15px;text-transform:capitalize}
.proc-card .sub{color:var(--text-mute);font-size:12px;margin-top:2px}
.pill-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.pill{padding:5px 12px;border:1px solid var(--border);border-radius:999px;font-size:12px;color:var(--text-mute);cursor:pointer}
.pill.active{background:var(--gold);color:#0a0a0a;border-color:var(--gold)}
</style>
</head>
<body>

<div id="login" class="login-wrap" style="display:none">
  <div class="login-card">
    <div class="logo">Luhun's&nbsp;Official</div>
    <div class="sub">Admin sign-in</div>
    <form id="login-form">
      <div class="field"><label>Username</label><input type="text" name="email" required autocomplete="username" placeholder="Luhun" /></div>
      <div class="field"><label>Password</label><input type="password" name="password" required autocomplete="current-password" /></div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px">Sign in</button>
    </form>
    <div id="login-error" style="color:var(--bad);font-size:12px;margin-top:10px;text-align:center"></div>
  </div>
</div>

<div id="app" class="app" style="display:none">
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">Luhun's Official</div>
      <div class="sub">Admin Console</div>
    </div>
    <div class="nav-group">Overview</div>
    <div class="nav-item" data-route="dashboard"><span class="ico">⬡</span> Dashboard</div>
    <div class="nav-item" data-route="analytics"><span class="ico">⏚</span> Analytics</div>

    <div class="nav-group">Catalog</div>
    <div class="nav-item" data-route="products"><span class="ico">⬚</span> Products</div>
    <div class="nav-item" data-route="categories"><span class="ico">⌗</span> Categories</div>
    <div class="nav-item" data-route="inventory"><span class="ico">⬓</span> Inventory</div>

    <div class="nav-group">Sales</div>
    <div class="nav-item" data-route="orders"><span class="ico">⊟</span> Orders</div>
    <div class="nav-item" data-route="returns"><span class="ico">↻</span> Returns &amp; Refunds</div>
    <div class="nav-item" data-route="discounts"><span class="ico">%</span> Discounts</div>
    <div class="nav-item" data-route="gift-cards"><span class="ico">⊞</span> Gift Cards</div>

    <div class="nav-group">Customers</div>
    <div class="nav-item" data-route="customers"><span class="ico">☺</span> Customers</div>
    <div class="nav-item" data-route="reviews"><span class="ico">★</span> Reviews</div>

    <div class="nav-group">Supply</div>
    <div class="nav-item" data-route="suppliers"><span class="ico">⌂</span> Suppliers</div>
    <div class="nav-item" data-route="purchase-orders"><span class="ico">⎙</span> Purchase Orders</div>

    <div class="nav-group">Configuration</div>
    <div class="nav-item" data-route="payments"><span class="ico">⊕</span> Payments</div>
    <div class="nav-item" data-route="shipping"><span class="ico">↗</span> Shipping</div>
    <div class="nav-item" data-route="settings"><span class="ico">⚙</span> Settings</div>
  </aside>

  <main class="main">
    <header class="topbar">
      <h1 id="page-h">Dashboard</h1>
      <div class="right">
        <span id="me" class="mono" style="color:var(--text-mute);font-size:12px"></span>
        <button id="logout" class="btn btn-ghost btn-sm">Sign out</button>
      </div>
    </header>
    <div id="view" class="content"></div>
  </main>
</div>

<div id="modal-root"></div>

<script>
// =========================================================================
// API helpers + state
// =========================================================================
const API = '/api';
const state = { token: localStorage.getItem('admin_token'), user: null };

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) opts.body = JSON.stringify(opts.body);
  if (opts.body instanceof FormData) delete headers['Content-Type'];
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmtMoney = (cents, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format((cents || 0) / 100);
const fmtNum = (n) => new Intl.NumberFormat('en-US').format(n || 0);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString() : '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const toast = (msg, kind = 'ok') => {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
};

// =========================================================================
// Auth
// =========================================================================
async function checkAuth() {
  if (!state.token) return showLogin();
  try {
    const { user } = await api('/me');
    state.user = user;
    if (!['owner', 'admin', 'manager', 'staff'].includes(user.role)) {
      toast('Customer accounts cannot access the admin.', 'bad');
      return logout();
    }
    showApp();
  } catch { showLogin(); }
}

function showLogin() {
  $('#login').style.display = 'flex'; $('#app').style.display = 'none';
}
function showApp() {
  $('#login').style.display = 'none'; $('#app').style.display = 'flex';
  $('#me').textContent = state.user.email + ' · ' + state.user.role;
  navigate(location.hash.slice(1) || 'dashboard');
}
function logout() {
  localStorage.removeItem('admin_token'); state.token = null; state.user = null;
  showLogin();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const res = await api('/auth/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
    state.token = res.token; localStorage.setItem('admin_token', res.token);
    checkAuth();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});
$('#logout').addEventListener('click', logout);

// =========================================================================
// Router
// =========================================================================
const ROUTES = {
  dashboard: { title: 'Dashboard', render: viewDashboard },
  analytics: { title: 'Analytics', render: viewAnalytics },
  products: { title: 'Products', render: viewProducts },
  categories: { title: 'Categories', render: viewCategories },
  inventory: { title: 'Inventory', render: viewInventory },
  orders: { title: 'Orders', render: viewOrders },
  returns: { title: 'Returns & Refunds', render: viewReturns },
  discounts: { title: 'Discounts', render: viewDiscounts },
  'gift-cards': { title: 'Gift Cards', render: viewGiftCards },
  customers: { title: 'Customers', render: viewCustomers },
  reviews: { title: 'Reviews', render: viewReviews },
  suppliers: { title: 'Suppliers', render: viewSuppliers },
  'purchase-orders': { title: 'Purchase Orders', render: viewPurchaseOrders },
  payments: { title: 'Payments', render: viewPayments },
  shipping: { title: 'Shipping', render: viewShipping },
  settings: { title: 'Settings', render: viewSettings },
};

function navigate(route) {
  if (!ROUTES[route]) route = 'dashboard';
  location.hash = route;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));
  $('#page-h').textContent = ROUTES[route].title;
  $('#view').innerHTML = '<div class="empty"><div class="ico">⟳</div>Loading...</div>';
  ROUTES[route].render().catch(err => {
    $('#view').innerHTML = '<div class="empty"><div class="ico">!</div>' + esc(err.message) + '</div>';
  });
}
$$('.nav-item').forEach(n => n.addEventListener('click', () => navigate(n.dataset.route)));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));

// =========================================================================
// Modal
// =========================================================================
function modal({ title, body, footer, onOpen }) {
  const root = $('#modal-root');
  root.innerHTML = '<div class="modal-overlay active"><div class="modal">' +
    '<div class="modal-h"><h3>' + esc(title) + '</h3><button class="close">×</button></div>' +
    '<div class="modal-b">' + body + '</div>' +
    (footer ? '<div class="modal-f">' + footer + '</div>' : '') +
    '</div></div>';
  const close = () => { root.innerHTML = ''; };
  $('.close', root).onclick = close;
  $('.modal-overlay', root).onclick = (e) => { if (e.target.classList.contains('modal-overlay')) close(); };
  if (onOpen) onOpen(root, close);
  return close;
}

// =========================================================================
// DASHBOARD
// =========================================================================
async function viewDashboard() {
  const [{ data: stats }, { data: revSeries }, { data: orders }] = await Promise.all([
    api('/analytics/dashboard?period=30'),
    api('/analytics/revenue?period=30'),
    api('/orders?limit=8'),
  ]);
  const max = Math.max(1, ...revSeries.map(r => r.cents));
  $('#view').innerHTML = \`
    <div class="page-title">Welcome back</div>
    <div class="page-sub">Snapshot of the last 30 days</div>
    <div class="stat-grid">
      <div class="stat gold"><div class="label">Revenue</div><div class="value">\${fmtMoney(stats.revenueCents)}</div><div class="delta">30-day net</div></div>
      <div class="stat"><div class="label">Orders</div><div class="value">\${fmtNum(stats.orders)}</div><div class="delta">\${stats.paidOrders} paid</div></div>
      <div class="stat"><div class="label">New Customers</div><div class="value">\${fmtNum(stats.customers)}</div></div>
      <div class="stat"><div class="label">AOV</div><div class="value">\${fmtMoney(stats.aovCents)}</div></div>
      <div class="stat"><div class="label">Return Rate</div><div class="value">\${(stats.returnRate * 100).toFixed(1)}%</div></div>
      <div class="stat"><div class="label">Inventory Value</div><div class="value">\${fmtMoney(stats.inventoryValueCents)}</div><div class="delta">\${fmtNum(stats.inventoryUnits)} units</div></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Revenue · last 30 days</h2></div>
      <div class="chart" id="rev-chart">\${revSeries.map(r => {
        const pct = Math.max(2, (r.cents / max) * 100);
        return '<div class="col" style="height:' + pct + '%"><span class="tt">' + r.date + ' · ' + fmtMoney(r.cents) + '</span></div>';
      }).join('')}</div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Latest orders</h2><a href="#orders">View all →</a></div>
      <table>
        <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th class="num">Total</th><th>When</th></tr></thead>
        <tbody>\${orders.map(o => \`
          <tr>
            <td class="mono">\${esc(o.orderNumber)}</td>
            <td>\${esc(o.customer?.email || o.email || '—')}</td>
            <td>\${statusBadge(o.status)}</td>
            <td>\${paymentBadge(o.paymentStatus)}</td>
            <td class="num">\${fmtMoney(o.totalCents)}</td>
            <td style="color:var(--text-mute)">\${fmtDateTime(o.createdAt)}</td>
          </tr>\`).join('') || '<tr><td colspan="6" class="empty">No orders yet</td></tr>'}
        </tbody>
      </table>
    </div>\`;
}

const statusBadge = s => {
  const map = { pending:['warn','Pending'], paid:['ok','Paid'], shipped:['info','Shipped'], delivered:['ok','Delivered'], fulfilled:['ok','Fulfilled'], partially_fulfilled:['warn','Partial'], cancelled:['muted','Cancelled'], refunded:['bad','Refunded'] };
  const [k, l] = map[s] || ['muted', s];
  return \`<span class="badge \${k}">\${esc(l)}</span>\`;
};
const paymentBadge = s => {
  const map = { unpaid:['warn','Unpaid'], authorized:['info','Auth'], paid:['ok','Paid'], partially_refunded:['warn','Part Refund'], refunded:['bad','Refunded'], failed:['bad','Failed'], voided:['muted','Voided'] };
  const [k, l] = map[s] || ['muted', s];
  return \`<span class="badge \${k}">\${esc(l)}</span>\`;
};

// =========================================================================
// PRODUCTS
// =========================================================================
async function viewProducts() {
  const { data } = await api('/products?limit=100');
  $('#view').innerHTML = \`
    <div class="toolbar">
      <div class="filters">
        <input id="p-search" placeholder="Search products..." />
        <select id="p-status"><option value="">All status</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select>
      </div>
      <button class="btn btn-primary" id="p-new">+ New Product</button>
    </div>
    <div class="card"><div class="card-b">\${productsTable(data)}</div></div>\`;
  $('#p-new').onclick = () => productModal();
  bindProductActions();
  $('#p-search').oninput = debounce(async (e) => {
    const { data } = await api('/products?q=' + encodeURIComponent(e.target.value) + '&status=' + ($('#p-status').value || ''));
    $('.card-b').innerHTML = productsTable(data); bindProductActions();
  }, 250);
  $('#p-status').onchange = $('#p-search').oninput;
}

function productsTable(rows) {
  if (!rows.length) return '<div class="empty"><div class="ico">⬚</div>No products yet — click <strong>New Product</strong> to add one.</div>';
  return \`<table>
    <thead><tr><th></th><th>Title</th><th>Variants</th><th>Stock</th><th class="num">Price</th><th>Status</th><th></th></tr></thead>
    <tbody>\${rows.map(p => {
      const totalStock = (p.variants || []).reduce((s, v) => s + (v.stockQuantity || 0), 0);
      const lowStock = (p.variants || []).some(v => v.stockQuantity <= v.lowStockThreshold);
      const cls = totalStock === 0 ? 'bad' : lowStock ? 'warn' : '';
      const pct = Math.min(100, totalStock);
      const img = (p.images && p.images[0]) || '';
      return \`<tr data-id="\${p.id}">
        <td>\${img ? '<img class="thumb" src="' + esc(img) + '" />' : '<div class="thumb"></div>'}</td>
        <td><div style="font-weight:500">\${esc(p.title)}</div><div style="color:var(--text-mute);font-size:12px">\${esc(p.slug)}</div></td>
        <td>\${(p.variants || []).length}</td>
        <td><div class="bar \${cls}"><div style="width:\${pct}%"></div></div><span style="color:var(--text-mute);font-size:11px;margin-left:6px">\${totalStock}</span></td>
        <td class="num">\${fmtMoney(p.basePriceCents)}</td>
        <td>\${statusBadge(p.status)}</td>
        <td><div class="row-actions"><button class="btn btn-ghost btn-sm" data-act="edit">Edit</button><button class="btn btn-danger btn-sm" data-act="del">Delete</button></div></td>
      </tr>\`;
    }).join('')}</tbody></table>\`;
}

function bindProductActions() {
  $$('button[data-act]').forEach(b => b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    if (b.dataset.act === 'del') {
      if (!confirm('Delete this product?')) return;
      await api('/products/' + id, { method: 'DELETE' });
      toast('Product deleted'); viewProducts();
    } else {
      const { data } = await api('/products/' + id);
      productModal(data);
    }
  });
}

function productModal(p) {
  const isEdit = !!p; p = p || { status: 'draft', variants: [] };
  modal({
    title: isEdit ? 'Edit product' : 'New product',
    body: \`<form id="pf">
      <div class="field-row">
        <div class="field"><label>Title</label><input name="title" value="\${esc(p.title || '')}" required /></div>
        <div class="field"><label>Brand</label><input name="brand" value="\${esc(p.brand || '')}" /></div>
      </div>
      <div class="field"><label>Description</label><textarea name="description" rows="3">\${esc(p.description || '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Base Price (USD)</label><input name="basePrice" type="number" step="0.01" value="\${((p.basePriceCents || 0) / 100).toFixed(2)}" /></div>
        <div class="field"><label>Compare At</label><input name="compareAtPrice" type="number" step="0.01" value="\${p.compareAtPriceCents ? (p.compareAtPriceCents / 100).toFixed(2) : ''}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Cost</label><input name="cost" type="number" step="0.01" value="\${p.costCents ? (p.costCents / 100).toFixed(2) : ''}" /></div>
        <div class="field"><label>Status</label><select name="status"><option value="draft" \${p.status==='draft'?'selected':''}>Draft</option><option value="active" \${p.status==='active'?'selected':''}>Active</option><option value="archived" \${p.status==='archived'?'selected':''}>Archived</option></select></div>
      </div>
      <div class="field"><label>Images</label><input name="images" type="file" multiple accept="image/*" /></div>
      \${!isEdit ? '<div class="field"><label>First variant SKU</label><input name="sku" placeholder="auto-generated if blank" /></div>' : ''}
    </form>\`,
    footer: '<button class="btn btn-ghost" id="cancel">Cancel</button><button class="btn btn-primary" id="save">Save</button>',
    onOpen: (root, close) => {
      $('#cancel', root).onclick = close;
      $('#save', root).onclick = async () => {
        const f = $('#pf', root);
        const fd = new FormData();
        fd.append('title', f.title.value);
        fd.append('brand', f.brand.value);
        fd.append('description', f.description.value);
        fd.append('basePriceCents', Math.round(parseFloat(f.basePrice.value || '0') * 100));
        if (f.compareAtPrice.value) fd.append('compareAtPriceCents', Math.round(parseFloat(f.compareAtPrice.value) * 100));
        if (f.cost.value) fd.append('costCents', Math.round(parseFloat(f.cost.value) * 100));
        fd.append('status', f.status.value);
        if (!isEdit) {
          fd.append('variants', JSON.stringify([{ sku: f.sku?.value || '', priceCents: Math.round(parseFloat(f.basePrice.value || '0') * 100), stockQuantity: 0 }]));
        }
        for (const file of f.images.files) fd.append('images', file);
        try {
          await api('/products' + (isEdit ? '/' + p.id : ''), { method: isEdit ? 'PUT' : 'POST', body: fd });
          toast('Saved'); close(); viewProducts();
        } catch (e) { toast(e.message, 'bad'); }
      };
    },
  });
}

// =========================================================================
// INVENTORY
// =========================================================================
async function viewInventory() {
  const { data } = await api('/inventory');
  $('#view').innerHTML = \`
    <div class="toolbar">
      <div class="filters"><input id="i-search" placeholder="Search SKU or product..." /></div>
      <button class="btn btn-primary" id="bulk-save">Save bulk changes</button>
    </div>
    <div class="card"><div class="card-b">\${inventoryTable(data)}</div></div>\`;
  bindInventoryEdit();
  $('#i-search').oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$('#inv-table tbody tr').forEach(tr => {
      tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
    });
  };
  $('#bulk-save').onclick = bulkSaveInventory;
}

function inventoryTable(rows) {
  if (!rows.length) return '<div class="empty"><div class="ico">⬓</div>No inventory yet</div>';
  return \`<table id="inv-table">
    <thead><tr><th>SKU</th><th>Product</th><th>Status</th><th>Threshold</th><th class="num">Reserved</th><th class="num">Stock</th><th class="num">Value</th></tr></thead>
    <tbody>\${rows.map(r => {
      const cls = r.status === 'out_of_stock' ? 'bad' : r.status === 'low' ? 'warn' : 'ok';
      return \`<tr data-id="\${r.variantId}" data-search="\${esc((r.sku + ' ' + (r.productTitle || '')).toLowerCase())}">
        <td><span class="sku-tag">\${esc(r.sku)}</span></td>
        <td>\${esc(r.productTitle || '—')}</td>
        <td><span class="badge \${cls}">\${r.status.replace('_',' ')}</span></td>
        <td class="num mono">\${r.lowStockThreshold}</td>
        <td class="num mono" style="color:var(--text-mute)">\${r.reservedQuantity}</td>
        <td class="num"><input class="inline-edit" type="number" value="\${r.stockQuantity}" data-original="\${r.stockQuantity}" /></td>
        <td class="num mono" style="color:var(--text-mute)">\${fmtMoney(r.valueCents)}</td>
      </tr>\`;
    }).join('')}</tbody></table>\`;
}

function bindInventoryEdit() {
  $$('#inv-table .inline-edit').forEach(inp => {
    inp.onchange = () => {
      inp.style.borderColor = inp.value !== inp.dataset.original ? 'var(--gold)' : 'var(--border)';
    };
  });
}

async function bulkSaveInventory() {
  const updates = [];
  $$('#inv-table .inline-edit').forEach(inp => {
    if (inp.value !== inp.dataset.original) {
      updates.push({ variantId: inp.closest('tr').dataset.id, setStock: parseInt(inp.value, 10) });
    }
  });
  if (!updates.length) return toast('No changes', 'ok');
  await api('/inventory/bulk-adjust', { method: 'POST', body: { updates } });
  toast(updates.length + ' SKUs updated'); viewInventory();
}

// =========================================================================
// ORDERS
// =========================================================================
async function viewOrders() {
  const { data } = await api('/orders?limit=100');
  $('#view').innerHTML = \`
    <div class="toolbar">
      <div class="filters">
        <select id="o-status"><option value="">All status</option><option>pending</option><option>paid</option><option>shipped</option><option>delivered</option><option>cancelled</option><option>refunded</option></select>
        <select id="o-pay"><option value="">All payment</option><option>unpaid</option><option>paid</option><option>refunded</option><option>failed</option></select>
        <select id="o-channel"><option value="">All channels</option><option>web</option><option>pos</option><option>wholesale</option><option>marketplace</option></select>
      </div>
    </div>
    <div class="card"><div class="card-b">\${ordersTable(data)}</div></div>\`;
  const reload = async () => {
    const params = new URLSearchParams({ status: $('#o-status').value, paymentStatus: $('#o-pay').value, channel: $('#o-channel').value });
    const { data } = await api('/orders?limit=100&' + params);
    $('.card-b').innerHTML = ordersTable(data); bindOrderActions();
  };
  ['o-status','o-pay','o-channel'].forEach(id => $('#' + id).onchange = reload);
  bindOrderActions();
}

function ordersTable(rows) {
  if (!rows.length) return '<div class="empty"><div class="ico">⊟</div>No orders</div>';
  return \`<table>
    <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Payment</th><th class="num">Total</th><th>When</th><th></th></tr></thead>
    <tbody>\${rows.map(o => \`<tr data-id="\${o.id}">
      <td class="mono">\${esc(o.orderNumber)}</td>
      <td>\${esc(o.customer?.email || o.email || '—')}</td>
      <td>\${(o.items || []).length}</td>
      <td>\${statusBadge(o.status)}</td>
      <td>\${paymentBadge(o.paymentStatus)}</td>
      <td class="num">\${fmtMoney(o.totalCents)}</td>
      <td style="color:var(--text-mute)">\${fmtDateTime(o.createdAt)}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-act="fulfill">Fulfill</button>
        <button class="btn btn-ghost btn-sm" data-act="refund">Refund</button>
        <button class="btn btn-danger btn-sm" data-act="cancel">Cancel</button>
      </div></td>
    </tr>\`).join('')}</tbody></table>\`;
}

function bindOrderActions() {
  $$('button[data-act]').forEach(b => b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    if (b.dataset.act === 'fulfill') {
      const trackingNumber = prompt('Tracking #?'); if (!trackingNumber) return;
      const carrier = prompt('Carrier (UPS/FedEx/USPS/DHL)?') || 'USPS';
      await api('/orders/' + id + '/fulfill', { method: 'POST', body: { trackingNumber, carrier } });
      toast('Fulfilled'); viewOrders();
    } else if (b.dataset.act === 'refund') {
      const amount = prompt('Refund amount in USD (leave blank for full)?');
      const body = amount ? { amountCents: Math.round(parseFloat(amount) * 100) } : {};
      await api('/orders/' + id + '/refund', { method: 'POST', body });
      toast('Refunded'); viewOrders();
    } else if (b.dataset.act === 'cancel') {
      if (!confirm('Cancel this order?')) return;
      await api('/orders/' + id + '/cancel', { method: 'POST' });
      toast('Cancelled'); viewOrders();
    }
  });
}

// =========================================================================
// PAYMENTS
// =========================================================================
async function viewPayments() {
  const { data: procs } = await api('/payments/processors');
  const { data: stats } = await api('/analytics/dashboard?period=30');
  $('#view').innerHTML = \`
    <div class="page-title">Payments</div>
    <div class="page-sub">Connected processors and 30-day overview</div>
    <div class="stat-grid">
      <div class="stat gold"><div class="label">Captured 30d</div><div class="value">\${fmtMoney(stats.revenueCents)}</div></div>
      <div class="stat"><div class="label">Paid Orders</div><div class="value">\${fmtNum(stats.paidOrders)}</div></div>
      <div class="stat"><div class="label">AOV</div><div class="value">\${fmtMoney(stats.aovCents)}</div></div>
    </div>
    <div class="card"><div class="card-h"><h2>Processors</h2></div><div class="card-pad" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
      \${procs.map(p => \`<div class="proc-card">
        <div><div class="name">\${esc(p.id)}</div><div class="sub">\${p.configured ? 'API keys present' : 'Add credentials to .env'}</div></div>
        <span class="badge \${p.configured ? 'ok' : 'muted'}">\${p.configured ? 'Connected' : 'Disabled'}</span>
      </div>\`).join('')}
    </div></div>\`;
}

// =========================================================================
// DISCOUNTS
// =========================================================================
async function viewDiscounts() {
  const { data } = await api('/discounts');
  $('#view').innerHTML = \`
    <div class="toolbar"><div></div><button class="btn btn-primary" id="d-new">+ New Discount</button></div>
    <div class="card"><div class="card-b">\${data.length ? \`
      <table><thead><tr><th>Code</th><th>Type</th><th class="num">Value</th><th>Usage</th><th>Active</th><th>Window</th><th></th></tr></thead>
      <tbody>\${data.map(d => \`<tr data-id="\${d.id}">
        <td class="mono">\${esc(d.code)}</td>
        <td>\${esc(d.type)}</td>
        <td class="num">\${d.type === 'percentage' ? d.value + '%' : d.type === 'fixed' ? fmtMoney(d.value * 100) : '—'}</td>
        <td>\${d.usageCount}\${d.usageLimit ? ' / ' + d.usageLimit : ''}</td>
        <td>\${d.isActive ? '<span class="badge ok">Active</span>' : '<span class="badge muted">Off</span>'}</td>
        <td style="color:var(--text-mute);font-size:12px">\${d.startsAt ? fmtDate(d.startsAt) : '—'} → \${d.endsAt ? fmtDate(d.endsAt) : '∞'}</td>
        <td><button class="btn btn-danger btn-sm" data-act="del">Delete</button></td>
      </tr>\`).join('')}</tbody></table>\` : '<div class="empty">No discounts</div>'}
    </div></div>\`;
  $('#d-new').onclick = () => discountModal();
  $$('button[data-act="del"]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete discount?')) return;
    await api('/discounts/' + b.closest('tr').dataset.id, { method: 'DELETE' });
    viewDiscounts();
  });
}

function discountModal() {
  modal({
    title: 'New discount',
    body: \`<form id="df">
      <div class="field-row">
        <div class="field"><label>Code</label><input name="code" required style="text-transform:uppercase" /></div>
        <div class="field"><label>Type</label><select name="type"><option value="percentage">Percentage</option><option value="fixed">Fixed</option><option value="free_shipping">Free Shipping</option><option value="bogo">BOGO</option></select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Value</label><input name="value" type="number" step="0.01" value="10" /></div>
        <div class="field"><label>Min Subtotal (USD)</label><input name="minSubtotal" type="number" step="0.01" value="0" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Usage Limit</label><input name="usageLimit" type="number" /></div>
        <div class="field"><label>Per Customer Limit</label><input name="perCustomerLimit" type="number" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Starts</label><input name="startsAt" type="date" /></div>
        <div class="field"><label>Ends</label><input name="endsAt" type="date" /></div>
      </div>
    </form>\`,
    footer: '<button class="btn btn-ghost" id="cancel">Cancel</button><button class="btn btn-primary" id="save">Create</button>',
    onOpen: (root, close) => {
      $('#cancel', root).onclick = close;
      $('#save', root).onclick = async () => {
        const f = $('#df', root);
        try {
          await api('/discounts', { method: 'POST', body: {
            code: f.code.value.toUpperCase(),
            type: f.type.value,
            value: parseFloat(f.value.value || '0'),
            minSubtotalCents: Math.round(parseFloat(f.minSubtotal.value || '0') * 100),
            usageLimit: f.usageLimit.value ? parseInt(f.usageLimit.value, 10) : null,
            perCustomerLimit: f.perCustomerLimit.value ? parseInt(f.perCustomerLimit.value, 10) : null,
            startsAt: f.startsAt.value || null,
            endsAt: f.endsAt.value || null,
            isActive: true,
          } });
          toast('Discount created'); close(); viewDiscounts();
        } catch (e) { toast(e.message, 'bad'); }
      };
    },
  });
}

// =========================================================================
// RETURNS
// =========================================================================
async function viewReturns() {
  const { data } = await api('/returns');
  $('#view').innerHTML = \`<div class="card"><div class="card-b">\${data.length ? \`
    <table><thead><tr><th>RMA</th><th>Status</th><th>Reason</th><th class="num">Refund</th><th>When</th><th></th></tr></thead>
    <tbody>\${data.map(r => \`<tr data-id="\${r.id}">
      <td class="mono">\${esc(r.rmaNumber)}</td>
      <td>\${returnBadge(r.status)}</td>
      <td>\${esc(r.reason || '—')}</td>
      <td class="num">\${fmtMoney(r.refundAmountCents)}</td>
      <td style="color:var(--text-mute)">\${fmtDateTime(r.createdAt)}</td>
      <td><div class="row-actions">
        <button class="btn btn-primary btn-sm" data-act="approve">Approve</button>
        <button class="btn btn-danger btn-sm" data-act="reject">Reject</button>
      </div></td>
    </tr>\`).join('')}</tbody></table>\` : '<div class="empty">No return requests</div>'}
  </div></div>\`;
  $$('button[data-act]').forEach(b => b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    const status = b.dataset.act === 'approve' ? 'approved' : 'rejected';
    await api('/returns/' + id, { method: 'PATCH', body: { status } });
    toast('Return ' + status); viewReturns();
  });
}
const returnBadge = s => {
  const map = { requested:['warn','Requested'], approved:['ok','Approved'], rejected:['bad','Rejected'], received:['info','Received'], refunded:['ok','Refunded'], cancelled:['muted','Cancelled'] };
  const [k, l] = map[s] || ['muted', s];
  return \`<span class="badge \${k}">\${l}</span>\`;
};

// =========================================================================
// REVIEWS
// =========================================================================
async function viewReviews() {
  const all = await Promise.all([
    api('/reviews?status=pending').catch(() => ({ data: [] })),
    api('/reviews').catch(() => ({ data: [] })),
  ]);
  const pending = all[0].data || [];
  const approved = all[1].data || [];
  $('#view').innerHTML = \`
    <div class="card"><div class="card-h"><h2>Pending moderation (\${pending.length})</h2></div><div class="card-b">
      \${pending.length ? reviewsTable(pending, true) : '<div class="empty">Nothing to review</div>'}
    </div></div>
    <div class="card"><div class="card-h"><h2>Approved reviews</h2></div><div class="card-b">
      \${approved.length ? reviewsTable(approved, false) : '<div class="empty">No approved reviews yet</div>'}
    </div></div>\`;
  $$('button[data-act]').forEach(b => b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    const status = b.dataset.act === 'approve' ? 'approved' : 'rejected';
    await api('/reviews/' + id, { method: 'PATCH', body: { status } });
    toast('Review ' + status); viewReviews();
  });
}
function reviewsTable(rows, moderate) {
  return \`<table><thead><tr><th>Rating</th><th>Title</th><th>Author</th><th>When</th>\${moderate ? '<th></th>' : ''}</tr></thead>
    <tbody>\${rows.map(r => \`<tr data-id="\${r.id}">
      <td class="gold mono">\${'★'.repeat(r.rating)}<span style="color:var(--text-dim)">\${'★'.repeat(5 - r.rating)}</span></td>
      <td><div style="font-weight:500">\${esc(r.title || '—')}</div><div style="color:var(--text-mute);font-size:12px">\${esc((r.body || '').slice(0, 90))}</div></td>
      <td>\${esc(r.author?.email || '—')}</td>
      <td style="color:var(--text-mute)">\${fmtDateTime(r.createdAt)}</td>
      \${moderate ? '<td><div class="row-actions"><button class="btn btn-primary btn-sm" data-act="approve">Approve</button><button class="btn btn-danger btn-sm" data-act="reject">Reject</button></div></td>' : ''}
    </tr>\`).join('')}</tbody></table>\`;
}

// =========================================================================
// SUPPLIERS
// =========================================================================
async function viewSuppliers() {
  const { data } = await api('/suppliers');
  $('#view').innerHTML = \`
    <div class="toolbar"><div></div><button class="btn btn-primary" id="s-new">+ New Supplier</button></div>
    <div class="card"><div class="card-b">\${data.length ? \`
      <table><thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Lead Time</th><th>Active</th></tr></thead>
      <tbody>\${data.map(s => \`<tr><td>\${esc(s.name)}</td><td>\${esc(s.contactName || '—')}</td><td class="mono">\${esc(s.email || '—')}</td><td>\${s.leadTimeDays} days</td><td>\${s.isActive ? '<span class="badge ok">Active</span>' : '<span class="badge muted">Off</span>'}</td></tr>\`).join('')}</tbody></table>\` : '<div class="empty">No suppliers</div>'}
    </div></div>\`;
  $('#s-new').onclick = () => modal({
    title: 'New supplier',
    body: \`<form id="sf">
      <div class="field"><label>Name</label><input name="name" required /></div>
      <div class="field-row"><div class="field"><label>Contact</label><input name="contactName" /></div><div class="field"><label>Email</label><input name="email" type="email" /></div></div>
      <div class="field-row"><div class="field"><label>Phone</label><input name="phone" /></div><div class="field"><label>Lead Time (days)</label><input name="leadTimeDays" type="number" value="14" /></div></div>
      <div class="field"><label>Payment Terms</label><input name="paymentTerms" placeholder="Net 30" /></div>
    </form>\`,
    footer: '<button class="btn btn-ghost" id="cancel">Cancel</button><button class="btn btn-primary" id="save">Save</button>',
    onOpen: (root, close) => {
      $('#cancel', root).onclick = close;
      $('#save', root).onclick = async () => {
        const f = $('#sf', root);
        await api('/suppliers', { method: 'POST', body: {
          name: f.name.value, contactName: f.contactName.value, email: f.email.value,
          phone: f.phone.value, leadTimeDays: parseInt(f.leadTimeDays.value, 10), paymentTerms: f.paymentTerms.value,
        } });
        toast('Supplier created'); close(); viewSuppliers();
      };
    },
  });
}

// =========================================================================
// PURCHASE ORDERS
// =========================================================================
async function viewPurchaseOrders() {
  const { data } = await api('/purchase-orders');
  $('#view').innerHTML = \`<div class="card"><div class="card-b">\${data.length ? \`
    <table><thead><tr><th>PO #</th><th>Supplier</th><th>Status</th><th class="num">Total</th><th>Expected</th><th></th></tr></thead>
    <tbody>\${data.map(po => \`<tr data-id="\${po.id}">
      <td class="mono">\${esc(po.poNumber)}</td>
      <td>\${esc(po.supplier?.name || '—')}</td>
      <td><span class="badge \${po.status === 'received' ? 'ok' : po.status === 'cancelled' ? 'muted' : 'info'}">\${po.status}</span></td>
      <td class="num">\${fmtMoney(po.totalCents)}</td>
      <td style="color:var(--text-mute)">\${fmtDate(po.expectedAt)}</td>
      <td><button class="btn btn-primary btn-sm" data-act="receive">Receive</button></td>
    </tr>\`).join('')}</tbody></table>\` : '<div class="empty">No purchase orders</div>'}
  </div></div>\`;
  $$('button[data-act="receive"]').forEach(b => b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    if (!confirm('Mark items as received and restock inventory?')) return;
    const po = (await api('/purchase-orders')).data.find(p => p.id === id);
    const receipts = (po.items || []).map(i => ({ variantId: i.variantId, qty: i.qty }));
    await api('/purchase-orders/' + id + '/receive', { method: 'POST', body: { receipts } });
    toast('PO received'); viewPurchaseOrders();
  });
}

// =========================================================================
// CUSTOMERS
// =========================================================================
async function viewCustomers() {
  const { data } = await api('/customers?limit=100');
  $('#view').innerHTML = \`<div class="card"><div class="card-b">\${data.length ? \`
    <table><thead><tr><th>Email</th><th>Name</th><th>Joined</th><th>Last Login</th><th class="num">Credit</th></tr></thead>
    <tbody>\${data.map(c => \`<tr><td class="mono">\${esc(c.email)}</td><td>\${esc(c.name || '—')}</td><td style="color:var(--text-mute)">\${fmtDate(c.createdAt)}</td><td style="color:var(--text-mute)">\${fmtDateTime(c.lastLoginAt)}</td><td class="num">\${fmtMoney(c.storeCreditCents)}</td></tr>\`).join('')}</tbody></table>\` : '<div class="empty">No customers</div>'}
  </div></div>\`;
}

// =========================================================================
// ANALYTICS
// =========================================================================
async function viewAnalytics() {
  const render = async (period) => {
    const [{ data: stats }, { data: series }] = await Promise.all([
      api('/analytics/dashboard?period=' + period),
      api('/analytics/revenue?period=' + period),
    ]);
    const max = Math.max(1, ...series.map(s => s.cents));
    $('#view').innerHTML = \`
      <div class="pill-row">
        \${[7, 30, 90].map(p => \`<span class="pill \${p === period ? 'active' : ''}" data-p="\${p}">Last \${p} days</span>\`).join('')}
      </div>
      <div class="stat-grid">
        <div class="stat gold"><div class="label">Revenue</div><div class="value">\${fmtMoney(stats.revenueCents)}</div></div>
        <div class="stat"><div class="label">Orders</div><div class="value">\${fmtNum(stats.orders)}</div></div>
        <div class="stat"><div class="label">Customers</div><div class="value">\${fmtNum(stats.customers)}</div></div>
        <div class="stat"><div class="label">AOV</div><div class="value">\${fmtMoney(stats.aovCents)}</div></div>
        <div class="stat"><div class="label">Return rate</div><div class="value">\${(stats.returnRate * 100).toFixed(1)}%</div></div>
        <div class="stat"><div class="label">Inventory value</div><div class="value">\${fmtMoney(stats.inventoryValueCents)}</div></div>
      </div>
      <div class="card"><div class="card-h"><h2>Revenue over time</h2></div>
        <div class="chart">\${series.map(s => '<div class="col" style="height:' + Math.max(2, (s.cents / max) * 100) + '%"><span class="tt">' + s.date + ' · ' + fmtMoney(s.cents) + '</span></div>').join('')}</div>
      </div>\`;
    $$('.pill').forEach(p => p.onclick = () => render(Number(p.dataset.p)));
  };
  await render(30);
}

// =========================================================================
// SHIPPING ZONES
// =========================================================================
async function viewShipping() {
  const { data } = await api('/shipping/zones');
  $('#view').innerHTML = \`
    <div class="toolbar"><div></div><button class="btn btn-primary" id="z-new">+ New Zone</button></div>
    <div class="card"><div class="card-b">\${data.length ? \`
      <table><thead><tr><th>Name</th><th>Countries</th><th>Rates</th><th>Active</th></tr></thead>
      <tbody>\${data.map(z => \`<tr><td>\${esc(z.name)}</td><td class="mono" style="font-size:12px">\${(z.countries || []).join(', ') || '—'}</td><td>\${(z.rates || []).length}</td><td>\${z.isActive ? '<span class="badge ok">Active</span>' : '<span class="badge muted">Off</span>'}</td></tr>\`).join('')}</tbody></table>\` : '<div class="empty">No shipping zones — using flat fallback rate</div>'}
    </div></div>\`;
  $('#z-new').onclick = () => modal({
    title: 'New shipping zone',
    body: \`<form id="zf">
      <div class="field"><label>Name</label><input name="name" required /></div>
      <div class="field"><label>Countries (comma-separated codes, e.g. US,CA)</label><input name="countries" placeholder="US" /></div>
      <div class="field"><label>Default rate name</label><input name="rateName" value="Standard" /></div>
      <div class="field-row">
        <div class="field"><label>Price (USD)</label><input name="price" type="number" step="0.01" value="9.99" /></div>
        <div class="field"><label>ETA (days)</label><input name="eta" type="number" value="5" /></div>
      </div>
    </form>\`,
    footer: '<button class="btn btn-ghost" id="cancel">Cancel</button><button class="btn btn-primary" id="save">Create</button>',
    onOpen: (root, close) => {
      $('#cancel', root).onclick = close;
      $('#save', root).onclick = async () => {
        const f = $('#zf', root);
        await api('/shipping/zones', { method: 'POST', body: {
          name: f.name.value,
          countries: f.countries.value.split(',').map(s => s.trim()).filter(Boolean),
          rates: [{ name: f.rateName.value, priceCents: Math.round(parseFloat(f.price.value) * 100), etaDays: parseInt(f.eta.value, 10) }],
          isActive: true,
        } });
        toast('Zone created'); close(); viewShipping();
      };
    },
  });
}

// =========================================================================
// GIFT CARDS
// =========================================================================
async function viewGiftCards() {
  const { data } = await api('/gift-cards');
  $('#view').innerHTML = \`
    <div class="toolbar"><div></div><button class="btn btn-primary" id="g-new">+ Issue Gift Card</button></div>
    <div class="card"><div class="card-b">\${data.length ? \`
      <table><thead><tr><th>Code</th><th>Recipient</th><th class="num">Initial</th><th class="num">Remaining</th><th>Status</th><th>When</th></tr></thead>
      <tbody>\${data.map(g => \`<tr><td class="mono">\${esc(g.code)}</td><td>\${esc(g.recipientEmail || '—')}</td><td class="num">\${fmtMoney(g.initialValueCents)}</td><td class="num">\${fmtMoney(g.remainingValueCents)}</td><td><span class="badge \${g.status === 'active' ? 'ok' : 'muted'}">\${g.status}</span></td><td style="color:var(--text-mute)">\${fmtDate(g.createdAt)}</td></tr>\`).join('')}</tbody></table>\` : '<div class="empty">No gift cards issued</div>'}
    </div></div>\`;
  $('#g-new').onclick = () => modal({
    title: 'Issue gift card',
    body: \`<form id="gf">
      <div class="field"><label>Amount (USD)</label><input name="amount" type="number" step="0.01" value="50" required /></div>
      <div class="field"><label>Recipient email</label><input name="recipientEmail" type="email" /></div>
      <div class="field"><label>Message</label><textarea name="message" rows="2"></textarea></div>
    </form>\`,
    footer: '<button class="btn btn-ghost" id="cancel">Cancel</button><button class="btn btn-primary" id="save">Issue</button>',
    onOpen: (root, close) => {
      $('#cancel', root).onclick = close;
      $('#save', root).onclick = async () => {
        const f = $('#gf', root);
        await api('/gift-cards', { method: 'POST', body: {
          initialValueCents: Math.round(parseFloat(f.amount.value) * 100),
          recipientEmail: f.recipientEmail.value, message: f.message.value,
        } });
        toast('Gift card issued'); close(); viewGiftCards();
      };
    },
  });
}

// =========================================================================
// CATEGORIES
// =========================================================================
async function viewCategories() {
  const { data } = await api('/categories');
  $('#view').innerHTML = \`
    <div class="toolbar"><div></div><button class="btn btn-primary" id="c-new">+ New Category</button></div>
    <div class="card"><div class="card-b">\${data.length ? \`
      <table><thead><tr><th>Name</th><th>Slug</th><th>Parent</th><th>Active</th></tr></thead>
      <tbody>\${data.map(c => \`<tr><td>\${esc(c.name)}</td><td class="mono">\${esc(c.slug)}</td><td>\${esc(data.find(p => p.id === c.parentId)?.name || '—')}</td><td>\${c.isActive ? '<span class="badge ok">Active</span>' : '<span class="badge muted">Off</span>'}</td></tr>\`).join('')}</tbody></table>\` : '<div class="empty">No categories</div>'}
    </div></div>\`;
  $('#c-new').onclick = () => modal({
    title: 'New category',
    body: \`<form id="cf"><div class="field"><label>Name</label><input name="name" required /></div><div class="field"><label>Description</label><textarea name="description" rows="2"></textarea></div></form>\`,
    footer: '<button class="btn btn-ghost" id="cancel">Cancel</button><button class="btn btn-primary" id="save">Create</button>',
    onOpen: (root, close) => {
      $('#cancel', root).onclick = close;
      $('#save', root).onclick = async () => {
        const f = $('#cf', root);
        await api('/categories', { method: 'POST', body: { name: f.name.value, description: f.description.value, isActive: true } });
        toast('Created'); close(); viewCategories();
      };
    },
  });
}

// =========================================================================
// SETTINGS
// =========================================================================
async function viewSettings() {
  const health = await api('/health').catch(() => ({}));
  $('#view').innerHTML = \`
    <div class="card"><div class="card-h"><h2>System</h2></div><div class="card-pad">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        <div class="stat"><div class="label">Database</div><div class="value" style="font-size:16px;color:var(--good)">\${esc(health.db || '—')}</div></div>
        <div class="stat"><div class="label">Email</div><div class="value" style="font-size:16px">\${health.email ? '<span class="badge ok">Configured</span>' : '<span class="badge muted">SMTP not set</span>'}</div></div>
        <div class="stat"><div class="label">Shipping</div><div class="value" style="font-size:16px">\${health.shipping ? '<span class="badge ok">Shippo on</span>' : '<span class="badge muted">Flat-rate</span>'}</div></div>
      </div>
    </div></div>
    <div class="card"><div class="card-h"><h2>Connected processors</h2></div><div class="card-pad" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
      \${(health.processors || []).map(p => \`<div class="proc-card"><div class="name">\${esc(p.id)}</div><span class="badge \${p.configured ? 'ok' : 'muted'}">\${p.configured ? 'On' : 'Off'}</span></div>\`).join('')}
    </div></div>
    <div class="card"><div class="card-h"><h2>About</h2></div><div class="card-pad" style="color:var(--text-mute)">
      <p>API base: <span class="mono">/api</span></p>
      <p>Add credentials to <span class="mono">.env</span> and restart to enable processors and integrations.</p>
    </div></div>\`;
}

// =========================================================================
// Utilities
// =========================================================================
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// =========================================================================
// Real-time updates
// =========================================================================
function connectSocket() {
  try {
    const s = io('/', { auth: { token: state.token } });
    s.on('connect', () => s.emit('join-admin'));
    ['order:created','order:fulfilled','order:refunded','order:paid','inventory:changed'].forEach(evt => {
      s.on(evt, (payload) => {
        toast(evt.replace(':', ' ') + (payload?.orderNumber ? ': ' + payload.orderNumber : ''));
      });
    });
  } catch {}
}

// =========================================================================
// Boot
// =========================================================================
(async function boot() {
  await checkAuth();
  if (state.token && window.io) connectSocket();
})();
</script>
<script src="/socket.io/socket.io.js" onload="state.token && connectSocket && connectSocket()"></script>
</body>
</html>`;
}

module.exports = { html };
