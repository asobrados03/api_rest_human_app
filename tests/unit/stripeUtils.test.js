/**
 * Módulo testeado: utils/stripe.utils.js
 * Dependencias mockeadas: ninguna (funciones puras).
 */
import { describe, expect, it } from '@jest/globals';
import {
  toCents,
  fromCents,
  formatCardDisplay,
  validateAmount,
  createStripeMetadata,
  DEFAULT_CURRENCY
} from '../../utils/stripe.utils.js';

describe('Unit - stripe utils', () => {
  describe('toCents / fromCents', () => {
    it('convierte montos entre unidades y centavos', () => {
      expect(toCents(10.5)).toBe(1050);
      expect(fromCents(1050)).toBe(10.5);
    });

    it('redondea correctamente al convertir a centavos', () => {
      expect(toCents(10.015)).toBe(1002);
    });
  });

  describe('formatCardDisplay', () => {
    it('formatea tarjeta usando el objeto card anidado', () => {
      const card = {
        id: 'pm_123',
        card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
        is_default: true
      };

      expect(formatCardDisplay(card)).toEqual({
        id: 'pm_123',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        isDefault: true
      });
    });

    it('usa fallback de campos legacy cuando card no existe', () => {
      const card = {
        id: 'pm_legacy',
        brand_reference: 'mastercard',
        masked_pan: '************1111',
        exp_date: 1230,
        is_default: false
      };

      expect(formatCardDisplay(card)).toEqual({
        id: 'pm_legacy',
        brand: 'mastercard',
        last4: '1111',
        expMonth: 12,
        expYear: 2030,
        isDefault: false
      });
    });
  });

  describe('validateAmount', () => {
    it('acepta montos numéricos positivos', () => {
      expect(validateAmount('10.50')).toBe(10.5);
    });

    it('lanza error con montos inválidos o no positivos', () => {
      expect(() => validateAmount('abc')).toThrow('El monto debe ser un número positivo');
      expect(() => validateAmount(0)).toThrow('El monto debe ser un número positivo');
      expect(() => validateAmount(-3)).toThrow('El monto debe ser un número positivo');
    });
  });

  describe('createStripeMetadata', () => {
    it('serializa metadata a strings', () => {
      expect(createStripeMetadata({ userId: 7, active: false })).toEqual({
        userId: '7',
        active: 'false'
      });
    });
  });

  describe('DEFAULT_CURRENCY', () => {
    it('expone eur como moneda por defecto', () => {
      expect(DEFAULT_CURRENCY).toBe('eur');
    });
  });
});
