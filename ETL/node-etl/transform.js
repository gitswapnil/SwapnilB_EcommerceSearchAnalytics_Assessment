// transform.js
export function transformData(records) {
  return records.map(r => {
    // helper to split a comma-separated field into trimmed non-empty values
    const splitList = (s) => {
      if (!s) return [];
      // sometimes fields may use ',' or ';' or '|' — handle common separators
      return String(s).split(/[,;|]/)
        .map(x => x.trim())
        .filter(x => x.length > 0);
    };

    const ipList = splitList(r["IP Address"].replace(/\s+/, " ")) || [];

    return {
      customer: {
        name: r["Customer Name"] ? r["Customer Name"].trim() : null,
        email: r["Customer Email"] ? r["Customer Email"].trim() : null,
      },

      search: {
        search_id: r["Search ID"],
        search_keyword: r["Search Keyword"] ? r["Search Keyword"].trim() : null,
        attributes: r["Attributes"] ? r["Attributes"].trim() : null,
        min_price: r["Min Price"] ? Number(r["Min Price"]) : null,
        max_price: r["Max Price"] ? Number(r["Max Price"]) : null,
        min_rating: r["Min Rating"] ? Number(r["Min Rating"]) : null,
        total_results: r["Total Results"] ? Number(r["Total Results"]) : null,
        search_date: r["Search Date"] ? new Date(r["Search Date"]).toISOString() : null,
      },

      ip_addresses: ipList,

      brands: splitList(r["Brands"]),
      categories: splitList(r["Categories"]),
      collections: splitList(r["Collections"]),
    };
  });
}

/**
 * Groups transformed rows into bulk-insert arrays for each table.
 * Returns an object:
 * {
 *   customers: [[name,email], ...],
 *   searches: [[search_id, customer_id_placeholder, keyword, attributes, min_price,...], ...],
 *   brands: [[brand_name], ...],
 *   categories: [[category_name], ...],
 *   collections: [[collection_name], ...],
 *   search_brands: [[search_id, brand_name], ...],
 *   search_categories: [[search_id, category_name], ...],
 *   search_collections: [[search_id, collection_name], ...],
 *   ip_addresses: [[search_id, ip], ...],
 *   metrics: [[search_id, min_price, max_price, min_rating, total_results], ...],
 * }
 *
 * Note: We do upserts for lookup tables (brands/categories/collections/customers),
 * then map names -> ids, then insert mapping tables using ids.
 */
export function groupForBulkInsert(transformedRows) {
  const customers = []; // unique by email (if present) else include
  const customerKeySet = new Set();

  const brandsSet = new Set();
  const categoriesSet = new Set();
  const collectionsSet = new Set();

  const searches = [];
  const searchBrPairs = []; // [search_id, brand_name]
  const searchCatPairs = [];
  const searchColPairs = [];
  const ipRows = [];
  const metricsRows = [];

  for (const row of transformedRows) {
    const emailKey = row.customer.email ? row.customer.email.toLowerCase() : null;
    const customerKey = emailKey || `${row.customer.name || ''}::${Math.random()}`; // fallback unique key for null emails

    if (emailKey) {
      if (!customerKeySet.has(emailKey)) {
        customers.push([row.customer.name, row.customer.email]);
        customerKeySet.add(emailKey);
      }
    } else {
      // multiple anonymous customers with null email — still insert them (no dedupe)
      customers.push([row.customer.name, row.customer.email]);
    }

    // collect lookup values
    row.brands.forEach(b => brandsSet.add(b));
    row.categories.forEach(c => categoriesSet.add(c));
    row.collections.forEach(c => collectionsSet.add(c));

    // searches
    searches.push([
      row.search.search_id,
      null, // placeholder for customer_id (resolved later)
      row.search.search_keyword,
      row.search.attributes,
      row.search.min_price,
      row.search.max_price,
      row.search.min_rating,
      row.search.total_results,
      row.search.search_date
    ]);

    // mapping pairs (by name for now)
    row.brands.forEach(b => searchBrPairs.push([row.search.search_id, b]));
    row.categories.forEach(c => searchCatPairs.push([row.search.search_id, c]));
    row.collections.forEach(c => searchColPairs.push([row.search.search_id, c]));

    // ip rows
    row.ip_addresses.forEach(ip => ipRows.push([row.search.search_id, ip]));

    // metrics
    metricsRows.push([
      row.search.search_id,
      row.search.min_price,
      row.search.max_price,
      row.search.min_rating,
      row.search.total_results
    ]);
  }

  return {
    customers,
    searches,
    brands: Array.from(brandsSet).map(x => [x]),
    categories: Array.from(categoriesSet).map(x => [x]),
    collections: Array.from(collectionsSet).map(x => [x]),
    search_brands: searchBrPairs,
    search_categories: searchCatPairs,
    search_collections: searchColPairs,
    ip_addresses: ipRows,
    metrics: metricsRows
  };
}
