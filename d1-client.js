(function () {
  const BOOLEAN_FIELDS = new Set(['IsUse', 'Confirm_Coupon']);
  const normalize = row => {
    if (!row || typeof row !== 'object') return row;
    for (const field of BOOLEAN_FIELDS) if (field in row) row[field] = Boolean(row[field]);
    return row;
  };
  async function request(payload, options = {}) {
    const response = await fetch(`${window.API_BASE_URL}/db`, { method: 'POST', keepalive: Boolean(options.keepalive), headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return (result.data || []).map(normalize);
  }
  class Query {
    constructor(table) { this.payload = { table, action: 'select', select: '*', filters: [], orFilters: [] }; this.one = false; }
    select(columns = '*') { this.payload.select = columns; return this; }
    insert(values) { this.payload.action = 'insert'; this.payload.values = values; return this; }
    update(values) { this.payload.action = 'update'; this.payload.values = values; return this; }
    delete() { this.payload.action = 'delete'; return this; }
    eq(column, value) { this.payload.filters.push({ column, op: 'eq', value }); return this; }
    neq(column, value) { this.payload.filters.push({ column, op: 'neq', value }); return this; }
    gte(column, value) { this.payload.filters.push({ column, op: 'gte', value }); return this; }
    gt(column, value) { this.payload.filters.push({ column, op: 'gt', value }); return this; }
    lte(column, value) { this.payload.filters.push({ column, op: 'lte', value }); return this; }
    lt(column, value) { this.payload.filters.push({ column, op: 'lt', value }); return this; }
    like(column, value) { this.payload.filters.push({ column, op: 'like', value }); return this; }
    or(expression) { this.payload.orFilters = String(expression).split(',').map(part => { const [column, op, ...rest] = part.split('.'); let value = rest.join('.'); if (op === 'is') value = value === 'null' ? null : value === 'true'; return { column, op, value }; }); return this; }
    order(column, options = {}) { this.payload.order = { column, ascending: options.ascending !== false }; return this; }
    limit(value) { this.payload.limit = value; return this; }
    maybeSingle() { this.one = true; return this.execute(); }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
    async execute() { try { const rows = await request(this.payload); return { data: this.one ? (rows[0] || null) : rows, error: null }; } catch (error) { return { data: null, error: { message: error.message } }; } }
  }
  window.createD1Client = () => ({ from: table => new Query(table) });
  window.d1Request = request;
})();
