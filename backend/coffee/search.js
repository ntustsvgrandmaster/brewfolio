const { z } = require('zod');
const id = z.number().int().min(1).max(2147483647);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, 'Use a real calendar date in YYYY-MM-DD format');
const searchSchema = z.object({
  bean_id: id.optional().describe('Exact bean master ID; never inferred from snapshot names.'),
  bean_name: z.string().trim().min(1).max(100).optional().describe('Literal partial master bean name; may match several beans.'),
  drink_type: z.enum(['H', 'I']).optional().describe('H hot or I iced; omit for both. Not a brewing-device category.'),
  available_only: z.boolean().default(false).describe('Set true for currently available beans; excludes finished and unlinked records. Default false permits historical review.'),
  starred: z.boolean().optional().describe('true selects explicitly starred records; false means unmarked, not disliked.'),
  min_aroma: z.number().int().min(1).max(5).optional().describe('Explicit sensory-intensity threshold, not overall quality.'),
  notes_query: z.string().trim().min(1).max(200).optional().describe('Literal substring in notes, not semantic or external search.'),
  date_from: day.optional().describe('Inclusive date in existing database local calendar; timezone is not established.'),
  date_to: day.optional().describe('Inclusive date in existing database local calendar; timezone is not established.'),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).max(10000).default(0),
}).strict();
function parseSearch(input) {
  const result = searchSchema.parse(input);
  if (result.date_from && result.date_to && result.date_from > result.date_to) {
    throw new Error('date_from must not be after date_to');
  }
  return result;
}
const literalLike = value => `%${value.replace(/[=%_]/g, char => `=${char}`)}%`;
function sqlFilters(filters) {
  const bean = [], base = [], match = [];
  const beanParams = [], baseParams = [], matchParams = [];
  if (filters.bean_id !== undefined) { bean.push('mb.id = ?'); beanParams.push(filters.bean_id); }
  if (filters.bean_name !== undefined) { bean.push("mb.beans_name LIKE ? ESCAPE '='"); beanParams.push(literalLike(filters.bean_name)); }
  if (filters.available_only) bean.push('mb.is_finished = 0');
  if (filters.drink_type) { base.push('b.H_I = ?'); baseParams.push(filters.drink_type); }
  if (filters.date_from) { base.push('b.brewed_at >= ?'); baseParams.push(`${filters.date_from} 00:00:00`); }
  if (filters.date_to) { base.push('b.brewed_at < DATE_ADD(?, INTERVAL 1 DAY)'); baseParams.push(filters.date_to); }
  if (filters.starred !== undefined) { match.push('b.starred = ?'); matchParams.push(filters.starred ? 1 : 0); }
  if (filters.min_aroma !== undefined) { match.push('b.aroma >= ?'); matchParams.push(filters.min_aroma); }
  if (filters.notes_query !== undefined) { match.push("b.notes LIKE ? ESCAPE '='"); matchParams.push(literalLike(filters.notes_query)); }
  return { bean, base, match, beanParams, baseParams, matchParams };
}
function beanMatches(bean, filters) {
  if (!bean) return filters.bean_id === undefined && filters.bean_name === undefined && !filters.available_only;
  return (filters.bean_id === undefined || bean.id === filters.bean_id)
    && (filters.bean_name === undefined || (bean.beans_name || '').toLowerCase().includes(filters.bean_name.toLowerCase()))
    && (!filters.available_only || bean.is_finished === 0);
}
function baseMatches(brew, filters) {
  const day = brew.brewed_at?.slice(0, 10);
  return (!filters.drink_type || brew.H_I === filters.drink_type)
    && (!filters.date_from || (day && day >= filters.date_from))
    && (!filters.date_to || (day && day <= filters.date_to));
}
function refinementMatches(brew, filters) {
  return (filters.starred === undefined || Boolean(brew.starred) === filters.starred)
    && (filters.min_aroma === undefined || (brew.aroma != null && brew.aroma >= filters.min_aroma))
    && (filters.notes_query === undefined || (brew.notes || '').toLowerCase().includes(filters.notes_query.toLowerCase()));
}
module.exports = { id, searchSchema, parseSearch, sqlFilters, beanMatches, baseMatches, refinementMatches };
