const { getCache, setCache, getAllCached } = require('../src/services/apis');

describe('API cache layer', () => {
  it('returns null for unknown source', () => {
    const result = getCache('__nonexistent__');
    expect(result).toBeNull();
  });

  it('stores and retrieves data', () => {
    const payload = { temperature: 22, source: 'test' };
    setCache('test_source', payload);
    const cached = getCache('test_source');
    expect(cached).not.toBeNull();
    expect(cached.data).toEqual(payload);
    expect(cached.updated_at).toBeDefined();
  });

  it('overwrites existing cache entry', () => {
    setCache('overwrite_test', { value: 1 });
    setCache('overwrite_test', { value: 2 });
    const cached = getCache('overwrite_test');
    expect(cached.data.value).toBe(2);
  });

  it('getAllCached returns object with all expected keys', () => {
    const all = getAllCached();
    expect(all).toHaveProperty('weather');
    expect(all).toHaveProperty('air_quality');
    expect(all).toHaveProperty('redata');
    expect(all).toHaveProperty('effis');
    expect(all).toHaveProperty('aemet');
    expect(all).toHaveProperty('nasa_power');
  });
});
