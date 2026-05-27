'use strict';

/**
 * Unified payment service.
 *
 * Each processor is a thin wrapper around the upstream SDK / REST API and
 * exposes the same shape:
 *   - id            string
 *   - configured()  boolean
 *   - process(opts) returns { id, status, raw, clientSecret? }
 *   - refund(opts)  returns { id, status, raw }
 *
 * Optional capabilities (Stripe is the most fleshed out):
 *   - createCheckoutSession, listPayouts, listDisputes, createSubscription,
 *     listPaymentMethods, createPaymentLink, verifyWebhook
 */

const crypto = require('crypto');
const axios = require('axios');

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------
class StripeProcessor {
  constructor() {
    this.id = 'stripe';
    this.currency = process.env.STRIPE_CURRENCY || 'usd';
    this.client = null;
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        // eslint-disable-next-line global-require
        const Stripe = require('stripe');
        this.client = Stripe(process.env.STRIPE_SECRET_KEY);
      } catch (e) {
        console.warn('[stripe] SDK not loaded:', e.message);
      }
    }
  }

  configured() { return !!this.client; }

  async process({ amountCents, currency, metadata = {}, customerEmail, paymentMethodId, confirm = false }) {
    if (!this.configured()) throw new Error('Stripe not configured');
    const intent = await this.client.paymentIntents.create({
      amount: amountCents,
      currency: (currency || this.currency).toLowerCase(),
      automatic_payment_methods: { enabled: true },
      receipt_email: customerEmail,
      payment_method: paymentMethodId,
      confirm,
      metadata,
    });
    return { id: intent.id, status: intent.status, clientSecret: intent.client_secret, raw: intent };
  }

  async createCheckoutSession({ lineItems, successUrl, cancelUrl, customerEmail, metadata = {} }) {
    if (!this.configured()) throw new Error('Stripe not configured');
    return this.client.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail,
      metadata,
    });
  }

  async refund({ chargeId, paymentIntentId, amountCents, reason }) {
    if (!this.configured()) throw new Error('Stripe not configured');
    const refund = await this.client.refunds.create({
      charge: chargeId,
      payment_intent: paymentIntentId,
      amount: amountCents,
      reason,
    });
    return { id: refund.id, status: refund.status, raw: refund };
  }

  async listPayouts({ limit = 20 } = {}) {
    if (!this.configured()) return [];
    const res = await this.client.payouts.list({ limit });
    return res.data;
  }

  async listDisputes({ limit = 20 } = {}) {
    if (!this.configured()) return [];
    const res = await this.client.disputes.list({ limit });
    return res.data;
  }

  async createSubscription({ customerId, priceId, metadata = {} }) {
    if (!this.configured()) throw new Error('Stripe not configured');
    return this.client.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      metadata,
    });
  }

  async listPaymentMethods({ customerId, type = 'card' }) {
    if (!this.configured()) return [];
    const res = await this.client.paymentMethods.list({ customer: customerId, type });
    return res.data;
  }

  async createPaymentLink({ lineItems, metadata = {} }) {
    if (!this.configured()) throw new Error('Stripe not configured');
    return this.client.paymentLinks.create({ line_items: lineItems, metadata });
  }

  verifyWebhook(rawBody, signatureHeader) {
    if (!this.configured() || !process.env.STRIPE_WEBHOOK_SECRET) {
      return { type: 'unverified', data: { object: JSON.parse(rawBody.toString()) } };
    }
    return this.client.webhooks.constructEvent(rawBody, signatureHeader, process.env.STRIPE_WEBHOOK_SECRET);
  }
}

