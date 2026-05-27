'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const slugify = require('slugify');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const models = require('../models');
const { Op } = models;
const services = require('../services');
const { paymentService } = require('../services/payment');
const { toStorefrontProduct, resolveVariantId, filterStorefrontProducts } = require('../services/storefront');

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const ACCOUNT_LOCK_THRESHOLD = Number(process.env.ACCOUNT_LOCK_THRESHOLD || 5);
const ACCOUNT_LOCK_MINUTES = Number(process.env.ACCOUNT_LOCK_MINUTES || 15);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const STAFF_ROLES = ['owner', 'admin', 'manager', 'staff'];
const ADMIN_ROLES = ['owner', 'admin'];
const MANAGER_PLUS = ['owner', 'admin', 'manager'];

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token || null;
  if (!token) return res.status(401).json({ error: 'Auth required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await models.User.findByPk(payload.sub);
    if (!user || user.status === 'suspended') return res.status(401).json({ error: 'Invalid session' });
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

async function audit(req, action, entity, entityId, changes = {}) {
  try {
    await models.AuditLog.create({
      userId: req.user?.id,
      action, entity, entityId: entityId ? String(entityId) : null,
      changes,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  } catch (e) { /* swallow */ }
}

function asyncH(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function pagination(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

function pickAdminEmit(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.to('admin').emit(event, payload);
}

function buildOrderTimeline(order) {
  const o = order.toJSON ? order.toJSON() : order;
  const cancelled = o.status === 'cancelled';
  const refunded = o.status === 'refunded' || o.paymentStatus === 'refunded';
  const paid = ['paid', 'authorized', 'partially_refunded', 'refunded'].includes(o.paymentStatus) || !!o.paidAt;
  const shipped = ['shipped', 'delivered'].includes(o.status);
  const delivered = o.status === 'delivered';
  const processing = ['partially_fulfilled', 'fulfilled', 'paid', 'shipped', 'delivered'].includes(o.status)
    || o.fulfillmentStatus === 'partial' || o.fulfillmentStatus === 'fulfilled';

  const steps = [
    {
      key: 'placed',
      label: 'Order placed',
      detail: 'We received your order.',
      date: o.createdAt,
      state: 'done',
    },
    {
      key: 'paid',
      label: paid ? 'Payment confirmed' : 'Awaiting payment',
      detail: paid ? 'Payment has been received.' : 'Payment is still pending.',
      date: o.paidAt,
      state: cancelled ? 'skipped' : paid ? 'done' : 'current',
    },
    {
      key: 'processing',
      label: 'Processing',
      detail: 'Your items are being prepared.',
      date: null,
      state: cancelled || refunded ? 'skipped' : processing ? 'done' : paid ? 'current' : 'pending',
    },
    {
      key: 'shipped',
      label: shipped ? 'Shipped' : 'Shipping',
      detail: o.trackingNumber
        ? `Tracking: ${o.trackingCarrier || 'Carrier'} · ${o.trackingNumber}`
        : 'You will get tracking when your order ships.',
      date: o.fulfilledAt,
      state: cancelled || refunded ? 'skipped' : shipped ? 'done' : processing ? 'current' : 'pending',
    },
    {
      key: 'delivered',
      label: 'Delivered',
      detail: 'Package delivered.',
      date: null,
      state: cancelled || refunded ? 'skipped' : delivered ? 'done' : 'pending',
    },
  ];

  if (cancelled) {
    steps.push({
      key: 'cancelled',
      label: 'Order cancelled',
      detail: 'This order was cancelled.',
      date: o.cancelledAt,
      state: 'done',
    });
  }
  if (refunded && !cancelled) {
    steps.push({
      key: 'refunded',
      label: 'Refunded',
      detail: 'A refund has been issued.',
      date: null,
      state: 'done',
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Build router
// ---------------------------------------------------------------------------
function buildRouter() {
  const router = express.Router();
  const inventoryService = services.makeInventoryService(models);

  // ---- Rate limiting ----
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, try again later' },
  });

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  router.get('/health', asyncH(async (req, res) => {
    await models.sequelize.authenticate();
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      db: 'connected',
      products: await models.Product.count(),
      processors: paymentService.status(),
      shipping: services.shippingService.configured(),
      email: services.emailService.configured(),
    });
  }));

  // -------------------------------------------------------------------------
  // Storefront (public — Luhun website ↔ CRM)
  // -------------------------------------------------------------------------
  router.get('/storefront/catalog', asyncH(async (req, res) => {
    const rows = await models.Product.findAll({
      where: { status: 'active' },
      include: [{ association: 'variants', where: { isActive: true }, required: false }],
      order: [['title', 'ASC']],
    });
    let data = rows.map((p) => toStorefrontProduct(p.toJSON()));
    data = filterStorefrontProducts(data, req.query);
    res.json({ data, total: data.length, source: 'crm' });
  }));

  router.get('/storefront/products/:storefrontId', asyncH(async (req, res) => {
    const rows = await models.Product.findAll({
      where: { status: 'active' },
      include: [{ association: 'variants', where: { isActive: true }, required: false }],
    });
    const match = rows
      .map((p) => toStorefrontProduct(p.toJSON()))
      .find((p) => p.id === req.params.storefrontId || p.handle === req.params.storefrontId);
    if (!match) return res.status(404).json({ error: 'Product not found' });
    res.json({ data: match });
  }));

  router.post('/storefront/checkout', asyncH(async (req, res) => {
    const { email, name, items = [], shippingAddress, notes } = req.body;
    if (!email || !items.length) {
      return res.status(400).json({ error: 'Email and items are required' });
    }

    let user = await models.User.findOne({ where: { email } });
    if (!user) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), BCRYPT_ROUNDS);
      user = await models.User.create({
        email,
        name: name || email.split('@')[0],
        passwordHash,
        role: 'customer',
        status: 'active',
      });
    } else if (name && !user.name) {
      await user.update({ name });
    }

    let subtotalCents = 0;
    const validatedItems = [];
    for (const it of items) {
      const variant = await models.ProductVariant.findByPk(it.variantId, { include: ['product'] });
      if (!variant) return res.status(400).json({ error: `Variant not found: ${it.variantId}` });
      const qty = it.quantity || 1;
      if (variant.stockQuantity - variant.reservedQuantity < qty) {
        return res.status(409).json({ error: `Insufficient stock for ${variant.sku}` });
      }
      const lineTotal = variant.priceCents * qty;
      subtotalCents += lineTotal;
      validatedItems.push({
        variantId: variant.id,
        productId: variant.productId,
        sku: variant.sku,
        title: variant.product?.title,
        variantTitle: variant.title,
        quantity: qty,
        unitPriceCents: variant.priceCents,
        totalCents: lineTotal,
        costCents: variant.costCents,
      });
    }

    const zones = await models.ShippingZone.findAll({ where: { isActive: true } });
    const rates = await services.shippingService.getRates({
      toAddress: shippingAddress || { country: 'US' },
      weightGrams: 500,
      zones: zones.map((z) => z.toJSON()),
    });
    const shippingCents = Math.round(((rates[0]?.amount) || 9.99) * 100);
    const taxCents = 0;
    const totalCents = subtotalCents + shippingCents + taxCents;

    const orderNumber = `LUH-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 4).toUpperCase()}`;
    const order = await models.Order.create({
      orderNumber,
      userId: user.id,
      email: user.email,
      status: 'pending',
      paymentStatus: 'unpaid',
      channel: 'web',
      subtotalCents,
      shippingCents,
      taxCents,
      totalCents,
      shippingAddress: shippingAddress || null,
      notes: notes || 'Luhun storefront checkout',
      metadata: { source: 'luhun-official' },
    });

    for (const it of validatedItems) {
      await models.OrderItem.create({ ...it, orderId: order.id });
      await inventoryService.reserve({
        variantId: it.variantId,
        quantity: it.quantity,
        referenceId: order.id,
      });
    }

    await services.emailService.send({
      to: email,
      template: 'order_confirmation',
      data: {
        orderNumber,
        customerName: name || user.name,
        itemCount: validatedItems.reduce((n, i) => n + i.quantity, 0),
        totalFormatted: `$${(totalCents / 100).toFixed(2)}`,
        items: validatedItems.map((i) => ({
          title: i.title,
          quantity: i.quantity,
          lineTotal: `$${(i.totalCents / 100).toFixed(2)}`,
        })),
      },
    }).catch(() => {});

    pickAdminEmit(req, 'order:created', { id: order.id, orderNumber });
    res.status(201).json({
      data: {
        orderNumber,
        orderId: order.id,
        totalCents,
        email,
        message: 'Order created in CRM — view in admin dashboard under Orders',
      },
    });
  }));

  router.post('/storefront/resolve-variant', asyncH(async (req, res) => {
    const { storefrontId, size } = req.body;
    const rows = await models.Product.findAll({
      where: { status: 'active' },
      include: [{ association: 'variants', where: { isActive: true }, required: false }],
    });
    const product = rows
      .map((p) => toStorefrontProduct(p.toJSON()))
      .find((p) => p.id === storefrontId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const variantId = resolveVariantId(product, size);
    if (!variantId) return res.status(400).json({ error: 'Could not resolve variant' });
    res.json({ data: { variantId, product } });
  }));

  router.post('/storefront/track', asyncH(async (req, res) => {
    const orderNumber = String(req.body.orderNumber || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!orderNumber || !email) {
      return res.status(400).json({ error: 'Order number and email are required' });
    }

    const order = await models.Order.findOne({
      where: { orderNumber },
      include: [{ association: 'items' }],
    });
    if (!order || String(order.email || '').toLowerCase() !== email) {
      return res.status(404).json({ error: 'Order not found — check your order number and email' });
    }

    const timeline = buildOrderTimeline(order);
    res.json({
      data: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        fulfilledAt: order.fulfilledAt,
        cancelledAt: order.cancelledAt,
        trackingNumber: order.trackingNumber,
        trackingCarrier: order.trackingCarrier,
        trackingUrl: order.trackingUrl,
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
        items: (order.items || []).map((it) => ({
          title: it.title,
          variantTitle: it.variantTitle,
          sku: it.sku,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          totalCents: it.totalCents,
          fulfillmentStatus: it.fulfillmentStatus,
        })),
        timeline,
      },
    });
  }));

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
  router.post('/auth/register', authLimiter, asyncH(async (req, res) => {
    const { email, password, name, phone, marketingOptIn } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const exists = await models.User.findOne({ where: { email } });
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await models.User.create({ email, passwordHash, name, phone, marketingOptIn, role: 'customer' });
    const token = signToken(user);
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  }));

  router.post('/auth/login', authLimiter, asyncH(async (req, res) => {
    const { email: loginId, password } = req.body;
    if (!loginId || !password) return res.status(400).json({ error: 'Username and password required' });
    const id = String(loginId).trim();
    const user = await models.User.findOne({
      where: id.includes('@')
        ? { email: id }
        : {
            [Op.or]: [
              { name: id },
              models.sequelize.where(
                models.sequelize.fn('lower', models.sequelize.col('name')),
                id.toLowerCase()
              ),
            ],
          },
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({ error: 'Account locked, try later', until: user.lockedUntil });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      user.failedLoginCount += 1;
      if (user.failedLoginCount >= ACCOUNT_LOCK_THRESHOLD) {
        user.lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000);
        user.failedLoginCount = 0;
      }
      await user.save();
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();
    const token = signToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  }));

  router.post('/auth/forgot-password', authLimiter, asyncH(async (req, res) => {
    const { email } = req.body;
    const user = await models.User.findOne({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.resetPasswordToken = token;
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60_000);
      await user.save();
      const url = `${process.env.APP_URL || 'http://localhost:4000'}/reset-password?token=${token}`;
      await services.emailService.send({ to: email, template: 'password_reset', data: { resetUrl: url } });
    }
    res.json({ ok: true });
  }));

  router.post('/auth/reset-password', authLimiter, asyncH(async (req, res) => {
    const { token, password } = req.body;
    const user = await models.User.findOne({ where: { resetPasswordToken: token, resetPasswordExpires: { [Op.gt]: new Date() } } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
    user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    res.json({ ok: true });
  }));

  // -------------------------------------------------------------------------
  // Me
  // -------------------------------------------------------------------------
  router.get('/me', auth, asyncH(async (req, res) => {
    const me = await models.User.findByPk(req.user.id, { include: [{ association: 'addresses' }] });
    res.json({ user: me });
  }));
  router.put('/me', auth, asyncH(async (req, res) => {
    const { name, phone, marketingOptIn } = req.body;
    await req.user.update({ name, phone, marketingOptIn });
    res.json({ user: req.user });
  }));

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------
  router.get('/categories', asyncH(async (req, res) => {
    const rows = await models.Category.findAll({ order: [['position', 'ASC'], ['name', 'ASC']] });
    res.json({ data: rows });
  }));
  router.post('/categories', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const { name, parentId, description, position, image, isActive } = req.body;
    const slug = slugify(name || '', { lower: true, strict: true }) || uuidv4().slice(0, 8);
    const row = await models.Category.create({ name, slug, parentId, description, position, image, isActive });
    await audit(req, 'create', 'Category', row.id, row.toJSON());
    res.status(201).json({ data: row });
  }));
  router.put('/categories/:id', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const row = await models.Category.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update(req.body);
    await audit(req, 'update', 'Category', row.id, req.body);
    res.json({ data: row });
  }));
  router.delete('/categories/:id', auth, requireRole(...ADMIN_ROLES), asyncH(async (req, res) => {
    const row = await models.Category.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    await audit(req, 'delete', 'Category', row.id);
    res.json({ ok: true });
  }));

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------
  router.get('/products', asyncH(async (req, res) => {
    const { q, status, categoryId, sort = 'createdAt', dir = 'DESC' } = req.query;
    const { limit, offset, page } = pagination(req);
    const where = {};
    if (q) where.title = { [Op.like]: `%${q}%` };
    if (status) where.status = status;
    if (categoryId) where.categoryId = categoryId;
    const { rows, count } = await models.Product.findAndCountAll({
      where, limit, offset,
      order: [[sort, dir]],
      include: [{ association: 'variants' }, { association: 'category' }],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  }));

  router.get('/products/:id', asyncH(async (req, res) => {
    const p = await models.Product.findByPk(req.params.id, {
      include: [{ association: 'variants' }, { association: 'category' }, { association: 'reviews' }],
    });
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ data: p });
  }));

  router.post('/products', auth, requireRole(...MANAGER_PLUS), upload.array('images', 8), asyncH(async (req, res) => {
    const body = parseJsonBody(req.body);
    const imageUrls = await processImages(req.files || []);
    const slug = slugify(body.title || '', { lower: true, strict: true }) || uuidv4().slice(0, 8);
    const product = await models.Product.create({
      ...body, slug,
      images: [...(body.images || []), ...imageUrls],
    });
    if (Array.isArray(body.variants)) {
      for (const v of body.variants) {
        await models.ProductVariant.create({ ...v, productId: product.id, sku: v.sku || `${slug}-${uuidv4().slice(0,4)}` });
      }
    }
    await audit(req, 'create', 'Product', product.id, product.toJSON());
    pickAdminEmit(req, 'product:created', { id: product.id });
    res.status(201).json({ data: product });
  }));

  router.put('/products/:id', auth, requireRole(...MANAGER_PLUS), upload.array('images', 8), asyncH(async (req, res) => {
    const product = await models.Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    const body = parseJsonBody(req.body);
    const imageUrls = await processImages(req.files || []);
    const merged = { ...body };
    if (imageUrls.length) merged.images = [...(product.images || []), ...imageUrls];
    await product.update(merged);
    await audit(req, 'update', 'Product', product.id, merged);
    res.json({ data: product });
  }));

  router.delete('/products/:id', auth, requireRole(...ADMIN_ROLES), asyncH(async (req, res) => {
    const product = await models.Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Not found' });
    await product.destroy();
    await audit(req, 'delete', 'Product', product.id);
    res.json({ ok: true });
  }));

  // Variants
  router.get('/products/:id/variants', asyncH(async (req, res) => {
    const rows = await models.ProductVariant.findAll({ where: { productId: req.params.id }, order: [['position', 'ASC']] });
    res.json({ data: rows });
  }));
  router.post('/products/:id/variants', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const product = await models.Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const sku = req.body.sku || `${product.slug}-${uuidv4().slice(0, 4)}`;
    const v = await models.ProductVariant.create({ ...req.body, productId: product.id, sku });
    await audit(req, 'create', 'ProductVariant', v.id, v.toJSON());
    res.status(201).json({ data: v });
  }));
  router.put('/products/:id/variants/:variantId', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const v = await models.ProductVariant.findByPk(req.params.variantId);
    if (!v) return res.status(404).json({ error: 'Not found' });
    await v.update(req.body);
    await audit(req, 'update', 'ProductVariant', v.id, req.body);
    res.json({ data: v });
  }));

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------
  router.get('/inventory', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await inventoryService.getReport() });
  }));
  router.post('/inventory/adjust', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const { variantId, delta, reason } = req.body;
    const v = await inventoryService.adjust({ variantId, delta, reason, userId: req.user.id });
    await audit(req, 'inventory.adjust', 'ProductVariant', v.id, { delta, reason });
    pickAdminEmit(req, 'inventory:changed', { variantId, stock: v.stockQuantity });
    res.json({ data: v });
  }));
  router.post('/inventory/bulk-adjust', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const results = await inventoryService.bulkUpdate({ updates: req.body.updates || [], userId: req.user.id });
    await audit(req, 'inventory.bulk_adjust', 'ProductVariant', null, { count: results.length });
    res.json({ data: results });
  }));
  router.get('/inventory/history', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await inventoryService.getHistory({ variantId: req.query.variantId, limit: Number(req.query.limit) || 100 }) });
  }));
  router.get('/inventory/value', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    res.json({ data: await inventoryService.getTotalValue() });
  }));

  // -------------------------------------------------------------------------
  // Cart
  // -------------------------------------------------------------------------
  router.get('/cart', asyncH(async (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.sessionID;
    let cart;
    if (req.headers.authorization) {
      try {
        const payload = jwt.verify(req.headers.authorization.replace('Bearer ', ''), JWT_SECRET);
        cart = await models.Cart.findOne({ where: { userId: payload.sub } });
      } catch {}
    }
    if (!cart && sessionId) cart = await models.Cart.findOne({ where: { sessionId } });
    if (!cart) cart = await models.Cart.create({ sessionId, items: [] });
    res.json({ data: cart });
  }));
  router.post('/cart', asyncH(async (req, res) => {
    const sessionId = req.headers['x-session-id'] || req.sessionID || uuidv4();
    const { items = [], discountCode } = req.body;
    let subtotalCents = 0;
    for (const it of items) subtotalCents += (it.unitPriceCents || 0) * (it.quantity || 1);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const userId = req.user?.id;
    const [cart] = await models.Cart.findOrCreate({
      where: userId ? { userId } : { sessionId },
      defaults: { sessionId, userId, items, subtotalCents, discountCode, expiresAt },
    });
    await cart.update({ items, subtotalCents, discountCode, expiresAt });
    res.json({ data: cart });
  }));

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------
  router.get('/orders', auth, asyncH(async (req, res) => {
    const { status, paymentStatus, channel, q } = req.query;
    const { limit, offset, page } = pagination(req);
    const where = {};
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (channel) where.channel = channel;
    if (q) where.orderNumber = { [Op.like]: `%${q}%` };
    if (!STAFF_ROLES.includes(req.user.role)) where.userId = req.user.id;
    const { rows, count } = await models.Order.findAndCountAll({
      where, limit, offset,
      order: [['createdAt', 'DESC']],
      include: [{ association: 'items' }, { association: 'customer', attributes: ['id', 'email', 'name'] }],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  }));

  router.get('/orders/:id', auth, asyncH(async (req, res) => {
    const order = await models.Order.findByPk(req.params.id, {
      include: [{ association: 'items' }, { association: 'customer' }, { association: 'refunds' }, { association: 'returns' }],
    });
    if (!order) return res.status(404).json({ error: 'Not found' });
    if (!STAFF_ROLES.includes(req.user.role) && order.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    res.json({ data: order });
  }));

  router.post('/orders', auth, asyncH(async (req, res) => {
    const { items = [], shippingAddress, billingAddress, shippingMethod, discountCode, giftCardCode, channel } = req.body;
    if (!items.length) return res.status(400).json({ error: 'No items' });

    let subtotalCents = 0;
    const validatedItems = [];
    for (const it of items) {
      const variant = await models.ProductVariant.findByPk(it.variantId, { include: ['product'] });
      if (!variant) return res.status(400).json({ error: `Variant not found: ${it.variantId}` });
      if (variant.stockQuantity - variant.reservedQuantity < it.quantity) {
        return res.status(409).json({ error: `Insufficient stock for ${variant.sku}` });
      }
      const lineTotal = variant.priceCents * it.quantity;
      subtotalCents += lineTotal;
      validatedItems.push({
        variantId: variant.id, productId: variant.productId, sku: variant.sku,
        title: variant.product?.title, variantTitle: variant.title,
        quantity: it.quantity, unitPriceCents: variant.priceCents,
        totalCents: lineTotal, costCents: variant.costCents,
      });
    }

    // Discount
    let discountCents = 0;
    let appliedDiscount = null;
    if (discountCode) {
      const d = await models.Discount.findOne({ where: { code: discountCode, isActive: true } });
      if (d && (!d.endsAt || d.endsAt > new Date()) && (!d.usageLimit || d.usageCount < d.usageLimit) && subtotalCents >= d.minSubtotalCents) {
        if (d.type === 'percentage') discountCents = Math.round(subtotalCents * (d.value / 100));
        else if (d.type === 'fixed') discountCents = Math.min(subtotalCents, Math.round(d.value * 100));
        appliedDiscount = d;
      }
    }

    // Gift card
    let giftCardCents = 0;
    let giftCard = null;
    if (giftCardCode) {
      giftCard = await models.GiftCard.findOne({ where: { code: giftCardCode, status: 'active' } });
      if (giftCard) giftCardCents = Math.min(giftCard.remainingValueCents, subtotalCents - discountCents);
    }

    // Shipping
    const zones = await models.ShippingZone.findAll({ where: { isActive: true } });
    const rates = await services.shippingService.getRates({
      toAddress: shippingAddress || {}, weightGrams: 500, zones: zones.map(z => z.toJSON()),
    });
    const shippingCents = Math.round(((rates[0]?.amount) || 9.99) * 100);

    // Tax
    const taxRates = await models.TaxRate.findAll({ where: shippingAddress?.country ? { country: shippingAddress.country } : {} });
    const rate = taxRates[0]?.rate || 0;
    const taxableBase = subtotalCents - discountCents;
    const taxCents = Math.round(taxableBase * rate);

    const totalCents = Math.max(0, subtotalCents + shippingCents + taxCents - discountCents - giftCardCents);

    const orderNumber = `CB-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0,4).toUpperCase()}`;
    const order = await models.Order.create({
      orderNumber, userId: req.user.id, email: req.user.email,
      channel: channel || 'web',
      subtotalCents, shippingCents, taxCents, discountCents: discountCents + giftCardCents,
      totalCents, shippingAddress, billingAddress, shippingMethod,
      discountCode, giftCardCode,
    });
    for (const it of validatedItems) {
      await models.OrderItem.create({ ...it, orderId: order.id });
      await inventoryService.reserve({ variantId: it.variantId, quantity: it.quantity, referenceId: order.id });
    }
    if (appliedDiscount) await appliedDiscount.increment('usageCount');
    if (giftCard && giftCardCents > 0) {
      giftCard.remainingValueCents -= giftCardCents;
      if (giftCard.remainingValueCents <= 0) giftCard.status = 'redeemed';
      await giftCard.save();
    }

    await audit(req, 'create', 'Order', order.id, { totalCents });
    pickAdminEmit(req, 'order:created', { id: order.id, orderNumber });
    res.status(201).json({ data: await models.Order.findByPk(order.id, { include: ['items'] }) });
  }));

  router.patch('/orders/:id', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const order = await models.Order.findByPk(req.params.id, { include: ['items'] });
    if (!order) return res.status(404).json({ error: 'Not found' });
    const allowed = ['status', 'paymentStatus', 'fulfillmentStatus', 'notes', 'metadata'];
    const updates = {};
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    await order.update(updates);
    await audit(req, 'update', 'Order', order.id, updates);
    pickAdminEmit(req, 'order:updated', { id: order.id });
    res.json({ data: order });
  }));

  router.post('/orders/:id/fulfill', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const order = await models.Order.findByPk(req.params.id, { include: ['items'] });
    if (!order) return res.status(404).json({ error: 'Not found' });
    const { trackingNumber, carrier, trackingUrl } = req.body;
    for (const it of order.items) {
      await inventoryService.commit({ variantId: it.variantId, quantity: it.quantity, referenceId: order.id });
      await it.update({ fulfillmentStatus: 'fulfilled' });
    }
    await order.update({
      status: 'shipped', fulfillmentStatus: 'fulfilled',
      trackingNumber, trackingCarrier: carrier, trackingUrl,
      fulfilledAt: new Date(),
    });
    if (order.email) {
      await services.emailService.send({
        to: order.email, template: 'shipment_notification',
        data: { orderNumber: order.orderNumber, trackingNumber, carrier, trackingUrl },
      }).catch(() => {});
    }
    await audit(req, 'fulfill', 'Order', order.id, { trackingNumber });
    pickAdminEmit(req, 'order:fulfilled', { id: order.id });
    res.json({ data: order });
  }));

  router.post('/orders/:id/cancel', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const order = await models.Order.findByPk(req.params.id, { include: ['items'] });
    if (!order) return res.status(404).json({ error: 'Not found' });
    for (const it of order.items) {
      await inventoryService.release({ variantId: it.variantId, quantity: it.quantity, referenceId: order.id }).catch(() => {});
    }
    await order.update({ status: 'cancelled', cancelledAt: new Date() });
    await audit(req, 'cancel', 'Order', order.id);
    res.json({ data: order });
  }));

  router.post('/orders/:id/refund', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const order = await models.Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    const { amountCents = order.totalCents - order.refundedCents, reason } = req.body;
    let processorRefundId = null; let processorStatus = 'pending';
    if (order.paymentProcessor && order.paymentReference) {
      try {
        const opts = order.paymentProcessor === 'stripe'
          ? { paymentIntentId: order.paymentReference, amountCents, reason }
          : order.paymentProcessor === 'paypal'
            ? { captureId: order.paymentReference, amountCents }
            : order.paymentProcessor === 'square'
              ? { paymentId: order.paymentReference, amountCents, reason }
              : order.paymentProcessor === 'braintree'
                ? { transactionId: order.paymentReference, amountCents }
                : { orderId: order.paymentReference, amountCents };
        const r = await paymentService.refund(order.paymentProcessor, opts);
        processorRefundId = r.id; processorStatus = r.status;
      } catch (e) {
        return res.status(502).json({ error: `Processor refund failed: ${e.message}` });
      }
    }
    const refund = await models.Refund.create({
      orderId: order.id, amountCents, reason,
      processor: order.paymentProcessor, processorRefundId, status: processorStatus,
    });
    order.refundedCents += amountCents;
    order.paymentStatus = order.refundedCents >= order.totalCents ? 'refunded' : 'partially_refunded';
    if (order.paymentStatus === 'refunded') order.status = 'refunded';
    await order.save();
    await audit(req, 'refund', 'Order', order.id, { amountCents });
    pickAdminEmit(req, 'order:refunded', { id: order.id, amountCents });
    res.json({ data: { order, refund } });
  }));

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------
  router.post('/payments/stripe/intent', auth, asyncH(async (req, res) => {
    const { amountCents, currency, metadata } = req.body;
    const result = await paymentService.process('stripe', { amountCents, currency, metadata, customerEmail: req.user.email });
    res.json(result);
  }));
  router.post('/payments/paypal/order', auth, asyncH(async (req, res) => {
    const { amountCents, currency, returnUrl, cancelUrl } = req.body;
    res.json(await paymentService.process('paypal', { amountCents, currency, returnUrl, cancelUrl }));
  }));
  router.post('/payments/paypal/:id/capture', auth, asyncH(async (req, res) => {
    res.json(await paymentService.get('paypal').capture(req.params.id));
  }));
  router.post('/payments/braintree/token', auth, asyncH(async (req, res) => {
    res.json({ clientToken: await paymentService.get('braintree').clientToken({ customerId: req.body.customerId }) });
  }));
  router.post('/payments/square/charge', auth, asyncH(async (req, res) => {
    res.json(await paymentService.process('square', req.body));
  }));
  router.post('/payments/klarna/session', auth, asyncH(async (req, res) => {
    res.json(await paymentService.process('klarna', req.body));
  }));
  router.post('/payments/afterpay/checkout', auth, asyncH(async (req, res) => {
    res.json(await paymentService.process('afterpay', req.body));
  }));
  router.post('/payments/afterpay/capture', auth, asyncH(async (req, res) => {
    res.json(await paymentService.get('afterpay').capture(req.body));
  }));
  router.post('/payments/crypto/charge', auth, asyncH(async (req, res) => {
    res.json(await paymentService.process('coinbase', req.body));
  }));
  router.get('/payments/processors', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: paymentService.status() });
  }));

  // Webhooks (signature verification done in server.js for raw body)
  router.post('/webhooks/stripe', asyncH(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = paymentService.get('stripe').verifyWebhook(req.rawBody || Buffer.from(JSON.stringify(req.body)), sig);
    } catch (e) {
      await models.WebhookLog.create({ source: 'stripe', status: 'failed', errorMessage: e.message, payload: req.body });
      return res.status(400).json({ error: e.message });
    }
    await models.WebhookLog.create({ source: 'stripe', event: event.type, status: 'received', payload: event });

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const order = await models.Order.findOne({ where: { paymentReference: intent.id } });
        if (order) {
          await order.update({ paymentStatus: 'paid', status: 'paid', paidAt: new Date() });
          pickAdminEmit(req, 'order:paid', { id: order.id });
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        const order = await models.Order.findOne({ where: { paymentReference: intent.id } });
        if (order) await order.update({ paymentStatus: 'failed' });
        break;
      }
      case 'charge.dispute.created': {
        await models.Notification.create({
          type: 'dispute', title: 'New Stripe dispute',
          body: `Dispute on charge ${event.data.object.charge}`,
          payload: event.data.object,
        });
        break;
      }
    }
    res.json({ received: true });
  }));

  router.post('/webhooks/coinbase', asyncH(async (req, res) => {
    try {
      const payload = paymentService.get('coinbase').verifyWebhook(req.rawBody || Buffer.from(JSON.stringify(req.body)), req.headers['x-cc-webhook-signature']);
      await models.WebhookLog.create({ source: 'coinbase', event: payload.event?.type, status: 'received', payload });
      res.json({ ok: true });
    } catch (e) {
      await models.WebhookLog.create({ source: 'coinbase', status: 'failed', errorMessage: e.message });
      res.status(400).json({ error: e.message });
    }
  }));

  // -------------------------------------------------------------------------
  // Discounts
  // -------------------------------------------------------------------------
  router.get('/discounts', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await models.Discount.findAll({ order: [['createdAt', 'DESC']] }) });
  }));
  router.post('/discounts', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const row = await models.Discount.create(req.body);
    await audit(req, 'create', 'Discount', row.id, row.toJSON());
    res.status(201).json({ data: row });
  }));
  router.put('/discounts/:id', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const row = await models.Discount.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update(req.body);
    res.json({ data: row });
  }));
  router.delete('/discounts/:id', auth, requireRole(...ADMIN_ROLES), asyncH(async (req, res) => {
    const row = await models.Discount.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  }));
  router.post('/discounts/validate', asyncH(async (req, res) => {
    const { code, subtotalCents = 0 } = req.body;
    const d = await models.Discount.findOne({ where: { code, isActive: true } });
    if (!d) return res.status(404).json({ valid: false, reason: 'Not found' });
    if (d.endsAt && d.endsAt < new Date()) return res.json({ valid: false, reason: 'Expired' });
    if (d.startsAt && d.startsAt > new Date()) return res.json({ valid: false, reason: 'Not yet active' });
    if (d.usageLimit && d.usageCount >= d.usageLimit) return res.json({ valid: false, reason: 'Usage limit reached' });
    if (subtotalCents < d.minSubtotalCents) return res.json({ valid: false, reason: 'Subtotal too low' });
    let amountCents = 0;
    if (d.type === 'percentage') amountCents = Math.round(subtotalCents * (d.value / 100));
    else if (d.type === 'fixed') amountCents = Math.min(subtotalCents, Math.round(d.value * 100));
    res.json({ valid: true, discount: d, amountCents });
  }));

  // -------------------------------------------------------------------------
  // Returns
  // -------------------------------------------------------------------------
  router.get('/returns', auth, asyncH(async (req, res) => {
    const where = STAFF_ROLES.includes(req.user.role) ? {} : { userId: req.user.id };
    res.json({ data: await models.Return.findAll({ where, order: [['createdAt', 'DESC']] }) });
  }));
  router.post('/returns', auth, asyncH(async (req, res) => {
    const { orderId, items, reason } = req.body;
    const order = await models.Order.findByPk(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!STAFF_ROLES.includes(req.user.role) && order.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const rmaNumber = `RMA-${Date.now().toString(36).toUpperCase()}`;
    const r = await models.Return.create({ orderId, userId: order.userId, items, reason, rmaNumber });
    await audit(req, 'create', 'Return', r.id);
    res.status(201).json({ data: r });
  }));
  router.patch('/returns/:id', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const r = await models.Return.findByPk(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const { status, refundAmountCents, returnShippingLabelUrl, trackingNumber, notes } = req.body;
    const updates = { refundAmountCents, returnShippingLabelUrl, trackingNumber, notes };
    if (status) {
      updates.status = status;
      if (status === 'approved') {
        updates.approvedAt = new Date();
        const order = await models.Order.findByPk(r.orderId);
        if (order?.email) {
          await services.emailService.send({
            to: order.email, template: 'return_approved',
            data: { rmaNumber: r.rmaNumber, labelUrl: returnShippingLabelUrl },
          }).catch(() => {});
        }
      }
      if (status === 'received') updates.receivedAt = new Date();
      if (status === 'refunded') updates.refundedAt = new Date();
    }
    await r.update(updates);
    res.json({ data: r });
  }));

  // -------------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------------
  router.get('/reviews', asyncH(async (req, res) => {
    const where = { status: 'approved' };
    if (req.query.productId) where.productId = req.query.productId;
    res.json({ data: await models.Review.findAll({ where, include: ['author'], order: [['createdAt', 'DESC']] }) });
  }));
  router.post('/reviews', auth, asyncH(async (req, res) => {
    const { productId, rating, title, body } = req.body;
    const review = await models.Review.create({ productId, userId: req.user.id, rating, title, body });
    res.status(201).json({ data: review });
  }));
  router.patch('/reviews/:id', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const review = await models.Review.findByPk(req.params.id);
    if (!review) return res.status(404).json({ error: 'Not found' });
    const before = review.status;
    await review.update(req.body);
    if (review.status === 'approved' && before !== 'approved') {
      const product = await models.Product.findByPk(review.productId);
      if (product) {
        const allApproved = await models.Review.findAll({ where: { productId: product.id, status: 'approved' } });
        const sum = allApproved.reduce((s, r) => s + r.rating, 0);
        await product.update({ averageRating: sum / allApproved.length, ratingCount: allApproved.length });
      }
    }
    res.json({ data: review });
  }));

  // -------------------------------------------------------------------------
  // Suppliers & Purchase Orders
  // -------------------------------------------------------------------------
  router.get('/suppliers', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await models.Supplier.findAll() });
  }));
  router.post('/suppliers', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const row = await models.Supplier.create(req.body);
    res.status(201).json({ data: row });
  }));
  router.patch('/suppliers/:id', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const row = await models.Supplier.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update(req.body);
    res.json({ data: row });
  }));

  router.get('/purchase-orders', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await models.PurchaseOrder.findAll({ include: ['supplier'], order: [['createdAt', 'DESC']] }) });
  }));
  router.post('/purchase-orders', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
    const items = req.body.items || [];
    const subtotalCents = items.reduce((s, i) => s + (i.unitCostCents || 0) * (i.qty || 0), 0);
    const totalCents = subtotalCents + (req.body.shippingCents || 0) + (req.body.taxCents || 0);
    const po = await models.PurchaseOrder.create({ ...req.body, poNumber, subtotalCents, totalCents, createdBy: req.user.id });
    res.status(201).json({ data: po });
  }));
  router.patch('/purchase-orders/:id', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const po = await models.PurchaseOrder.findByPk(req.params.id);
    if (!po) return res.status(404).json({ error: 'Not found' });
    await po.update(req.body);
    res.json({ data: po });
  }));
  router.post('/purchase-orders/:id/receive', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const po = await models.PurchaseOrder.findByPk(req.params.id);
    if (!po) return res.status(404).json({ error: 'Not found' });
    const receipts = req.body.receipts || []; // [{variantId, qty}]
    for (const r of receipts) {
      await inventoryService.restock({
        variantId: r.variantId, quantity: r.qty,
        reason: 'po_receive', referenceType: 'PurchaseOrder', referenceId: po.id, userId: req.user.id,
      }).catch(() => {});
    }
    const allReceived = (po.items || []).every(i => {
      const rec = receipts.find(r => r.variantId === i.variantId);
      return rec && rec.qty >= i.qty;
    });
    await po.update({ status: allReceived ? 'received' : 'partial', receivedAt: new Date() });
    res.json({ data: po });
  }));

  // -------------------------------------------------------------------------
  // Shipping
  // -------------------------------------------------------------------------
  router.get('/shipping/zones', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await models.ShippingZone.findAll() });
  }));
  router.post('/shipping/zones', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    res.status(201).json({ data: await models.ShippingZone.create(req.body) });
  }));
  router.put('/shipping/zones/:id', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const z = await models.ShippingZone.findByPk(req.params.id);
    if (!z) return res.status(404).json({ error: 'Not found' });
    await z.update(req.body);
    res.json({ data: z });
  }));
  router.delete('/shipping/zones/:id', auth, requireRole(...ADMIN_ROLES), asyncH(async (req, res) => {
    const z = await models.ShippingZone.findByPk(req.params.id);
    if (!z) return res.status(404).json({ error: 'Not found' });
    await z.destroy();
    res.json({ ok: true });
  }));
  router.post('/shipping/rates', asyncH(async (req, res) => {
    const zones = await models.ShippingZone.findAll({ where: { isActive: true } });
    res.json({ data: await services.shippingService.getRates({ ...req.body, zones: zones.map(z => z.toJSON()) }) });
  }));
  router.post('/shipping/label', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await services.shippingService.buyLabel(req.body) });
  }));
  router.get('/shipping/track', asyncH(async (req, res) => {
    res.json({ data: await services.shippingService.track({ carrier: req.query.carrier, trackingNumber: req.query.trackingNumber }) });
  }));
  router.post('/shipping/validate-address', asyncH(async (req, res) => {
    res.json({ data: await services.shippingService.validateAddress(req.body) });
  }));

  // -------------------------------------------------------------------------
  // Gift cards
  // -------------------------------------------------------------------------
  router.get('/gift-cards', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await models.GiftCard.findAll({ order: [['createdAt', 'DESC']] }) });
  }));
  router.post('/gift-cards', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    const code = (req.body.code || `GC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`);
    const gc = await models.GiftCard.create({
      ...req.body, code,
      remainingValueCents: req.body.initialValueCents,
    });
    res.status(201).json({ data: gc });
  }));
  router.post('/gift-cards/redeem', asyncH(async (req, res) => {
    const { code, amountCents } = req.body;
    const gc = await models.GiftCard.findOne({ where: { code, status: 'active' } });
    if (!gc) return res.status(404).json({ error: 'Invalid or inactive gift card' });
    const applied = Math.min(gc.remainingValueCents, amountCents);
    gc.remainingValueCents -= applied;
    if (gc.remainingValueCents <= 0) gc.status = 'redeemed';
    await gc.save();
    res.json({ data: { applied, remaining: gc.remainingValueCents } });
  }));

  // -------------------------------------------------------------------------
  // Tax rates
  // -------------------------------------------------------------------------
  router.get('/tax-rates', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    res.json({ data: await models.TaxRate.findAll() });
  }));
  router.post('/tax-rates', auth, requireRole(...MANAGER_PLUS), asyncH(async (req, res) => {
    res.status(201).json({ data: await models.TaxRate.create(req.body) });
  }));

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------
  router.get('/customers', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const { limit, offset, page } = pagination(req);
    const where = { role: 'customer' };
    if (req.query.q) where.email = { [Op.like]: `%${req.query.q}%` };
    const { rows, count } = await models.User.findAndCountAll({
      where, limit, offset, order: [['createdAt', 'DESC']],
      attributes: { exclude: ['passwordHash', 'resetPasswordToken'] },
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  }));
  router.get('/customers/:id', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const user = await models.User.findByPk(req.params.id, {
      include: [{ association: 'addresses' }, { association: 'orders' }],
      attributes: { exclude: ['passwordHash', 'resetPasswordToken'] },
    });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ data: user });
  }));

  // -------------------------------------------------------------------------
  // Analytics
  // -------------------------------------------------------------------------
  router.get('/analytics/dashboard', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const period = Number(req.query.period) || 30;
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
    const orders = await models.Order.findAll({ where: { createdAt: { [Op.gte]: since } } });
    const paidOrders = orders.filter(o => ['paid', 'shipped', 'delivered', 'fulfilled', 'partially_fulfilled'].includes(o.status));
    const revenueCents = paidOrders.reduce((s, o) => s + o.totalCents - o.refundedCents, 0);
    const customers = await models.User.count({ where: { role: 'customer', createdAt: { [Op.gte]: since } } });
    const returns = await models.Return.count({ where: { createdAt: { [Op.gte]: since } } });
    const inventoryValue = await inventoryService.getTotalValue();
    res.json({
      data: {
        period,
        revenueCents,
        orders: orders.length,
        paidOrders: paidOrders.length,
        customers,
        aovCents: paidOrders.length ? Math.round(revenueCents / paidOrders.length) : 0,
        returnRate: orders.length ? returns / orders.length : 0,
        inventoryValueCents: inventoryValue.valueCents,
        inventoryUnits: inventoryValue.units,
      },
    });
  }));

  router.get('/analytics/revenue', auth, requireRole(...STAFF_ROLES), asyncH(async (req, res) => {
    const period = Number(req.query.period) || 30;
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
    const orders = await models.Order.findAll({
      where: { createdAt: { [Op.gte]: since }, paymentStatus: { [Op.in]: ['paid', 'partially_refunded', 'refunded'] } },
      attributes: ['createdAt', 'totalCents', 'refundedCents'],
    });
    const buckets = {};
    for (let i = 0; i < period; i++) {
      const d = new Date(since.getTime() + i * 86400000);
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 10);
      if (key in buckets) buckets[key] += o.totalCents - o.refundedCents;
    }
    res.json({ data: Object.entries(buckets).map(([date, cents]) => ({ date, cents })) });
  }));

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------
  router.get('/audit-log', auth, requireRole(...ADMIN_ROLES), asyncH(async (req, res) => {
    const { limit, offset, page } = pagination(req);
    const { rows, count } = await models.AuditLog.findAndCountAll({
      limit, offset, order: [['createdAt', 'DESC']],
      include: [{ association: 'actor', attributes: ['id', 'email', 'name', 'role'] }],
    });
    res.json({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  }));

  // -------------------------------------------------------------------------
  // Static uploads
  // -------------------------------------------------------------------------
  router.use('/uploads', express.static(UPLOAD_DIR));

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseJsonBody(body) {
  const out = { ...body };
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string' && (out[k].startsWith('{') || out[k].startsWith('['))) {
      try { out[k] = JSON.parse(out[k]); } catch {}
    }
  }
  return out;
}

async function processImages(files) {
  const urls = [];
  for (const file of files) {
    const filename = `${Date.now()}-${uuidv4().slice(0, 8)}.webp`;
    const fullPath = path.join(UPLOAD_DIR, filename);
    await sharp(file.buffer).resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(fullPath);
    urls.push(`/api/uploads/${filename}`);
  }
  return urls;
}

module.exports = { buildRouter, auth, requireRole, signToken, ADMIN_ROLES, MANAGER_PLUS, STAFF_ROLES };
