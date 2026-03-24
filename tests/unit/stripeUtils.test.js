import {
  toCents,
  fromCents,
  formatCardDisplay,
  validateAmount,
  createStripeMetadata
} from '../../utils/stripe.utils.js';

describe('Unit - stripe utils', () => {
  it('convierte montos entre unidades y centavos', () => {
    expect(toCents(10.5)).toBe(1050);
    expect(fromCents(1050)).toBe(10.5);
  });

  it('formatea datos de tarjeta para respuesta de API', () => {
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

  it('lanza error con montos inválidos', () => {
    expect(() => validateAmount('abc')).toThrow('El monto debe ser un número positivo');
    expect(() => validateAmount(0)).toThrow('El monto debe ser un número positivo');
  });

  it('serializa metadata a strings', () => {
    expect(createStripeMetadata({ userId: 7, active: false })).toEqual({
      userId: '7',
      active: 'false'
    });
  });
});
