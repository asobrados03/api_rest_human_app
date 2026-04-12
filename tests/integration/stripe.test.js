import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createMockConnection,
  createVerifyTokenModule,
  resetMockObject,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

const mockGetConnection = jest.fn();
const stripeRepository = {
  getUserById: jest.fn(),
  updateUserStripeCustomerId: jest.fn(),
  getUserByStripeCustomerId: jest.fn(),
  getTransactionsByCustomerId: jest.fn(),
  cancelSubscription: jest.fn(),
  findSubscriptionById: jest.fn(),
  findIncompleteSubscriptionByPayerRef: jest.fn(),
  updateSubscriptionStatus: jest.fn(),
  createSubscription: jest.fn(),
  saveStripeTransaction: jest.fn(),
  updateSubscriptionsPaymentMethodByUserId: jest.fn()
};
const serviceProductsRepository = {
  getCouponDiscount: jest.fn(),
  cancelActiveProduct: jest.fn(),
  getProductById: jest.fn(),
  findActiveProduct: jest.fn(),
  getCouponByCode: jest.fn(),
  countInvoicesByPrefix: jest.fn(),
  createActiveProduct: jest.fn(),
  createSubscription: jest.fn(),
  getLatestWalletBalance: jest.fn(),
  createWalletTransaction: jest.fn(),
  updateActiveProductExpiry: jest.fn()
};
const stripeSdk = {
  customers: { create: jest.fn(), retrieve: jest.fn(), update: jest.fn() },
  paymentMethods: { list: jest.fn(), detach: jest.fn() },
  paymentIntents: { create: jest.fn(), confirm: jest.fn(), retrieve: jest.fn(), cancel: jest.fn() },
  refunds: { create: jest.fn() },
  subscriptions: { create: jest.fn(), update: jest.fn(), cancel: jest.fn(), retrieve: jest.fn() },
  ephemeralKeys: { create: jest.fn() },
  setupIntents: { create: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
  coupons: { retrieve: jest.fn(), create: jest.fn() }
};

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123';

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule({ id: 1, role: 'user' }));
jest.unstable_mockModule('../../repositories/stripe.repository.js', () => stripeRepository);
jest.unstable_mockModule('../../repositories/service-products.repository.js', () => serviceProductsRepository);
jest.unstable_mockModule('../../config/stripe.config.js', () => ({ default: stripeSdk }));
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Stripe API completa', () => {
  // Cubre validaciones HTTP + lógica del servicio Stripe ejecutando funciones reales con repositorios SQL mockeados.
  let connection;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockObject(stripeRepository);
    resetMockObject(serviceProductsRepository);
    connection = createMockConnection();
    setupDbConnectionMock(mockGetConnection, connection);

    stripeRepository.getUserById.mockResolvedValue({ user_id: 1, email: 'qa@human.app', user_name: 'QA', phone: '600', stripe_customer_id: 'cus_existing' });
    stripeSdk.customers.retrieve.mockResolvedValue({ id: 'cus_existing', invoice_settings: { default_payment_method: 'pm_1' } });
    stripeSdk.paymentMethods.list.mockResolvedValue({ data: [{ id: 'pm_1' }] });
    stripeSdk.paymentIntents.create.mockResolvedValue({ id: 'pi_1' });
    stripeSdk.paymentIntents.confirm.mockResolvedValue({ id: 'pi_1', status: 'succeeded' });
    stripeSdk.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      latest_charge: { id: 'ch_1', refunded: false, amount_refunded: 0 }
    });
    stripeSdk.paymentIntents.cancel.mockResolvedValue({ id: 'pi_1', status: 'canceled' });
    stripeSdk.refunds.create.mockResolvedValue({ id: 're_1' });
    stripeSdk.subscriptions.create.mockResolvedValue({
      id: 'sub_1',
      status: 'incomplete',
      customer: 'cus_existing',
      metadata: { user_id: '1', product_id: '2' },
      items: { data: [{ price: { unit_amount: 1000, recurring: { interval: 'month' } } }] },
      currency: 'eur',
      start_date: 1700000000,
      current_period_end: 1702600000,
      latest_invoice: { payment_intent: { client_secret: 'secret_1' } }
    });
    stripeSdk.subscriptions.update.mockResolvedValue({ id: 'sub_1' });
    stripeSdk.subscriptions.cancel.mockResolvedValue({ id: 'sub_1', status: 'canceled', latest_invoice: null });
    stripeSdk.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active' });
    stripeSdk.ephemeralKeys.create.mockResolvedValue({ secret: 'ek_1' });
    stripeSdk.setupIntents.create.mockResolvedValue({ id: 'seti_1', client_secret: 'seti_secret' });
    stripeSdk.webhooks.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', metadata: {} } } });

    stripeRepository.findSubscriptionById.mockResolvedValue(null);
    stripeRepository.createSubscription.mockResolvedValue(1);
    stripeRepository.getTransactionsByCustomerId.mockResolvedValue([{ id: 1 }]);
  });

  it('POST /api/stripe/webhook -> 200', async () => {
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_1' })));

    expect(res.status).toBe(200);
  });

  it.each([
    ['post', '/api/stripe/customer'],
    ['get', '/api/stripe/customer/cus_1'],
    ['get', '/api/stripe/payment-methods/cus_1'],
    ['delete', '/api/stripe/payment-method/pm_1'],
    ['put', '/api/stripe/payment-method/default'],
    ['post', '/api/stripe/payment-intents'],
    ['patch', '/api/stripe/payment-intents/pi_1'],
    ['patch', '/api/stripe/payment-intents/pi_1/state'],
    ['get', '/api/stripe/payment-intents/pi_1'],
    ['post', '/api/stripe/refund'],
    ['post', '/api/stripe/subscription'],
    ['delete', '/api/stripe/subscription/sub_1'],
    ['get', '/api/stripe/subscription/sub_1'],
    ['get', '/api/stripe/transactions?userId=1'],
    ['post', '/api/stripe/ephemeral-keys'],
    ['post', '/api/stripe/payments/setup-config']
  ])('%s %s -> 401 sin token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it('GET /api/stripe/publishable-key -> 200', async () => {
    const res = await request(app).get('/api/stripe/publishable-key');
    expect(res.status).toBe(200);
  });

  it('PUT /api/stripe/payment-method/default -> 400 validación', async () => {
    const res = await withAuth(request(app).put('/api/stripe/payment-method/default')).send({ customerId: 'cus_1' });
    expect(res.status).toBe(400);
  });

  it('POST /api/stripe/payment-intents -> 400 validación', async () => {
    const res = await withAuth(request(app).post('/api/stripe/payment-intents')).send({ currency: 'eur' });
    expect(res.status).toBe(400);
  });

  it('POST /api/stripe/refund -> 200 idempotente cuando el pago ya está reembolsado', async () => {
    const stripeError = new Error('Charge already refunded');
    stripeError.code = 'charge_already_refunded';
    stripeSdk.refunds.create.mockRejectedValueOnce(stripeError);
    stripeSdk.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_1',
      latest_charge: { id: 'ch_1', refunded: true, amount_refunded: 1000 }
    });

    const res = await withAuth(request(app).post('/api/stripe/refund')).send({ paymentIntentId: 'pi_1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      code: 'charge_already_refunded',
      data: expect.objectContaining({ alreadyRefunded: true, paymentIntentId: 'pi_1' })
    }));
  });

  it('POST /api/stripe/refund -> 500 si Stripe dice already_refunded pero no se confirma en el payment intent', async () => {
    const stripeError = new Error('Charge already refunded');
    stripeError.code = 'charge_already_refunded';
    stripeSdk.refunds.create.mockRejectedValueOnce(stripeError);
    stripeSdk.paymentIntents.retrieve.mockResolvedValueOnce({
      id: 'pi_1',
      latest_charge: { id: 'ch_1', refunded: false, amount_refunded: 0 }
    });

    const res = await withAuth(request(app).post('/api/stripe/refund')).send({ paymentIntentId: 'pi_1' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      message: 'Error al crear reembolso'
    }));
  });

  it('Endpoints Stripe principales -> 200 y contratos mínimos', async () => {
    const responses = await Promise.all([
      withAuth(request(app).post('/api/stripe/customer')).send({ userId: 1 }),
      withAuth(request(app).get('/api/stripe/customer/cus_1')),
      withAuth(request(app).get('/api/stripe/payment-methods/cus_1')),
      withAuth(request(app).delete('/api/stripe/payment-method/pm_1')),
      withAuth(request(app).put('/api/stripe/payment-method/default')).send({ customerId: 'cus_1', paymentMethodId: 'pm_1' }),
      withAuth(request(app).post('/api/stripe/payment-intents')).send({ amount: 1000, customerId: 'cus_1' }),
      withAuth(request(app).patch('/api/stripe/payment-intents/pi_1')).send({ status: 'canceled' }),
      withAuth(request(app).patch('/api/stripe/payment-intents/pi_1/state')).send({ status: 'confirmed', paymentMethodId: 'pm_1' }),
      withAuth(request(app).get('/api/stripe/payment-intents/pi_1')),
      withAuth(request(app).post('/api/stripe/refund')).send({ paymentIntentId: 'pi_1' }),
      withAuth(request(app).post('/api/stripe/subscription')).send({ userId: 1, productId: 2, priceId: 'price_1' }),
      withAuth(request(app).delete('/api/stripe/subscription/sub_1?user_id=1&product_id=2')),
      withAuth(request(app).get('/api/stripe/subscription/sub_1')),
      withAuth(request(app).get('/api/stripe/transactions?userId=1')),
      withAuth(request(app).post('/api/stripe/ephemeral-keys')).send({ customer_id: 'cus_1' }),
      withAuth(request(app).post('/api/stripe/payments/setup-config'))
    ]);

    responses.forEach((res) => expect(res.status).toBe(200));
    expect(responses[0].body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        customerId: expect.any(String),
        isNew: expect.any(Boolean)
      })
    }));
    expect(responses[2].body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        methods: expect.any(Array),
        defaultPaymentMethodId: expect.any(String)
      })
    }));
    expect(responses[5].body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ id: expect.any(String) })
    }));
    expect(responses[9].body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ id: expect.any(String) })
    }));
    expect(responses[10].body).toEqual(expect.objectContaining({
      subscription_id: expect.any(String),
      client_secret: expect.any(String),
      customer_id: expect.any(String)
    }));
  });
});
