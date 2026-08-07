// Per unit cost EXCLUDES contract labor (cont_labor). It is computed from the
// remaining catalog components, falling back to the stored per_unit_cost when
// the individual components aren't populated.

// Build a lookup map of style/item name -> per-unit cost (cont_labor excluded).
export function buildCatalogCostMap(items = [], rolls = []) {
  const map = {};
  items.forEach(it => {
    if (!it.item_name) return;
    const computed = (it.item_cost || 0) + (it.freight || 0) + (it.load || 0);
    map[String(it.item_name).toLowerCase()] = computed > 0 ? computed : (it.per_unit_cost || 0);
  });
  rolls.forEach(r => {
    if (!r.style_name) return;
    const computed = (r.cut_cost || 0) + (r.pad_cost || 0);
    map[String(r.style_name).toLowerCase()] = computed > 0 ? computed : (r.per_unit_cost || 0);
  });
  return map;
}

// Compute catalog-based gross profit for a set of RFMS order lines.
// Falls back to the RFMS unitCost when a style isn't in the catalog map.
export function computeCatalogGP(lines = [], catalogCostMap = {}) {
  const catalogTotalCost = lines.reduce((sum, item) => {
    const puc = catalogCostMap[String(item.styleName).toLowerCase()];
    const cost = puc != null ? Number(puc) : item.unitCost;
    return sum + (cost * item.quantity);
  }, 0);
  const orderTotal = lines.reduce((sum, item) => sum + (item.total || 0), 0);
  const grossProfit = orderTotal - catalogTotalCost;
  const grossProfitPercent = orderTotal > 0 ? (grossProfit / orderTotal * 100) : 0;
  return { catalogTotalCost, orderTotal, grossProfit, grossProfitPercent };
}