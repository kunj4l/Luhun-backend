#!/usr/bin/env node
/**
 * Import Luhun storefront JSON catalogs into the CRM database.
 * Run: node scripts/sync-luhun-catalog.mjs
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import slugify from 'slugify';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogDir = process.env.LUHUN_CATALOG_DIR
  || path.join(__dirname, '..', 'catalog');

const shoesPath = path.join(catalogDir, 'shoes-catalog.json');
const clothingPath = path.join(catalogDir, 'clothing-catalog.json');

const { sequelize, Category, Product, ProductVariant } = await import('../models/index.js');

const IMAGE_OVERRIDES = {
  'yeezy-380-alien-blue-sz-10-10': 'assets/yeezy-380-alien-blue-sz-10.png',
};

function slugFor(item) {
  return slugify(item.id, { lower: true, strict: true }) || item.id;
}

async function ensureCategories() {
  const defs = [
    { name: 'Clothing', slug: 'clothing' },
    { name: 'Shoes', slug: 'shoes' },
    { name: 'T-Shirts', slug: 't-shirts', parentSlug: 'clothing' },
    { name: 'Hoodies', slug: 'hoodies', parentSlug: 'clothing' },
  ];
  const bySlug = {};
  for (const d of defs.filter((x) => !x.parentSlug)) {
    const [row] = await Category.findOrCreate({ where: { slug: d.slug }, defaults: d });
    bySlug[d.slug] = row;
  }
  for (const d of defs.filter((x) => x.parentSlug)) {
    const parent = bySlug[d.parentSlug];
    const [row] = await Category.findOrCreate({
      where: { slug: d.slug },
      defaults: { ...d, parentId: parent?.id },
    });
    bySlug[d.slug] = row;
  }
  return bySlug;
}

async function upsertCatalogItem(item, categories) {
  const slug = slugFor(item);
  const categoryId =
    item.category === 'shoes'
      ? categories.shoes?.id
      : item.clothingType === 'hoodies'
        ? categories.hoodies?.id
        : categories['t-shirts']?.id;

  const image = IMAGE_OVERRIDES[item.id] || item.image;
  const attributes = {
    storefrontId: item.id,
    category: item.category,
    sizeGroup: item.sizeGroup || null,
    size: item.size ?? null,
    clothingType: item.clothingType || null,
    sizes: item.sizes || null,
    badge: item.badge || null,
    soldOut: !!item.soldOut,
    handle: item.handle || slug,
  };

  let product = await Product.findOne({ where: { slug } });
  const payload = {
    title: item.name,
    slug,
    categoryId,
    status: item.soldOut ? 'active' : 'active',
    basePriceCents: Math.round((item.price || 0) * 100),
    compareAtPriceCents: item.compareAt ? Math.round(item.compareAt * 100) : null,
    images: image ? [image] : [],
    attributes,
    brand: 'Luhun',
  };

  if (product) {
    await product.update(payload);
  } else {
    product = await Product.create(payload);
  }

  if (item.category === 'clothing' && Array.isArray(item.sizes) && item.sizes.length) {
    for (const size of item.sizes) {
      const sku = `${item.id}-${size}`.replace(/\s+/g, '-').toLowerCase();
      const [variant] = await ProductVariant.findOrCreate({
        where: { sku },
        defaults: {
          productId: product.id,
          title: size,
          size,
          priceCents: Math.round((item.price || 0) * 100),
          stockQuantity: item.soldOut ? 0 : 25,
          lowStockThreshold: 3,
          isActive: true,
        },
      });
      await variant.update({
        productId: product.id,
        title: size,
        size,
        priceCents: Math.round((item.price || 0) * 100),
        stockQuantity: item.soldOut ? 0 : Math.max(variant.stockQuantity, 25),
        isActive: true,
      });
    }
  } else {
    const sku = item.id;
    const sizeLabel = item.size != null ? String(item.size) : 'One Size';
    const [variant] = await ProductVariant.findOrCreate({
      where: { sku },
      defaults: {
        productId: product.id,
        title: item.category === 'shoes' ? `Size ${item.size}` : sizeLabel,
        size: sizeLabel,
        priceCents: Math.round((item.price || 0) * 100),
        stockQuantity: item.soldOut ? 0 : 10,
        lowStockThreshold: 2,
        image,
        isActive: true,
      },
    });
    await variant.update({
      productId: product.id,
      title: item.category === 'shoes' ? `Size ${item.size}` : sizeLabel,
      size: sizeLabel,
      priceCents: Math.round((item.price || 0) * 100),
      stockQuantity: item.soldOut ? 0 : Math.max(variant.stockQuantity, 10),
      image,
      isActive: true,
    });
  }

  return product.id;
}

async function main() {
  if (!fs.existsSync(shoesPath) || !fs.existsSync(clothingPath)) {
    console.error('Catalog JSON not found. Set LUhun_CATALOG_DIR or place luhun-official/js next to backend.');
    console.error('  shoes:', shoesPath);
    console.error('  clothing:', clothingPath);
    process.exit(1);
  }

  await sequelize.authenticate();
  await sequelize.sync();

  const shoes = JSON.parse(fs.readFileSync(shoesPath, 'utf8'));
  const clothing = JSON.parse(fs.readFileSync(clothingPath, 'utf8'));
  const categories = await ensureCategories();

  let count = 0;
  for (const item of [...shoes, ...clothing]) {
    await upsertCatalogItem(item, categories);
    count += 1;
    if (count % 50 === 0) console.log(`  synced ${count}...`);
  }

  console.log(`Done — synced ${count} products into CRM.`);
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
