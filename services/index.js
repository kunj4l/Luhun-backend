'use strict';

const axios = require('axios');
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const { paymentService } = require('./payment');

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------
class ShippingService {
  constructor() {
    this.shippoKey = process.env.SHIPPO_API_KEY;
    this.shippoBase = 'https://api.goshippo.com';
    this.from = {
      name: process.env.DEFAULT_SHIP_FROM_NAME || 'Warehouse',
      street1: process.env.DEFAULT_SHIP_FROM_STREET || '',
      city: process.env.DEFAULT_SHIP_FROM_CITY || '',
      state: process.env.DEFAULT_SHIP_FROM_STATE || '',
      zip: process.env.DEFAULT_SHIP_FROM_ZIP || '',
      country: process.env.DEFAULT_SHIP_FROM_COUNTRY || 'US',
    };
  }

  configured() { return !!this.shippoKey; }

  async _shippo(method, path, data) {
    return axios({
      method, url: `${this.shippoBase}${path}`, data,
      headers: { Authorization: `ShippoToken ${this.shippoKey}`, 'Content-Type': 'application/json' },
    }).then(r => r.data);
  }

  // Multi-carrier rates (UPS/FedEx/USPS/DHL) via Shippo, with flat-rate fallback.
  async getRates({ toAddress, parcel, weightGrams = 500, zones = [] }) {
    if (this.configured()) {
      try {
        const shipment = await this._shippo('POST', '/shipments/', {
          address_from: {
            name: this.from.name, street1: this.from.street1, city: this.from.city,
            state: this.from.state, zip: this.from.zip, country: this.from.country,
          },
          address_to: {
            name: toAddress.name || `${toAddress.firstName || ''} ${toAddress.lastName || ''}`.trim() || 'Customer',
            street1: toAddress.street1, city: toAddress.city, state: toAddress.state,
            zip: toAddress.postalCode || toAddress.zip, country: toAddress.country || 'US',
          },
          parcels: [parcel || {
            length: '10', width: '8', height: '4', distance_unit: 'in',
            weight: String(Math.max(0.1, weightGrams / 453.592)), mass_unit: 'lb',
          }],
          async: false,
        });
        return (shipment.rates || []).map(r => ({
          carrier: r.provider, service: r.servicelevel?.name, amount: Number(r.amount),
          currency: r.currency, etaDays: r.estimated_days, objectId: r.object_id,
        }));
      } catch (e) {
        console.warn('[shipping] Shippo rates failed, falling back to zone rates:', e.message);
      }
    }
    return this._zoneRates({ toAddress, weightGrams, zones });
  }

  _zoneRates({ toAddress, weightGrams, zones }) {
    const country = (toAddress.country || 'US').toUpperCase();
    const state = (toAddress.state || '').toUpperCase();
    const matching = zones.find(z =>
      (!z.countries?.length || z.countries.map(c => c.toUpperCase()).includes(country)) &&
      (!z.states?.length || z.states.map(s => s.toUpperCase()).includes(state))
    );
    if (!matching) {
      return [{ carrier: 'Flat Rate', service: 'Standard', amount: 9.99, currency: 'USD', etaDays: 5 }];
    }
    return (matching.rates || []).filter(r => {
      const min = r.minWeight ?? 0;
      const max = r.maxWeight ?? Infinity;
      return weightGrams >= min && weightGrams <= max;
    }).map(r => ({
      carrier: 'Flat Rate', service: r.name,
      amount: (r.priceCents || 0) / 100, currency: 'USD', etaDays: r.etaDays,
    }));
  }

  async buyLabel({ rateId }) {
    if (!this.configured()) throw new Error('Shippo not configured');
    return this._shippo('POST', '/transactions/', { rate: rateId, label_file_type: 'PDF', async: false });
  }

  async createReturnLabel({ originalTransactionId }) {
    if (!this.configured()) throw new Error('Shippo not configured');
    return this._shippo('POST', '/transactions/', { return_of: originalTransactionId, label_file_type: 'PDF', async: false });
  }

  async track({ carrier, trackingNumber }) {
    if (!this.configured()) {
      return { carrier, trackingNumber, status: 'unknown', message: 'Shippo not configured' };
    }
    return this._shippo('GET', `/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`);
  }

