// Fictional fixtures from docs/agent-acceptance-prompts.md. Never written to MySQL.
const beans = [
  { id: 1, beans_name: '花園豆 A', process: '水洗', roast_level: '淺焙', is_finished: 0 },
  { id: 2, beans_name: '莓果豆 B', process: '日曬', roast_level: '淺焙', is_finished: 1 },
  { id: 3, beans_name: '可可豆 C', process: '水洗', roast_level: '中焙', is_finished: 0 },
  { id: 4, beans_name: '新豆 D', process: '蜜處理', roast_level: '淺焙', is_finished: 0 },
];
const base = {
  bean_weight: null, grind: null, water_vol: null, water_temp: null, ice_vol: null,
  sour: null, sweet: null, bitter: null, richness: null, aroma: null,
  source_brew_id: null, beans_name: null, process: null, roast_level: null,
};
const recipe = { bean_weight: 15, grind: 4, water_vol: 150, water_temp: 92, ice_vol: 75, sour: 3, sweet: 4, bitter: 2 };
const rows = [
  { id: 101, bean_id: 1, H_I: 'I', ...recipe, aroma: 4, starred: 1, notes: '冰飲花香清楚，口感乾淨。' },
  { id: 102, bean_id: 1, H_I: 'I', ...recipe, grind: 5, water_temp: 94, aroma: 5, starred: 0, notes: '花香更強，但尾韻乾澀，這次不想重現。', source_brew_id: 101 },
  { id: 103, bean_id: 1, H_I: 'I', ...recipe, grind: 0, sour: null, sweet: null, bitter: null, aroma: null, starred: 0, notes: '今天只記參數，還沒評香氣。' },
  { id: 104, bean_id: 1, H_I: 'H', aroma: 5, starred: 1, notes: '熱飲香氣明顯。' },
  { id: 201, bean_id: 2, H_I: 'I', aroma: 5, starred: 1, notes: '莓果香明顯，冰飲喜歡。' },
  { id: 301, bean_id: 3, H_I: 'I', grind: 20, aroma: 2, starred: 0, notes: '冰飲香氣偏弱，可可感明顯。' },
  { id: 302, bean_id: 3, H_I: 'I', grind: 25, aroma: 3, starred: 0, notes: '香氣普通，口感厚實。' },
  { id: 303, bean_id: 3, H_I: 'H', aroma: 5, starred: 1, notes: '熱飲很喜歡。' },
  { id: 401, bean_id: null, beans_name: '花園豆 A', H_I: 'I', aroma: 5, starred: 1, notes: '舊紀錄，豆款關聯已不存在。' },
];
// Fixed fictional timestamps for a reproducible demo, with no implied timezone.
const brews = rows.map((row, i) => ({ ...base, ...row, brewed_at: `2026-10-${String(i + 1).padStart(2, '0')} 09:00:00` }));
const steps = [
  { pour_order: 0, volume_ml: 30, duration_s: 10, wait_s: 25 },
  { pour_order: 1, volume_ml: 60, duration_s: 20, wait_s: 10 },
  { pour_order: 2, volume_ml: 60, duration_s: 20, wait_s: null },
];
const pours = [101, 102].flatMap(brew_id => steps.map((step, i) => ({ ...step, id: brew_id * 10 + i, brew_id })));
module.exports = { beans, brews, pours };
