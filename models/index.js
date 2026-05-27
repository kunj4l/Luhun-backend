'use strict';

const path = require('path');
const { Sequelize, DataTypes, Op } = require('sequelize');

const isProd = process.env.NODE_ENV === 'production';

const sequelize = isProd && process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: process.env.DB_LOGGING === 'true' ? console.log : false,
      pool: {
        max: Number(process.env.DB_POOL_MAX || 20),
        min: Number(process.env.DB_POOL_MIN || 0),
      },
      dialectOptions: { ssl: { require: false, rejectUnauthorized: false } },
    })
  : new Sequelize({
      dialect: 'sqlite',
      storage: process.env.SQLITE_PATH || path.join(process.cwd(), 'data.sqlite'),
      logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    });

const baseOpts = { timestamps: true, paranoid: true };

const uuidPk = {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
};

// ---------------------------------------------------------------------------
// User & Address
// ---------------------------------------------------------------------------
const User = sequelize.define('User', {
  ...uuidPk,
  email: { type: DataTypes.STRING, unique: true, allowNull: false, validate: { isEmail: true } },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING },
  phone: { type: DataTypes.STRING },
  role: {
    type: DataTypes.ENUM('owner', 'admin', 'manager', 'staff', 'customer'),
    defaultValue: 'customer',
  },
  status: { type: DataTypes.ENUM('active', 'invited', 'suspended'), defaultValue: 'active' },
  failedLoginCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  lockedUntil: { type: DataTypes.DATE },
  lastLoginAt: { type: DataTypes.DATE },
  resetPasswordToken: { type: DataTypes.STRING },
  resetPasswordExpires: { type: DataTypes.DATE },
  storeCreditCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  marketingOptIn: { type: DataTypes.BOOLEAN, defaultValue: false },
  metadata: { type: DataTypes.JSON, defaultValue: {} },
}, baseOpts);

const Address = sequelize.define('Address', {
  ...uuidPk,
  label: { type: DataTypes.STRING },
  firstName: DataTypes.STRING,
  lastName: DataTypes.STRING,
  company: DataTypes.STRING,
  street1: DataTypes.STRING,
  street2: DataTypes.STRING,
  city: DataTypes.STRING,
  state: DataTypes.STRING,
  postalCode: DataTypes.STRING,
  country: { type: DataTypes.STRING, defaultValue: 'US' },
  phone: DataTypes.STRING,
  isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
  type: { type: DataTypes.ENUM('shipping', 'billing', 'both'), defaultValue: 'both' },
}, baseOpts);

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
const Category = sequelize.define('Category', {
  ...uuidPk,
  name: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, unique: true, allowNull: false },
  description: DataTypes.TEXT,
  image: DataTypes.STRING,
  parentId: { type: DataTypes.UUID },
  position: { type: DataTypes.INTEGER, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, baseOpts);

const Product = sequelize.define('Product', {
  ...uuidPk,
  title: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, unique: true, allowNull: false },
  description: DataTypes.TEXT,
  shortDescription: DataTypes.STRING,
  brand: DataTypes.STRING,
  status: { type: DataTypes.ENUM('draft', 'active', 'archived'), defaultValue: 'draft' },
  basePriceCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  compareAtPriceCents: { type: DataTypes.INTEGER },
  costCents: { type: DataTypes.INTEGER },
  currency: { type: DataTypes.STRING, defaultValue: 'USD' },
  images: { type: DataTypes.JSON, defaultValue: [] },
  tags: { type: DataTypes.JSON, defaultValue: [] },
  attributes: { type: DataTypes.JSON, defaultValue: {} },
  weightGrams: DataTypes.INTEGER,
  taxable: { type: DataTypes.BOOLEAN, defaultValue: true },
  trackInventory: { type: DataTypes.BOOLEAN, defaultValue: true },
  averageRating: { type: DataTypes.FLOAT, defaultValue: 0 },
  ratingCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  salesCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  seoTitle: DataTypes.STRING,
  seoDescription: DataTypes.STRING,
}, baseOpts);

