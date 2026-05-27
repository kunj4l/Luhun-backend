'use strict';

/**
 * Maps CRM Product + ProductVariant rows to the Luhun storefront JSON shape.
 */

function toStorefrontProduct(product) {
  const attrs = product.attributes || {};
  const variants = product.variants || [];
  const available = variants.reduce(
    (sum, v) => sum + Math.max(0, (v.stockQuantity || 0) - (v.reservedQuantity || 0)),
    0
  );
  const soldOut = available <= 0 || attrs.soldOut === true;
  const image =
    (Array.isArray(product.images) && product.images[0]) ||
    variants.find((v) => v.image)?.image ||
    '';

  const base = {
    id: attrs.storefrontId || product.slug,
    backendProductId: product.id,
    name: product.title,
    price: (product.basePriceCents || 0) / 100,
    compareAt: product.compareAtPriceCents ? product.compareAtPriceCents / 100 : null,
    soldOut,
    badge: soldOut ? 'sold-out' : (attrs.badge || null),
    image,
    handle: product.slug,
  };

  if (attrs.category === 'clothing') {
    const sizeVariants = variants.filter((v) => v.size);
    return {
      ...base,
      category: 'clothing',
      clothingType: attrs.clothingType,
      sizes: sizeVariants.length ? sizeVariants.map((v) => v.size) : (attrs.sizes || []),
      variants: variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        size: v.size || 'One Size',
        price: (v.priceCents || product.basePriceCents || 0) / 100,
        soldOut: (v.stockQuantity || 0) <= (v.reservedQuantity || 0),
      })),
    };
  }

  const variant = variants[0];
  return {
    ...base,
    category: 'shoes',
    sizeGroup: attrs.sizeGroup,
    size: attrs.size != null ? attrs.size : (variant?.size ? parseFloat(variant.size) : null),
    variantId: variant?.id,
    sku: variant?.sku,
    price: ((variant?.priceCents ?? product.basePriceCents) || 0) / 100,
  };
}

function resolveVariantId(product, sizeOrVariantLabel) {
  if (product.category === 'shoes') {
    return product.variantId || product.variants?.[0]?.id;
  }
  const match = (product.variants || []).find(
    (v) => v.size === sizeOrVariantLabel || v.size === String(sizeOrVariantLabel)
  );
  return match?.id || product.variants?.[0]?.id;
}

function filterStorefrontProducts(products, query = {}) {
  let list = products;
  if (query.category) list = list.filter((p) => p.category === query.category);
  if (query.sizeGroup) list = list.filter((p) => p.sizeGroup === query.sizeGroup);
  if (query.clothingType) list = list.filter((p) => p.clothingType === query.clothingType);
  if (query.q) {
    const q = query.q.toLowerCase();
    list = list.filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }
  if (query.featured === 'true') {
    const FEATURED = [
      'nike-pro-hyperwarm-hood',
      'luhun-x-site-collab-tee',
      'luhun-angel',
      'hustle-hard-t-shirt',
    ];
    const byId = new Map(list.map((p) => [p.id, p]));
    const picked = FEATURED.map((id) => byId.get(id)).filter(Boolean);
    if (picked.length >= 4) return picked;
    const extra = list.filter((p) => !p.soldOut && !FEATURED.includes(p.id));
    return [...picked, ...extra].slice(0, 8);
  }
  return list;
}

module.exports = { toStorefrontProduct, resolveVariantId, filterStorefrontProducts };
