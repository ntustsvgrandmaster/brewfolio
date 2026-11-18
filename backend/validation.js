const INT_MAX = 2147483647;
const RATINGS = ['sour', 'sweet', 'bitter', 'richness', 'aroma'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = value => Number.isSafeInteger(value) && value > 0 && value <= INT_MAX;
const isFlag = value => typeof value === 'boolean' || value === 0 || value === 1;
const isNotes = value => value == null || (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 65535);

function validPathId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && isId(Number(value));
}

function validateBrew(body) {
  if (!isObject(body) || !isObject(body.brew)) return { error: '缺少沖煮資料' };
  const brew = { ...body.brew };
  const pours = body.pours === undefined ? [] : body.pours;
  if (brew.source_brew_id != null && !isId(brew.source_brew_id)) return { error: '來源紀錄 ID 不正確' };
  if (brew.bean_id != null && !isId(brew.bean_id)) return { error: '豆款 ID 不正確' };
  if (brew.dripper_id != null && !isId(brew.dripper_id)) return { error: '濾杯 ID 不正確' };
  if (!['H', 'I'].includes(brew.H_I)) return { error: '冰熱類型必須是 H 或 I' };

  for (const [field, integer, min, max] of [
    ['bean_weight', false, Number.MIN_VALUE, 3.4028234663852886e38],
    ['grind', false, 0, 3.4028234663852886e38],
    ['water_vol', true, 1, INT_MAX],
    ['water_temp', true, 1, 100],
    ['ice_vol', true, 0, INT_MAX],
    ...RATINGS.map(field => [field, true, 1, 5]),
  ]) {
    const value = brew[field];
    if (value != null && (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max)) {
      return { error: `${field} 數值不正確` };
    }
    brew[field] = value ?? null;
  }
  if (!isNotes(brew.notes)) return { error: '備註必須是文字，且不可超過 65535 UTF-8 bytes' };
  brew.notes = brew.notes ?? null;
  brew.bean_id = brew.bean_id ?? null;
  brew.dripper_id = brew.dripper_id ?? null;
  brew.source_brew_id = brew.source_brew_id ?? null;

  if (!Array.isArray(pours) || pours.length > 128) return { error: '注水資料必須是陣列，最多 128 段' };
  const orders = new Set();
  const normalizedPours = [];
  for (const pour of pours) {
    if (!isObject(pour) || !Number.isInteger(pour.pour_order) || pour.pour_order < 0 || pour.pour_order > 127 || orders.has(pour.pour_order)) {
      return { error: '注水順序必須是 0～127 的不重複整數' };
    }
    orders.add(pour.pour_order);
    const normalized = { pour_order: pour.pour_order };
    for (const field of ['volume_ml', 'duration_s', 'wait_s']) {
      const value = pour[field];
      if (value != null && (!Number.isInteger(value) || value < 0 || value > INT_MAX)) return { error: `${field} 必須是非負整數` };
      normalized[field] = value ?? null;
    }
    normalizedPours.push(normalized);
  }
  const warnings = [];
  if (brew.water_vol != null && normalizedPours.length && normalizedPours.every(p => p.volume_ml !== null)) {
    const total = normalizedPours.reduce((sum, p) => sum + p.volume_ml, 0);
    if (total !== brew.water_vol) warnings.push('分段注水量合計與總注水量不同，請確認是否只記錄部分注水。');
  }
  return { brew, pours: normalizedPours, warnings };
}

function validateBean(body) {
  if (!isObject(body)) return { error: '缺少豆款資料' };
  const bean = {};
  for (const [field, max] of [['beans_name', 100], ['process', 50], ['roast_level', 50]]) {
    const value = body[field];
    if (value != null && typeof value !== 'string') return { error: `${field} 必須是文字` };
    const normalized = value?.trim() || null;
    if (field === 'beans_name' && !normalized) return { error: '豆款名稱不得為空' };
    if (normalized && Array.from(normalized).length > max) return { error: `${field} 最多 ${max} 字` };
    bean[field] = normalized;
  }
  return { bean };
}

function validateDripper(body) {
  if (!isObject(body) || typeof body.name !== 'string' || !body.name.trim()) {
    return { error: '請輸入濾杯名稱' };
  }
  if (body.material != null && typeof body.material !== 'string') return { error: '材質必須是文字' };
  const name = body.name.trim();
  const material = body.material?.trim() || null;
  if (Array.from(name).length > 100) return { error: '濾杯名稱最多 100 字' };
  if (material && Array.from(material).length > 50) return { error: '材質最多 50 字' };
  return { name, material };
}

module.exports = { isObject, isId, isFlag, isNotes, validPathId, validateBrew, validateBean, validateDripper };
