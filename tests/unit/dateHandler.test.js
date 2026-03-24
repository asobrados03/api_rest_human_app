import {
  stripDiacritics,
  parseDayAliases,
  matchesDayAlias,
  getDayAliasForDate
} from '../../utils/date-handler.js';

describe('Unit - date handler utils', () => {
  it('normaliza diacríticos correctamente', () => {
    expect(stripDiacritics('miércoles')).toBe('miercoles');
  });

  it('parsea alias válidos y evita inválidos', () => {
    const result = parseDayAliases('lunes, miércoles, foo, 5');
    expect(result.has('mon')).toBe(true);
    expect(result.has('wed')).toBe(true);
    expect(result.has('fri')).toBe(true);
    expect(result.has('sun')).toBe(false);
  });

  it('retorna set vacío para comodines como all/todos', () => {
    expect(parseDayAliases('all').size).toBe(0);
    expect(parseDayAliases('todos').size).toBe(0);
  });

  it('evalúa coincidencias de alias', () => {
    const aliasSet = new Set(['tue']);
    expect(matchesDayAlias(aliasSet, 'tue')).toBe(true);
    expect(matchesDayAlias(aliasSet, 'wed')).toBe(false);
    expect(matchesDayAlias(new Set(), 'wed')).toBe(true);
  });

  it('obtiene alias de día para fecha y fallback en fecha inválida', () => {
    expect(getDayAliasForDate('2026-03-24T00:00:00.000Z')).toBe('tue');
    expect(getDayAliasForDate('invalid-date')).toBe('mon');
  });
});
