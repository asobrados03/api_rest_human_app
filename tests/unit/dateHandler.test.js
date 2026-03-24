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
      expect(stripDiacritics(null)).toBe('null');
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
  });
});
