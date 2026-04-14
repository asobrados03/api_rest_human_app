/**
 * Módulo testeado: utils/date-handler.js
 * Dependencias mockeadas: ninguna (funciones puras).
 */
import { describe, expect, it } from '@jest/globals';
import {
  stripDiacritics,
  parseDayAliases,
  matchesDayAlias,
  getDayAliasForDate
} from '../../utils/date-handler.js';

describe('Unit - date handler utils', () => {
  describe('stripDiacritics', () => {
    it('normaliza diacríticos correctamente', () => {
      expect(stripDiacritics('miércoles')).toBe('miercoles');
    });

    it('convierte null/undefined a string sin romper', () => {
      expect(stripDiacritics(undefined)).toBe('');
      expect(stripDiacritics(null)).toBe('');
    });
  });

  describe('parseDayAliases', () => {
    it('parsea alias válidos y descarta inválidos', () => {
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

    it('retorna set vacío para string vacía', () => {
      expect(parseDayAliases('').size).toBe(0);
      expect(parseDayAliases('   ').size).toBe(0);
    });

    it('normaliza acentos, mayúsculas y separadores mixtos', () => {
      const result = parseDayAliases('LÚNES | miércoles / VIErnes');
      expect(result).toEqual(new Set(['mon', 'wed', 'fri']));
    });

    it('interpreta alias numéricos con y sin cero a la izquierda', () => {
      const result = parseDayAliases('00,01,02,03,04,05,06,07');
      expect(result).toEqual(new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']));
    });

    it('si aparece wildcard devuelve set vacío (sin restricción)', () => {
      expect(parseDayAliases('lunes, all, miércoles').size).toBe(0);
      expect(parseDayAliases('any').size).toBe(0);
    });

    it('acepta abreviaturas internacionales y descarta tokens ambiguos/ruido', () => {
      const result = parseDayAliases('Mon, tue, Xday, sáb');
      expect(result).toEqual(new Set(['mon', 'tue', 'sat']));
    });

    it('tolera nombres internacionales y abreviaturas en distintos formatos', () => {
      const result = parseDayAliases('LUNES, Wednesday, sáb, THU');
      expect(result).toEqual(new Set(['mon', 'wed', 'sat', 'thu']));
    });
  });

  describe('matchesDayAlias', () => {
    it('devuelve true cuando el alias existe en el set', () => {
      expect(matchesDayAlias(new Set(['tue']), 'tue')).toBe(true);
    });

    it('devuelve false cuando no coincide', () => {
      expect(matchesDayAlias(new Set(['tue']), 'wed')).toBe(false);
    });

    it('devuelve true con set vacío o null (interpreta como sin restricción)', () => {
      expect(matchesDayAlias(new Set(), 'wed')).toBe(true);
      expect(matchesDayAlias(null, 'wed')).toBe(true);
    });
  });

  describe('getDayAliasForDate', () => {
    it('obtiene alias correcto para fecha válida', () => {
      expect(getDayAliasForDate('2026-03-24T00:00:00.000Z')).toBe('tue');
    });

    it('usa fallback mon para fecha inválida', () => {
      expect(getDayAliasForDate('invalid-date')).toBe('mon');
    });

    it('calcula el alias en UTC (independiente del timezone de entrada)', () => {
      // 2026-03-30T02:30:00.000Z => lunes en UTC aunque el input venga con offset -05:00
      expect(getDayAliasForDate('2026-03-29T21:30:00-05:00')).toBe('mon');
    });

    it('resuelve fin de mes correctamente en UTC', () => {
      expect(getDayAliasForDate('2026-03-31T23:59:59.999Z')).toBe('tue');
      expect(getDayAliasForDate('2026-04-01T00:00:00.000Z')).toBe('wed');
    });

    it('mantiene resultado estable en cambio horario (DST) con offsets distintos', () => {
      expect(getDayAliasForDate('2026-03-08T01:30:00-05:00')).toBe('sun');
      expect(getDayAliasForDate('2026-11-01T01:30:00-04:00')).toBe('sun');
    });
  });
});