// ---------------------------------------------------------------------------
// PayPal (REST API v2)
// ---------------------------------------------------------------------------
class PayPalProcessor {
  constructor() {
    this.id = 'paypal';
    this.baseUrl = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
    this.clientId = process.env.PAYPAL_CLIENT_ID;
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  configured() { return !!(this.clientId && this.clientSecret); }

  async _getToken() {
    if (this._token && Date.now() < this._tokenExpiresAt - 60_000) return this._token;
    const res = await axios.post(`${this.baseUrl}/v1/oauth2/token`, 'grant_type=client_credentials', {
      auth: { username: this.clientId, password: this.clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    this._token = res.data.access_token;
    this._tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
    return this._token;
  }

  async _req(method, path, data) {
    const token = await this._getToken();
    const res = await axios({
      method, url: `${this.baseUrl}${path}`, data,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    return res.data;
  }

  async process({ amountCents, currency = 'USD', returnUrl, cancelUrl }) {
    if (!this.configured()) throw new Error('PayPal not configured');
    const order = await this._req('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: currency, value: (amountCents / 100).toFixed(2) } }],
      application_context: { return_url: returnUrl, cancel_url: cancelUrl },
    });
    return { id: order.id, status: order.status, raw: order };
  }

  async capture(orderId) {
    return this._req('POST', `/v2/checkout/orders/${orderId}/capture`, {});
  }

  async refund({ captureId, amountCents, currency = 'USD' }) {
    const refund = await this._req('POST', `/v2/payments/captures/${captureId}/refund`, {
      amount: { value: (amountCents / 100).toFixed(2), currency_code: currency },
    });
    return { id: refund.id, status: refund.status, raw: refund };
  }

  async createInvoice({ recipientEmail, amountCents, currency = 'USD', description }) {
    return this._req('POST', '/v2/invoicing/invoices', {
      detail: { currency_code: currency, note: description },
      primary_recipients: [{ billing_info: { email_address: recipientEmail } }],
      items: [{ name: description || 'Invoice', quantity: '1', unit_amount: { currency_code: currency, value: (amountCents / 100).toFixed(2) } }],
    });
  }
}

// ---------------------------------------------------------------------------
// Square
// ---------------------------------------------------------------------------
class SquareProcessor {
  constructor() {
    this.id = 'square';
    this.locationId = process.env.SQUARE_LOCATION_ID;
    this.client = null;
    if (process.env.SQUARE_ACCESS_TOKEN) {
      try {
        // eslint-disable-next-line global-require
        const { Client, Environment } = require('square');
        this.client = new Client({
          accessToken: process.env.SQUARE_ACCESS_TOKEN,
          environment: process.env.SQUARE_ENV === 'production' ? Environment.Production : Environment.Sandbox,
        });
      } catch (e) {
        console.warn('[square] SDK not loaded:', e.message);
      }
    }
  }

  configured() { return !!this.client; }

  async process({ amountCents, currency = 'USD', sourceId, idempotencyKey }) {
    if (!this.configured()) throw new Error('Square not configured');
    const res = await this.client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
      locationId: this.locationId,
      amountMoney: { amount: BigInt(amountCents), currency },
    });
    const p = res.result.payment;
    return { id: p.id, status: p.status, raw: p };
  }

  async refund({ paymentId, amountCents, currency = 'USD', reason }) {
    if (!this.configured()) throw new Error('Square not configured');
    const res = await this.client.refundsApi.refundPayment({
      idempotencyKey: crypto.randomUUID(),
      paymentId,
      amountMoney: { amount: BigInt(amountCents), currency },
      reason,
    });
    const r = res.result.refund;
    return { id: r.id, status: r.status, raw: r };
  }
}

// ---------------------------------------------------------------------------
// Braintree
// ---------------------------------------------------------------------------
class BraintreeProcessor {
  constructor() {
    this.id = 'braintree';
    this.gateway = null;
    if (process.env.BRAINTREE_MERCHANT_ID && process.env.BRAINTREE_PUBLIC_KEY && process.env.BRAINTREE_PRIVATE_KEY) {
      try {
        // eslint-disable-next-line global-require
        const braintree = require('braintree');
        this.gateway = new braintree.BraintreeGateway({
          environment: process.env.BRAINTREE_ENV === 'production' ? braintree.Environment.Production : braintree.Environment.Sandbox,
          merchantId: process.env.BRAINTREE_MERCHANT_ID,
          publicKey: process.env.BRAINTREE_PUBLIC_KEY,
          privateKey: process.env.BRAINTREE_PRIVATE_KEY,
        });
      } catch (e) {
        console.warn('[braintree] SDK not loaded:', e.message);
      }
    }
  }

  configured() { return !!this.gateway; }

  async clientToken({ customerId } = {}) {
    if (!this.configured()) throw new Error('Braintree not configured');
    const res = await this.gateway.clientToken.generate(customerId ? { customerId } : {});
    return res.clientToken;
  }

  async process({ amountCents, paymentMethodNonce, deviceData }) {
    if (!this.configured()) throw new Error('Braintree not configured');
    const res = await this.gateway.transaction.sale({
      amount: (amountCents / 100).toFixed(2),
      paymentMethodNonce,
      deviceData,
      options: { submitForSettlement: true },
    });
    if (!res.success) throw new Error(res.message);
    return { id: res.transaction.id, status: res.transaction.status, raw: res.transaction };
  }

  async refund({ transactionId, amountCents }) {
    if (!this.configured()) throw new Error('Braintree not configured');
    const res = await this.gateway.transaction.refund(transactionId, (amountCents / 100).toFixed(2));
    if (!res.success) throw new Error(res.message);
    return { id: res.transaction.id, status: res.transaction.status, raw: res.transaction };
  }
}

// ---------------------------------------------------------------------------
// Klarna
// ---------------------------------------------------------------------------
class KlarnaProcessor {
  constructor() {
    this.id = 'klarna';
    this.baseUrl = process.env.KLARNA_BASE_URL || 'https://api.playground.klarna.com';
    this.username = process.env.KLARNA_USERNAME;
    this.password = process.env.KLARNA_PASSWORD;
  }

  configured() { return !!(this.username && this.password); }

  async _req(method, path, data) {
    return axios({
      method, url: `${this.baseUrl}${path}`, data,
      auth: { username: this.username, password: this.password },
      headers: { 'Content-Type': 'application/json' },
    }).then(r => r.data);
  }

  async process({ amountCents, currency = 'USD', country = 'US', locale = 'en-US', orderLines = [], merchantUrls = {} }) {
    if (!this.configured()) throw new Error('Klarna not configured');
    const session = await this._req('POST', '/payments/v1/sessions', {
      purchase_country: country,
      purchase_currency: currency,
      locale,
      order_amount: amountCents,
      order_lines: orderLines.length ? orderLines : [{
        name: 'Order',
        quantity: 1,
        unit_price: amountCents,
        total_amount: amountCents,
      }],
      merchant_urls: merchantUrls,
    });
    return { id: session.session_id, status: 'created', clientSecret: session.client_token, raw: session };
  }

  async refund({ orderId, amountCents, description }) {
    if (!this.configured()) throw new Error('Klarna not configured');
    return this._req('POST', `/ordermanagement/v1/orders/${orderId}/refunds`, {
      refunded_amount: amountCents, description,
    }).then(raw => ({ id: orderId, status: 'refunded', raw }));
  }
}

// ---------------------------------------------------------------------------
// Afterpay / Clearpay
// ---------------------------------------------------------------------------
class AfterpayProcessor {
  constructor() {
    this.id = 'afterpay';
    this.baseUrl = process.env.AFTERPAY_BASE_URL || 'https://api.us-sandbox.afterpay.com';
    this.merchantId = process.env.AFTERPAY_MERCHANT_ID;
    this.secret = process.env.AFTERPAY_SECRET_KEY;
  }

  configured() { return !!(this.merchantId && this.secret); }

  async _req(method, path, data) {
    return axios({
      method, url: `${this.baseUrl}${path}`, data,
      auth: { username: this.merchantId, password: this.secret },
      headers: { 'Content-Type': 'application/json' },
    }).then(r => r.data);
  }

  async process({ amountCents, currency = 'USD', merchantReference, redirectConfirmUrl, redirectCancelUrl, items = [] }) {
    if (!this.configured()) throw new Error('Afterpay not configured');
    const checkout = await this._req('POST', '/v2/checkouts', {
      amount: { amount: (amountCents / 100).toFixed(2), currency },
      merchantReference,
      items,
      merchant: { redirectConfirmUrl, redirectCancelUrl },
    });
    return { id: checkout.token, status: 'pending', raw: checkout };
  }

  async capture({ token }) {
    return this._req('POST', '/v2/payments/capture', { token });
  }

  async refund({ orderId, amountCents, currency = 'USD' }) {
    return this._req('POST', `/v2/payments/${orderId}/refund`, {
      amount: { amount: (amountCents / 100).toFixed(2), currency },
    }).then(raw => ({ id: raw.refundId || orderId, status: 'refunded', raw }));
  }
}

// ---------------------------------------------------------------------------
// Coinbase Commerce (crypto)
// ---------------------------------------------------------------------------
class CoinbaseProcessor {
  constructor() {
    this.id = 'coinbase';
    this.baseUrl = 'https://api.commerce.coinbase.com';
    this.apiKey = process.env.COINBASE_API_KEY;
  }

  configured() { return !!this.apiKey; }

  async _req(method, path, data) {
    return axios({
      method, url: `${this.baseUrl}${path}`, data,
      headers: { 'X-CC-Api-Key': this.apiKey, 'X-CC-Version': '2018-03-22', 'Content-Type': 'application/json' },
    }).then(r => r.data);
  }

  async process({ amountCents, currency = 'USD', name = 'Order', description, metadata = {} }) {
    if (!this.configured()) throw new Error('Coinbase not configured');
    const res = await this._req('POST', '/charges', {
      name, description, pricing_type: 'fixed_price',
      local_price: { amount: (amountCents / 100).toFixed(2), currency },
      metadata,
    });
    const c = res.data;
    return { id: c.id, status: c.timeline?.[0]?.status || 'NEW', raw: c };
  }

  async refund() {
    throw new Error('Crypto charges are non-refundable via API; issue manually.');
  }

  verifyWebhook(rawBody, signatureHeader) {
    const secret = process.env.COINBASE_WEBHOOK_SECRET;
    if (!secret) return JSON.parse(rawBody.toString());
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (computed !== signatureHeader) throw new Error('Invalid Coinbase webhook signature');
    return JSON.parse(rawBody.toString());
  }
}

// ---------------------------------------------------------------------------
// Unified PaymentService
// ---------------------------------------------------------------------------
class PaymentService {
  constructor() {
    this.processors = {
      stripe: new StripeProcessor(),
      paypal: new PayPalProcessor(),
      square: new SquareProcessor(),
      braintree: new BraintreeProcessor(),
      klarna: new KlarnaProcessor(),
      afterpay: new AfterpayProcessor(),
      coinbase: new CoinbaseProcessor(),
    };
  }

  get(name) {
    const p = this.processors[name];
    if (!p) throw new Error(`Unknown payment processor: ${name}`);
    return p;
  }

  status() {
    return Object.values(this.processors).map(p => ({ id: p.id, configured: p.configured() }));
  }

  async process(processor, opts) {
    return this.get(processor).process(opts);
  }

  async refund(processor, opts) {
    return this.get(processor).refund(opts);
  }
}

const paymentService = new PaymentService();

module.exports = {
  paymentService,
  PaymentService,
  StripeProcessor, PayPalProcessor, SquareProcessor, BraintreeProcessor,
  KlarnaProcessor, AfterpayProcessor, CoinbaseProcessor,
};
