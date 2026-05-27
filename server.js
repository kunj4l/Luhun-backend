'use strict';

require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const { Server: SocketIOServer } = require('socket.io');
const winston = require('winston');
const jwt = require('jsonwebtoken');

const models = require('./models');
const { buildRouter } = require('./routes');
const services = require('./services');
const adminDashboard = require('./admin-dashboard');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.printf(
    ({ timestamp, level, message }) => `${timestamp} [${level}] ${message}`
  )),
  transports: [new winston.transports.Console()],
});

const PORT = Number(process.env.PORT || 4000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const APP_NAME = process.env.APP_NAME || "Luhun's Official";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: (process.env.CORS_ORIGIN || '*').split(','), credentials: true },
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
const corsOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: process.env.NODE_ENV === 'production' && corsOrigins[0] !== '*'
    ? corsOrigins
    : true,
  credentials: true,
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Capture raw body for webhook signature verification.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/webhooks/')) {
    let data = Buffer.alloc(0);
    req.on('data', chunk => { data = Buffer.concat([data, chunk]); });
    req.on('end', () => {
      req.rawBody = data;
      try { req.body = JSON.parse(data.toString() || '{}'); } catch { req.body = {}; }
      next();
    });
  } else next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use('/api', rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
}));

app.set('io', io);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api', buildRouter());

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.get('/admin', (req, res) => res.type('html').send(adminDashboard.html()));
app.get('/admin/*', (req, res) => res.type('html').send(adminDashboard.html()));

// Luhun storefront (same origin as API — avoids CORS / localhost issues)
const storefrontPath = path.join(__dirname, '..', 'luhun-official');
if (fs.existsSync(storefrontPath)) {
  app.use('/store', express.static(storefrontPath, { index: 'index.html' }));
  app.get('/store', (req, res) => res.sendFile(path.join(storefrontPath, 'index.html')));
  logger.info(`[store] serving Luhun storefront at ${APP_URL}/store`);
}

app.get('/', (req, res) => res.json({
  name: APP_NAME,
  store: fs.existsSync(storefrontPath) ? `${APP_URL}/store` : null,
  admin: `${APP_URL}/admin`,
  api: `${APP_URL}/api`,
  health: `${APP_URL}/health`,
}));

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error(`${req.method} ${req.path} :: ${err.message}`);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
    socket.user = payload;
  } catch { /* anonymous */ }
  next();
});

io.on('connection', (socket) => {
  socket.on('join-admin', () => {
    if (socket.user && ['owner', 'admin', 'manager', 'staff'].includes(socket.user.role)) {
      socket.join('admin');
    }
  });
});

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------
const inventoryService = services.makeInventoryService(models);

cron.schedule('0 8 * * *', async () => {
  logger.info('[cron] daily low-stock check');
  try {
    const alerts = await inventoryService.checkLowStockAndAlert();
    logger.info(`[cron] ${alerts.length} low-stock variants alerted`);
  } catch (e) { logger.error('[cron] low-stock failed: ' + e.message); }
});

cron.schedule('0 3 * * 0', async () => {
  logger.info('[cron] weekly expired cart cleanup (Sunday 3am)');
  try {
    const now = new Date();
    const { Op } = models;
    const result = await models.Cart.destroy({ where: { expiresAt: { [Op.lt]: now } } });
    logger.info(`[cron] ${result} expired carts cleaned`);
  } catch (e) { logger.error('[cron] cart cleanup failed: ' + e.message); }
});

