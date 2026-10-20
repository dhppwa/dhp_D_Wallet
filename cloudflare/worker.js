const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' }
  });
}

const tableColumns = {
  Cafe_Amazon_Promosion_House: ['ID', 'Detail', 'Remark', 'Name', 'Phone_No', 'Day_Limit', 'All_Limit', 'All_Use', 'LastUse_Date', 'IsUse', 'InsertDate', 'InsertUser', 'UpdateDate', 'UpdateUser', 'PassWord', 'Confirm_Coupon', 'Coupon_No', 'Product_ID', 'Access_Level', 'Username', 'LoginType', 'Email', 'LimitAll', 'LimitType', 'Discount'],
  Cafe_Amazon_Bill: ['ID', 'Bill_No', 'Cafe_Amazon_PK', 'Product_Type', 'ItemDetail', 'Price', 'Discount', 'Change', 'InsertDate', 'IsUse', 'Coupon_No']
};

const booleanColumns = new Set(['IsUse', 'Confirm_Coupon', 'LimitAll']);
const quote = name => `"${name}"`;
const allowedTable = table => Object.hasOwn(tableColumns, table);
const allowedColumn = (table, column) => tableColumns[table]?.includes(column);
const dbValue = (column, value) => booleanColumns.has(column) && typeof value === 'boolean' ? Number(value) : value;

function parseColumns(table, value) {
  if (!value || value === '*') return ['*'];
  const columns = String(value).split(',').map(item => item.trim()).filter(Boolean);
  if (!columns.length || columns.some(column => !allowedColumn(table, column))) throw new Error('Invalid column');
  return columns;
}

function buildWhere(table, filters = [], orFilters = []) {
  const params = [];
  const clauses = [];
  const add = filter => {
    if (!allowedColumn(table, filter.column)) throw new Error('Invalid filter column');
    const operators = { eq: '=', neq: '!=', gte: '>=', gt: '>', lte: '<=', lt: '<', like: 'LIKE' };
    if (filter.op === 'is' && filter.value === null) return `${quote(filter.column)} IS NULL`;
    if (filter.op === 'is' && typeof filter.value === 'boolean') {
      params.push(Number(filter.value));
      return `${quote(filter.column)} = ?`;
    }
    if (!operators[filter.op]) throw new Error('Invalid filter operator');
    params.push(dbValue(filter.column, filter.value));
    return `${quote(filter.column)} ${operators[filter.op]} ?`;
  };
  for (const filter of filters) clauses.push(add(filter));
  if (orFilters.length) clauses.push(`(${orFilters.map(add).join(' OR ')})`);
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

async function runDbQuery(env, payload) {
  const { table, action = 'select' } = payload;
  if (!allowedTable(table)) throw new Error('Invalid table');
  const selected = parseColumns(table, payload.select);
  const projection = selected[0] === '*' ? '*' : selected.map(quote).join(', ');
  const where = buildWhere(table, payload.filters, payload.orFilters);
  let sql;
  let params = [];
  if (action === 'select') {
    sql = `SELECT ${projection} FROM ${quote(table)}${where.sql}`;
    params = where.params;
    if (payload.order?.column) {
      if (!allowedColumn(table, payload.order.column)) throw new Error('Invalid order column');
      sql += ` ORDER BY ${quote(payload.order.column)} ${payload.order.ascending === false ? 'DESC' : 'ASC'}`;
    }
    if (payload.limit) sql += ` LIMIT ${Math.max(1, Math.min(10000, Number(payload.limit)))}`;
    const result = await env.DB.prepare(sql).bind(...params).all();
    return result.results || [];
  }
  if (action === 'insert') {
    const rows = Array.isArray(payload.values) ? payload.values : [payload.values];
    if (!rows.length) return [];
    const columns = Object.keys(rows[0]);
    if (columns.some(column => !allowedColumn(table, column))) throw new Error('Invalid insert column');
    const statement = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) RETURNING ${projection}`;
    const results = await env.DB.batch(rows.map(row => env.DB.prepare(statement).bind(...columns.map(column => dbValue(column, row[column] ?? null)))));
    return results.flatMap(result => result.results || []);
  }
  if (action === 'update') {
    const entries = Object.entries(payload.values || {});
    if (!entries.length || entries.some(([column]) => !allowedColumn(table, column))) throw new Error('Invalid update');
    sql = `UPDATE ${quote(table)} SET ${entries.map(([column]) => `${quote(column)} = ?`).join(', ')}${where.sql} RETURNING ${projection}`;
    params = [...entries.map(([column, value]) => dbValue(column, value)), ...where.params];
  } else if (action === 'delete') {
    if (!where.sql) throw new Error('Delete requires a filter');
    sql = `DELETE FROM ${quote(table)}${where.sql} RETURNING ${projection}`;
    params = where.params;
  } else throw new Error('Invalid action');
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results || [];
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const result = await env.DB.prepare('SELECT 1 AS ok').first();
      return json({ ok: result?.ok === 1, service: 'pwa-amazon-api' });
    }
    if (url.pathname === '/db' && request.method === 'POST') {
      try {
        return json({ data: await runDbQuery(env, await request.json()) });
      } catch (error) {
        return json({ error: error.message || 'Database request failed' }, 400);
      }
    }
    return json({ error: 'Not found' }, 404);
  }
};