  async validateAddress(address) {
    if (!this.configured()) {
      const ok = !!(address.street1 && address.city && address.postalCode);
      return { isValid: ok, messages: ok ? [] : ['Missing required fields'], normalized: address };
    }
    const res = await this._shippo('POST', '/addresses/', {
      name: address.name || 'Customer',
      street1: address.street1, city: address.city, state: address.state,
      zip: address.postalCode, country: address.country || 'US',
      validate: true,
    });
    return { isValid: res.validation_results?.is_valid ?? true, messages: res.validation_results?.messages || [], normalized: res };
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
const TEMPLATES = {
  order_confirmation: {
    subject: 'Your order {{orderNumber}} is confirmed',
    body: `
<div style="font-family:Helvetica,Arial,sans-serif;background:#0a0a0a;color:#eee;padding:32px">
  <h1 style="font-family:Georgia,serif;color:#c8a96e">Thanks for your order, {{customerName}}</h1>
  <p>Order <strong>{{orderNumber}}</strong> · {{itemCount}} item(s) · <strong>{{totalFormatted}}</strong></p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px">
    {{#each items}}
    <tr style="border-top:1px solid #222"><td style="padding:8px 0">{{title}} × {{quantity}}</td><td style="text-align:right">{{lineTotal}}</td></tr>
    {{/each}}
  </table>
  <p style="margin-top:24px">We'll email tracking as soon as it ships.</p>
</div>`,
  },
  shipment_notification: {
    subject: 'Your order {{orderNumber}} is on the way',
    body: `<div style="font-family:Helvetica,Arial,sans-serif;color:#222">
  <h1>It's out for delivery</h1>
  <p>Tracking <strong>{{trackingNumber}}</strong> with {{carrier}}.</p>
  {{#if trackingUrl}}<p><a href="{{trackingUrl}}">Track package</a></p>{{/if}}
</div>`,
  },
  password_reset: {
    subject: 'Reset your password',
    body: `<div style="font-family:Helvetica,Arial,sans-serif">
  <h1>Password reset requested</h1>
  <p>Click the link below to choose a new password. This link expires in 1 hour.</p>
  <p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
</div>`,
  },
  low_stock_alert: {
    subject: '[Low stock] {{sku}} is at {{quantity}}',
    body: `<div style="font-family:Helvetica,Arial,sans-serif">
  <h1>Low stock alert</h1>
  <p><strong>{{productTitle}}</strong> — SKU {{sku}} — only {{quantity}} units left (threshold {{threshold}}).</p>
</div>`,
  },
  return_approved: {
    subject: 'Your return {{rmaNumber}} is approved',
    body: `<div style="font-family:Helvetica,Arial,sans-serif">
  <h1>Return approved</h1>
  <p>We approved your return {{rmaNumber}}. {{#if labelUrl}}<a href="{{labelUrl}}">Download return shipping label</a>{{/if}}</p>
</div>`,
  },
  review_request: {
    subject: 'How did your order go?',
    body: `<div style="font-family:Helvetica,Arial,sans-serif">
  <h1>Tell us about it</h1>
  <p>Hi {{customerName}}, mind leaving a quick review for the products in order {{orderNumber}}?</p>
</div>`,
  },
};

class EmailService {
  constructor() {
    this.from = process.env.EMAIL_FROM || 'no-reply@example.com';
    this.transporter = null;
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
  }

  configured() { return !!this.transporter; }

  render(templateKey, data) {
    const tpl = TEMPLATES[templateKey];
    if (!tpl) throw new Error(`Unknown email template: ${templateKey}`);
    return {
      subject: handlebars.compile(tpl.subject)(data),
      html: handlebars.compile(tpl.body)(data),
    };
  }

  async send({ to, template, data = {}, subject, html, text }) {
    const rendered = template ? this.render(template, data) : { subject, html };
    if (!this.configured()) {
      console.log(`[email:dry-run] to=${to} subject="${rendered.subject}"`);
      return { dryRun: true, to, subject: rendered.subject };
    }
    return this.transporter.sendMail({
      from: this.from, to,
      subject: rendered.subject, html: rendered.html, text,
    });
  }
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
class InventoryService {
  constructor({ models, emailService }) {
    this.models = models;
    this.email = emailService;
    this.lowStockEmail = process.env.LOW_STOCK_ALERT_EMAIL;
  }

  async _log(variant, type, delta, extra = {}) {
    return this.models.InventoryLog.create({
      variantId: variant.id,
      type,
      quantityDelta: delta,
      resultingStock: variant.stockQuantity,
      ...extra,
    });
  }

  async _maybeAlert(variant) {
    if (variant.stockQuantity > variant.lowStockThreshold) return;
    if (!this.lowStockEmail) return;
    const product = await this.models.Product.findByPk(variant.productId);
    await this.email.send({
      to: this.lowStockEmail,
      template: 'low_stock_alert',
      data: {
        sku: variant.sku, quantity: variant.stockQuantity,
        threshold: variant.lowStockThreshold, productTitle: product?.title || '',
      },
    }).catch(e => console.warn('[inventory] low-stock email failed:', e.message));
  }

  async adjust({ variantId, delta, reason, userId, referenceType, referenceId }) {
    const variant = await this.models.ProductVariant.findByPk(variantId);
    if (!variant) throw new Error('Variant not found');
    variant.stockQuantity += delta;
    await variant.save();
    await this._log(variant, 'adjust', delta, { reason, userId, referenceType, referenceId });
    await this._maybeAlert(variant);
    return variant;
  }

  async reserve({ variantId, quantity, referenceId }) {
    const variant = await this.models.ProductVariant.findByPk(variantId);
    if (!variant) throw new Error('Variant not found');
    if (variant.stockQuantity - variant.reservedQuantity < quantity) {
      throw new Error('Insufficient stock to reserve');
    }
    variant.reservedQuantity += quantity;
    await variant.save();
    await this._log(variant, 'reserve', -quantity, { referenceType: 'order', referenceId });
    return variant;
  }

  async release({ variantId, quantity, referenceId }) {
    const variant = await this.models.ProductVariant.findByPk(variantId);
    if (!variant) throw new Error('Variant not found');
    variant.reservedQuantity = Math.max(0, variant.reservedQuantity - quantity);
    await variant.save();
    await this._log(variant, 'release', quantity, { referenceType: 'order', referenceId });
    return variant;
  }

  async commit({ variantId, quantity, referenceId }) {
    const variant = await this.models.ProductVariant.findByPk(variantId);
    if (!variant) throw new Error('Variant not found');
    variant.reservedQuantity = Math.max(0, variant.reservedQuantity - quantity);
    variant.stockQuantity = Math.max(0, variant.stockQuantity - quantity);
    await variant.save();
    await this._log(variant, 'commit', -quantity, { referenceType: 'order', referenceId });
    await this._maybeAlert(variant);
    return variant;
  }

  async restock({ variantId, quantity, reason = 'restock', referenceType, referenceId, userId }) {
    const variant = await this.models.ProductVariant.findByPk(variantId);
    if (!variant) throw new Error('Variant not found');
    variant.stockQuantity += quantity;
    await variant.save();
    await this._log(variant, 'restock', quantity, { reason, referenceType, referenceId, userId });
    return variant;
  }

  async bulkUpdate({ updates, userId }) {
    const results = [];
    for (const u of updates) {
      const variant = await this.models.ProductVariant.findByPk(u.variantId);
      if (!variant) { results.push({ variantId: u.variantId, ok: false, error: 'not found' }); continue; }
      if (typeof u.setStock === 'number') {
        const delta = u.setStock - variant.stockQuantity;
        variant.stockQuantity = u.setStock;
        await variant.save();
        await this._log(variant, 'adjust', delta, { reason: 'bulk-update', userId });
      } else if (typeof u.delta === 'number') {
        variant.stockQuantity += u.delta;
        await variant.save();
        await this._log(variant, 'adjust', u.delta, { reason: 'bulk-update', userId });
      }
      await this._maybeAlert(variant);
      results.push({ variantId: u.variantId, ok: true, stockQuantity: variant.stockQuantity });
    }
    return results;
  }

  async getReport() {
    const variants = await this.models.ProductVariant.findAll({ include: [{ association: 'product' }] });
    return variants.map(v => ({
      variantId: v.id, sku: v.sku, productTitle: v.product?.title,
      stockQuantity: v.stockQuantity, reservedQuantity: v.reservedQuantity,
      lowStockThreshold: v.lowStockThreshold,
      status: v.stockQuantity <= 0 ? 'out_of_stock'
        : v.stockQuantity <= v.lowStockThreshold ? 'low' : 'ok',
      valueCents: (v.costCents || 0) * v.stockQuantity,
    }));
  }

  async getTotalValue() {
    const variants = await this.models.ProductVariant.findAll();
    let units = 0; let valueCents = 0;
    for (const v of variants) {
      units += v.stockQuantity;
      valueCents += (v.costCents || 0) * v.stockQuantity;
    }
    return { units, valueCents };
  }

  async getHistory({ variantId, limit = 100 } = {}) {
    return this.models.InventoryLog.findAll({
      where: variantId ? { variantId } : {},
      order: [['createdAt', 'DESC']],
      limit,
    });
  }

  async checkLowStockAndAlert() {
    const { Op } = require('sequelize');
    const variants = await this.models.ProductVariant.findAll({
      where: { stockQuantity: { [Op.lte]: this.models.Sequelize ? this.models.Sequelize.literal('"lowStockThreshold"') : 5 } },
    }).catch(async () => this.models.ProductVariant.findAll());
    const alerts = [];
    for (const v of variants) {
      if (v.stockQuantity <= v.lowStockThreshold) {
        alerts.push({ sku: v.sku, stock: v.stockQuantity, threshold: v.lowStockThreshold });
        await this._maybeAlert(v);
      }
    }
    return alerts;
  }
}

const emailService = new EmailService();
const shippingService = new ShippingService();

function makeInventoryService(models) {
  return new InventoryService({ models, emailService });
}

module.exports = {
  shippingService, ShippingService,
  emailService, EmailService,
  InventoryService, makeInventoryService,
  paymentService,
};