const ProductVariant = sequelize.define('ProductVariant', {
  ...uuidPk,
  sku: { type: DataTypes.STRING, unique: true, allowNull: false },
  title: DataTypes.STRING,
  size: DataTypes.STRING,
  color: DataTypes.STRING,
  optionValues: { type: DataTypes.JSON, defaultValue: {} },
  priceCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  compareAtPriceCents: DataTypes.INTEGER,
  costCents: DataTypes.INTEGER,
  barcode: DataTypes.STRING,
  weightGrams: DataTypes.INTEGER,
  stockQuantity: { type: DataTypes.INTEGER, defaultValue: 0 },
  reservedQuantity: { type: DataTypes.INTEGER, defaultValue: 0 },
  lowStockThreshold: { type: DataTypes.INTEGER, defaultValue: 5 },
  image: DataTypes.STRING,
  position: { type: DataTypes.INTEGER, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, baseOpts);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
const InventoryLog = sequelize.define('InventoryLog', {
  ...uuidPk,
  type: {
    type: DataTypes.ENUM('adjust', 'reserve', 'release', 'commit', 'restock', 'return', 'audit'),
    allowNull: false,
  },
  quantityDelta: { type: DataTypes.INTEGER, allowNull: false },
  resultingStock: DataTypes.INTEGER,
  reason: DataTypes.STRING,
  referenceType: DataTypes.STRING,
  referenceId: DataTypes.STRING,
  notes: DataTypes.TEXT,
}, baseOpts);

const Supplier = sequelize.define('Supplier', {
  ...uuidPk,
  name: { type: DataTypes.STRING, allowNull: false },
  contactName: DataTypes.STRING,
  email: DataTypes.STRING,
  phone: DataTypes.STRING,
  address: DataTypes.STRING,
  paymentTerms: DataTypes.STRING,
  leadTimeDays: { type: DataTypes.INTEGER, defaultValue: 14 },
  notes: DataTypes.TEXT,
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, baseOpts);

const PurchaseOrder = sequelize.define('PurchaseOrder', {
  ...uuidPk,
  poNumber: { type: DataTypes.STRING, unique: true, allowNull: false },
  status: {
    type: DataTypes.ENUM('draft', 'sent', 'partial', 'received', 'cancelled'),
    defaultValue: 'draft',
  },
  items: { type: DataTypes.JSON, defaultValue: [] }, // [{variantId, sku, qty, unitCostCents, received}]
  subtotalCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  shippingCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  taxCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  expectedAt: DataTypes.DATE,
  receivedAt: DataTypes.DATE,
  notes: DataTypes.TEXT,
}, baseOpts);

// ---------------------------------------------------------------------------
// Cart & Orders
// ---------------------------------------------------------------------------
const Cart = sequelize.define('Cart', {
  ...uuidPk,
  sessionId: { type: DataTypes.STRING },
  items: { type: DataTypes.JSON, defaultValue: [] },
  subtotalCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  discountCode: DataTypes.STRING,
  discountCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  currency: { type: DataTypes.STRING, defaultValue: 'USD' },
  expiresAt: DataTypes.DATE,
}, baseOpts);

const Order = sequelize.define('Order', {
  ...uuidPk,
  orderNumber: { type: DataTypes.STRING, unique: true, allowNull: false },
  email: DataTypes.STRING,
  status: {
    type: DataTypes.ENUM('pending', 'paid', 'partially_fulfilled', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded'),
    defaultValue: 'pending',
  },
  paymentStatus: {
    type: DataTypes.ENUM('unpaid', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed', 'voided'),
    defaultValue: 'unpaid',
  },
  fulfillmentStatus: {
    type: DataTypes.ENUM('unfulfilled', 'partial', 'fulfilled', 'returned'),
    defaultValue: 'unfulfilled',
  },
  channel: { type: DataTypes.ENUM('web', 'pos', 'wholesale', 'marketplace'), defaultValue: 'web' },
  currency: { type: DataTypes.STRING, defaultValue: 'USD' },
  subtotalCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  shippingCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  taxCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  discountCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  refundedCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  shippingAddress: DataTypes.JSON,
  billingAddress: DataTypes.JSON,
  shippingMethod: DataTypes.STRING,
  trackingNumber: DataTypes.STRING,
  trackingCarrier: DataTypes.STRING,
  trackingUrl: DataTypes.STRING,
  paymentProcessor: DataTypes.STRING,
  paymentReference: DataTypes.STRING,
  discountCode: DataTypes.STRING,
  giftCardCode: DataTypes.STRING,
  notes: DataTypes.TEXT,
  metadata: { type: DataTypes.JSON, defaultValue: {} },
  paidAt: DataTypes.DATE,
  fulfilledAt: DataTypes.DATE,
  cancelledAt: DataTypes.DATE,
}, baseOpts);

const OrderItem = sequelize.define('OrderItem', {
  ...uuidPk,
  sku: DataTypes.STRING,
  title: DataTypes.STRING,
  variantTitle: DataTypes.STRING,
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  unitPriceCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  totalCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  costCents: DataTypes.INTEGER,
  taxCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  discountCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  fulfillmentStatus: {
    type: DataTypes.ENUM('unfulfilled', 'fulfilled', 'returned'),
    defaultValue: 'unfulfilled',
  },
  metadata: { type: DataTypes.JSON, defaultValue: {} },
}, baseOpts);

// ---------------------------------------------------------------------------
// Refunds, Returns, Discounts, Gift Cards, Store Credit
// ---------------------------------------------------------------------------
const Refund = sequelize.define('Refund', {
  ...uuidPk,
  amountCents: { type: DataTypes.INTEGER, allowNull: false },
  reason: DataTypes.STRING,
  processor: DataTypes.STRING,
  processorRefundId: DataTypes.STRING,
  status: { type: DataTypes.ENUM('pending', 'succeeded', 'failed'), defaultValue: 'pending' },
  notes: DataTypes.TEXT,
}, baseOpts);

const Return = sequelize.define('Return', {
  ...uuidPk,
  rmaNumber: { type: DataTypes.STRING, unique: true, allowNull: false },
  status: {
    type: DataTypes.ENUM('requested', 'approved', 'rejected', 'received', 'refunded', 'cancelled'),
    defaultValue: 'requested',
  },
  reason: DataTypes.STRING,
  items: { type: DataTypes.JSON, defaultValue: [] }, // [{orderItemId, qty, condition}]
  refundAmountCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  returnShippingLabelUrl: DataTypes.STRING,
  trackingNumber: DataTypes.STRING,
  notes: DataTypes.TEXT,
  approvedAt: DataTypes.DATE,
  receivedAt: DataTypes.DATE,
  refundedAt: DataTypes.DATE,
}, baseOpts);

const Discount = sequelize.define('Discount', {
  ...uuidPk,
  code: { type: DataTypes.STRING, unique: true, allowNull: false },
  name: DataTypes.STRING,
  type: {
    type: DataTypes.ENUM('percentage', 'fixed', 'free_shipping', 'bogo'),
    defaultValue: 'percentage',
  },
  value: { type: DataTypes.FLOAT, defaultValue: 0 },
  minSubtotalCents: { type: DataTypes.INTEGER, defaultValue: 0 },
  appliesTo: { type: DataTypes.ENUM('all', 'categories', 'products'), defaultValue: 'all' },
  appliesToIds: { type: DataTypes.JSON, defaultValue: [] },
  usageLimit: DataTypes.INTEGER,
  usageCount: { type: DataTypes.INTEGER, defaultValue: 0 },
  perCustomerLimit: DataTypes.INTEGER,
  startsAt: DataTypes.DATE,
  endsAt: DataTypes.DATE,
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, baseOpts);

const GiftCard = sequelize.define('GiftCard', {
  ...uuidPk,
  code: { type: DataTypes.STRING, unique: true, allowNull: false },
  initialValueCents: { type: DataTypes.INTEGER, allowNull: false },
  remainingValueCents: { type: DataTypes.INTEGER, allowNull: false },
  currency: { type: DataTypes.STRING, defaultValue: 'USD' },
  recipientEmail: DataTypes.STRING,
  recipientName: DataTypes.STRING,
  message: DataTypes.TEXT,
  status: { type: DataTypes.ENUM('active', 'redeemed', 'expired', 'disabled'), defaultValue: 'active' },
  expiresAt: DataTypes.DATE,
}, baseOpts);

const StoreCredit = sequelize.define('StoreCredit', {
  ...uuidPk,
  amountCents: { type: DataTypes.INTEGER, allowNull: false },
  reason: DataTypes.STRING,
  referenceType: DataTypes.STRING,
  referenceId: DataTypes.STRING,
  balanceAfterCents: DataTypes.INTEGER,
}, baseOpts);

// ---------------------------------------------------------------------------
// Reviews & Wishlist
// ---------------------------------------------------------------------------
const Review = sequelize.define('Review', {
  ...uuidPk,
  rating: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
  title: DataTypes.STRING,
  body: DataTypes.TEXT,
  status: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' },
  response: DataTypes.TEXT,
  respondedAt: DataTypes.DATE,
  verifiedPurchase: { type: DataTypes.BOOLEAN, defaultValue: false },
}, baseOpts);

const Wishlist = sequelize.define('Wishlist', {
  ...uuidPk,
  name: { type: DataTypes.STRING, defaultValue: 'Default' },
  items: { type: DataTypes.JSON, defaultValue: [] },
  isPublic: { type: DataTypes.BOOLEAN, defaultValue: false },
}, baseOpts);

// ---------------------------------------------------------------------------
// Shipping & Tax
// ---------------------------------------------------------------------------
const ShippingZone = sequelize.define('ShippingZone', {
  ...uuidPk,
  name: { type: DataTypes.STRING, allowNull: false },
  countries: { type: DataTypes.JSON, defaultValue: [] },
  states: { type: DataTypes.JSON, defaultValue: [] },
  rates: { type: DataTypes.JSON, defaultValue: [] }, // [{name, priceCents, minWeight, maxWeight, etaDays}]
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
}, baseOpts);

const TaxRate = sequelize.define('TaxRate', {
  ...uuidPk,
  name: { type: DataTypes.STRING, allowNull: false },
  country: DataTypes.STRING,
  state: DataTypes.STRING,
  postalCode: DataTypes.STRING,
  rate: { type: DataTypes.FLOAT, defaultValue: 0 },
  isCompound: { type: DataTypes.BOOLEAN, defaultValue: false },
  appliesToShipping: { type: DataTypes.BOOLEAN, defaultValue: false },
}, baseOpts);

// ---------------------------------------------------------------------------
// Notifications, Webhooks, Audit, Analytics
// ---------------------------------------------------------------------------
const Notification = sequelize.define('Notification', {
  ...uuidPk,
  type: { type: DataTypes.STRING, allowNull: false },
  title: DataTypes.STRING,
  body: DataTypes.TEXT,
  channel: { type: DataTypes.ENUM('email', 'sms', 'push', 'inapp'), defaultValue: 'inapp' },
  read: { type: DataTypes.BOOLEAN, defaultValue: false },
  payload: { type: DataTypes.JSON, defaultValue: {} },
}, baseOpts);

const WebhookLog = sequelize.define('WebhookLog', {
  ...uuidPk,
  source: { type: DataTypes.STRING, allowNull: false },
  event: { type: DataTypes.STRING },
  signature: DataTypes.STRING,
  payload: { type: DataTypes.JSON, defaultValue: {} },
  status: { type: DataTypes.ENUM('received', 'processed', 'failed'), defaultValue: 'received' },
  errorMessage: DataTypes.TEXT,
}, baseOpts);

const AuditLog = sequelize.define('AuditLog', {
  ...uuidPk,
  action: { type: DataTypes.STRING, allowNull: false },
  entity: DataTypes.STRING,
  entityId: DataTypes.STRING,
  changes: { type: DataTypes.JSON, defaultValue: {} },
  ip: DataTypes.STRING,
  userAgent: DataTypes.STRING,
}, baseOpts);

const AnalyticsEvent = sequelize.define('AnalyticsEvent', {
  ...uuidPk,
  type: { type: DataTypes.STRING, allowNull: false },
  sessionId: DataTypes.STRING,
  path: DataTypes.STRING,
  referrer: DataTypes.STRING,
  payload: { type: DataTypes.JSON, defaultValue: {} },
  valueCents: DataTypes.INTEGER,
}, baseOpts);

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------
User.hasMany(Address, { foreignKey: 'userId', as: 'addresses' });
Address.belongsTo(User, { foreignKey: 'userId' });

Category.hasMany(Category, { foreignKey: 'parentId', as: 'children' });
Category.belongsTo(Category, { foreignKey: 'parentId', as: 'parent' });
Category.hasMany(Product, { foreignKey: 'categoryId', as: 'products' });
Product.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });

Product.hasMany(ProductVariant, { foreignKey: 'productId', as: 'variants', onDelete: 'CASCADE' });
ProductVariant.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

ProductVariant.hasMany(InventoryLog, { foreignKey: 'variantId', as: 'logs' });
InventoryLog.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });
InventoryLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Supplier.hasMany(PurchaseOrder, { foreignKey: 'supplierId', as: 'purchaseOrders' });
PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'supplier' });
PurchaseOrder.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

