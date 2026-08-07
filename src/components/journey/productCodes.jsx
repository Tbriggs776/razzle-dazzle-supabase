// Maps RFMS 2-digit product codes to category names (per the SWITCH formula)
const PRODUCT_CODE_MAP = {
  '01': 'CARPET',
  '02': 'VINYL',
  '03': 'PAD',
  '04': 'WOOD',
  '05': 'TILE',
  '06': 'LAMINATE',
  '07': 'VINYL TILE - LVT, LVP',
  '08': 'CARPET TILE',
  '09': 'VCT',
  '10': 'NATURAL STONE',
  '11': 'RUBBER TILE',
  '12': 'SD/ESD TILE',
  '13': 'SUNDRIES',
  '14': 'ADHESIVES',
  '15': 'METAL',
  '16': 'WALL BASE',
  '17': 'TRIMS/TRANSITIONS',
  '18': 'UNDERLAYMENT',
  '19': 'INSTALL MATERIALS',
  '20': 'AREA RUGS',
  '21': 'REMNANTS',
};

export function getProductCategoryName(productCode) {
  if (!productCode) return null;
  const key = String(productCode).padStart(2, '0');
  return PRODUCT_CODE_MAP[key] || null;
}

// Returns distinct category names from a list of line items
export function getDistinctCategories(lineItems) {
  if (!lineItems?.length) return [];
  const seen = new Set();
  const categories = [];
  for (const item of lineItems) {
    const name = getProductCategoryName(item.productCode);
    if (name && !seen.has(name)) {
      seen.add(name);
      categories.push(name);
    }
  }
  return categories;
}