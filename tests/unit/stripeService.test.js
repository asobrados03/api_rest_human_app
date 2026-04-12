/**
 * Módulo testeado: services/stripe.service.js
 * Dependencias mockeadas: config/stripe.config.js, repositories/stripe.repository.js, utils/stripe.utils.js,
 * services/service-products.service.js, repositories/service-products.repository.js y utils/pino.js por integración externa (Stripe/DB/log).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStripe = {
  customers: {
    create: jest.fn(),
    retrieve: jest.fn(),
    update: jest.fn()
  },
  paymentMethods: {
    list: jest.fn(),
    detach: jest.fn()
  },
  paymentIntents: {
    create: jest.fn(),
    confirm: jest.fn(),
    retrieve: jest.fn(),
    cancel: jest.fn()
  },
  refunds: { create: jest.fn() },
  subscriptions: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn() },
  ephemeralKeys: { create: jest.fn() },
  setupIntents: { create: jest.fn() }
};

const mockStripeRepo = {
  getUserById: jest.fn(),
  updateUserStripeCustomerId: jest.fn()
};

const mockUtils = {
  createStripeMetadata: jest.fn(),
  DEFAULT_CURRENCY: 'eur',
  toCents: jest.fn()
};

jest.unstable_mockModule('../../config/stripe.config.js', () => ({ default: mockStripe }));
jest.unstable_mockModule('../../repositories/stripe.repository.js', () => mockStripeRepo);
jest.unstable_mockModule('../../utils/stripe.utils.js', () => mockUtils);
jest.unstable_mockModule('../../utils/pino.js', () => ({ default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.unstable_mockModule('../../services/service-products.service.js', () => ({}));
jest.unstable_mockModule('../../repositories/service-products.repository.js', () => ({}));

const {
  createOrGetCustomer,
  listPaymentMethods,
  createPaymentIntent,
  createRefund
} = await import('../../services/stripe.service.js');

describe('Unit - stripe service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUtils.toCents.mockImplementation((a) => Math.round(a * 100));
    mockUtils.createStripeMetadata.mockImplementation((m) => m);
  });

  describe('createOrGetCustomer', () => {
    it('lanza error cuando el usuario no existe', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockStripeRepo.getUserById.mockResolvedValue(null);

      await expect(createOrGetCustomer(dbPool, 1)).rejects.toThrow('Usuario no encontrado');
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('retorna customer existente sin llamar a Stripe create', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockStripeRepo.getUserById.mockResolvedValue({ stripe_customer_id: 'cus_existing' });

      const result = await createOrGetCustomer(dbPool, 1);

      expect(result).toEqual({ customerId: 'cus_existing', isNew: false });
      expect(mockStripe.customers.create).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('crea customer en Stripe y persiste stripe_customer_id en DB', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockStripeRepo.getUserById.mockResolvedValue({ user_id: 7, email: 'a@a.com', user_name: 'Ana', phone: '123', stripe_customer_id: null });
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });

      const result = await createOrGetCustomer(dbPool, 7);

      expect(mockStripe.customers.create).toHaveBeenCalledWith(expect.objectContaining({
        email: 'a@a.com',
        metadata: { user_id: '7' }
      }));
      expect(mockStripeRepo.updateUserStripeCustomerId).toHaveBeenCalledWith(connection, 7, 'cus_new');
      expect(result).toEqual({ customerId: 'cus_new', isNew: true });
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('propaga error si falla persistencia local del customer y libera conexión', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockStripeRepo.getUserById.mockResolvedValue({ user_id: 7, email: 'a@a.com', user_name: 'Ana', phone: '123', stripe_customer_id: null });
      mockStripe.customers.create.mockResolvedValue({ id: 'cus_new' });
      mockStripeRepo.updateUserStripeCustomerId.mockRejectedValue(new Error('db write failed'));

      await expect(createOrGetCustomer(dbPool, 7)).rejects.toThrow('db write failed');
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('listPaymentMethods', () => {
    it('retorna métodos y defaultPaymentMethodId desde invoice_settings', async () => {
      mockStripe.customers.retrieve.mockResolvedValue({ invoice_settings: { default_payment_method: 'pm_1' } });
      mockStripe.paymentMethods.list.mockResolvedValue({ data: [{ id: 'pm_1' }, { id: 'pm_2' }] });

      const result = await listPaymentMethods('cus_1');

      expect(result).toEqual({
        methods: [{ id: 'pm_1' }, { id: 'pm_2' }],
        defaultPaymentMethodId: 'pm_1'
      });
    });
  });

  describe('createPaymentIntent', () => {
    it('crea payment intent sin confirm cuando no hay paymentMethodId', async () => {
      mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_1' });

      const result = await createPaymentIntent({
        amount: 12.5,
        customerId: 'cus_1',
        metadata: { user_id: '7' }
      });

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({
        amount: 1250,
        currency: 'eur',
        customer: 'cus_1',
        metadata: { user_id: '7' }
      }));
      expect(result).toEqual({ id: 'pi_1' });
    });

    it('crea payment intent confirmado cuando llega paymentMethodId', async () => {
      mockStripe.paymentIntents.create.mockResolvedValue({ id: 'pi_2' });

      await createPaymentIntent({
        amount: 8,
        currency: 'usd',
        customerId: 'cus_1',
        metadata: {},
        paymentMethodId: 'pm_99'
      });

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(expect.objectContaining({
        payment_method: 'pm_99',
        confirm: true,
        currency: 'usd'
      }));
    });
  });

  describe('createRefund', () => {
    it('crea refund total cuando no se especifica amount', async () => {
      mockStripe.refunds.create.mockResolvedValue({ id: 're_1' });

      const result = await createRefund('pi_1');

      expect(mockStripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1' });
      expect(result).toEqual({ id: 're_1' });
    });

    it('crea refund parcial cuando se especifica amount', async () => {
      mockStripe.refunds.create.mockResolvedValue({ id: 're_2' });

      await createRefund('pi_1', 1.75);

      expect(mockStripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 175 });
    });
  });
});