User.hasMany(Order, { foreignKey: 'userId', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'userId', as: 'customer' });
Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items', onDelete: 'CASCADE' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });
OrderItem.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });
OrderItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

Order.hasMany(Refund, { foreignKey: 'orderId', as: 'refunds' });
Refund.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });

Order.hasMany(Return, { foreignKey: 'orderId', as: 'returns' });
Return.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });
Return.belongsTo(User, { foreignKey: 'userId', as: 'customer' });

User.hasMany(Review, { foreignKey: 'userId', as: 'reviews' });
Review.belongsTo(User, { foreignKey: 'userId', as: 'author' });
Product.hasMany(Review, { foreignKey: 'productId', as: 'reviews' });
Review.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

User.hasMany(Wishlist, { foreignKey: 'userId', as: 'wishlists' });
Wishlist.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Cart, { foreignKey: 'userId', as: 'carts' });
Cart.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(GiftCard, { foreignKey: 'purchasedById', as: 'giftCardsPurchased' });
GiftCard.belongsTo(User, { foreignKey: 'purchasedById', as: 'purchaser' });

User.hasMany(StoreCredit, { foreignKey: 'userId', as: 'storeCreditLedger' });
StoreCredit.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'actor' });

User.hasMany(AnalyticsEvent, { foreignKey: 'userId', as: 'analyticsEvents' });
AnalyticsEvent.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  Sequelize,
  Op,
  User, Address, Category, Product, ProductVariant, InventoryLog,
  Supplier, PurchaseOrder, Cart, Order, OrderItem, Refund, Return,
  Discount, GiftCard, StoreCredit, Review, Wishlist,
  ShippingZone, TaxRate, Notification, WebhookLog, AuditLog, AnalyticsEvent,
};