cron.schedule('0 9 * * 1', async () => {
  logger.info('[cron] weekly dispute reminder (Monday 9am)');
  try {
    const open = await models.WebhookLog.findAll({ where: { event: 'charge.dispute.created', status: 'received' } });
    if (open.length) {
      await services.emailService.send({
        to: process.env.LOW_STOCK_ALERT_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || 'ops@example.com',
        subject: `${open.length} open dispute${open.length === 1 ? '' : 's'} need attention`,
        html: `<p>You have ${open.length} open Stripe disputes. Review them in your admin dashboard.</p>`,
      }).catch(() => {});
    }
    logger.info(`[cron] ${open.length} disputes flagged`);
  } catch (e) { logger.error('[cron] dispute reminder failed: ' + e.message); }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function bootstrapAdmin() {
  const name = process.env.BOOTSTRAP_ADMIN_NAME || 'Luhun';
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'luhun@luhunofficial.com';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Luhun2026!';
  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 12));

  let user = await models.User.findOne({ where: { role: 'owner' } });
  if (!user) user = await models.User.findOne({ where: { email } });
  if (!user) user = await models.User.findOne({ where: { name } });

  if (user) {
    await user.update({
      email, name, passwordHash, role: 'owner', status: 'active',
      failedLoginCount: 0, lockedUntil: null,
    });
    logger.info(`[bootstrap] Admin updated — username "${name}"`);
  } else {
    await models.User.create({
      email, passwordHash, name, role: 'owner', status: 'active',
    });
    logger.info(`[bootstrap] Admin created — username "${name}"`);
  }
}

async function ensureUploadsDir() {
  const dir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function banner() {
  const line = (s) => `  │  ${s.padEnd(58)}│`;
  const bar  = `  ╭${'─'.repeat(60)}╮`;
  const end  = `  ╰${'─'.repeat(60)}╯`;
  console.log('');
  console.log(bar);
  console.log(line(`${APP_NAME} · backend started`));
  console.log(line(''));
  console.log(line(`  App           ${APP_URL}`));
  if (fs.existsSync(path.join(__dirname, '..', 'luhun-official'))) {
    console.log(line(`  Storefront    ${APP_URL}/store`));
  }
  console.log(line(`  Admin panel   ${APP_URL}/admin`));
  console.log(line(`  API base      ${APP_URL}/api`));
  console.log(line(`  Health        ${APP_URL}/health`));
  console.log(line(''));
  console.log(line(`  Env           ${process.env.NODE_ENV || 'development'}`));
  const dbLabel = models.sequelize.getDialect() === 'postgres' ? 'PostgreSQL' : 'SQLite';
  console.log(line(`  Database      ${dbLabel}`));
  console.log(end);
  console.log('');
}

(async function start() {
  try {
    await ensureUploadsDir();
    await models.sequelize.authenticate();
    logger.info('[db] connected');
    await models.sequelize.sync();
    logger.info('[db] synced');
    await bootstrapAdmin();

    if (process.env.STORE_AUTO_SYNC === 'true') {
      const catalogDir = process.env.LUHUN_CATALOG_DIR
        || path.join(__dirname, '..', 'luhun-official', 'js');
      const hasCatalog = fs.existsSync(path.join(catalogDir, 'shoes-catalog.json'))
        && fs.existsSync(path.join(catalogDir, 'clothing-catalog.json'));
      const count = await models.Product.count();
      if (count === 0 && hasCatalog) {
        logger.info('[sync] empty catalog — importing Luhun products...');
        try {
          const { spawnSync } = require('child_process');
          const r = spawnSync(process.execPath, ['scripts/sync-luhun-catalog.mjs'], {
            cwd: process.cwd(),
            stdio: 'inherit',
            env: { ...process.env, LUHUN_CATALOG_DIR: catalogDir },
          });
          if (r.status !== 0) logger.warn('[sync] catalog import exited with code ' + r.status);
          else logger.info('[sync] catalog import complete (' + (await models.Product.count()) + ' products)');
        } catch (e) {
          logger.warn('[sync] auto-import skipped: ' + e.message);
        }
      } else if (count === 0 && !hasCatalog) {
        logger.warn('[sync] skipped — catalog JSON not on server (run npm run sync:luhun locally or add products in admin)');
      }
    }

    server.listen(PORT, '0.0.0.0', () => {
      banner();
      logger.info(`Ready on port ${PORT}`);
    });
  } catch (e) {
    logger.error('Startup failed: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();

process.on('unhandledRejection', (err) => logger.error('[unhandledRejection] ' + (err?.message || err)));
process.on('uncaughtException', (err) => { logger.error('[uncaughtException] ' + err.message); console.error(err.stack); });
