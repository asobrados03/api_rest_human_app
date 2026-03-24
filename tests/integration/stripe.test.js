import request from 'supertest';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createVerifyTokenModule,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

const mockGetConnection = jest.fn();
const stripeService = {
  createOrGetCustomer: jest.fn(),
  getCustomer: jest.fn(),
  listPaymentMethods: jest.fn(),
  detachPaymentMethod: jest.fn(),
  setDefaultPaymentMethod: jest.fn(),
  createPaymentIntent: jest.fn(),
  confirmPaymentIntent: jest.fn(),
  cancelPaymentIntent: jest.fn(),
  getPaymentIntent: jest.fn(),
  createRefund: jest.fn(),
  createSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  getSubscription: jest.fn(),
  createEphemeralKey: jest.fn(),
  createSetupConfig: jest.fn(),
  verifyWebhookSignature: jest.fn(),
  handleWebhook: jest.fn()
};
const stripeRepository = { getTransactionsByCustomerId: jest.fn() };

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule({ id: 1, role: 'user' }));
jest.unstable_mockModule('../../services/stripe.service.js', () => stripeService);
jest.unstable_mockModule('../../repositories/stripe.repository.js', () => stripeRepository);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Stripe API completa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDbConnectionMock(mockGetConnection);
  });

  it('POST /api/stripe/webhook -> 200', async () => {
    stripeService.verifyWebhookSignature.mockReturnValue({ type: 'payment_intent.succeeded' });
    stripeService.handleWebhook.mockResolvedValue(undefined);
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

  it.each([
    ['put', '/api/stripe/payment-method/default', { customerId: 'cus_1' }],
    ['post', '/api/stripe/payment-intents', { currency: 'eur' }]
  ])('%s %s -> 400 validación', async (method, path, body) => {
    const res = await withAuth(request(app)[method](path)).send(body);
    expect(res.status).toBe(400);
  });

  it.each([
    ['post', '/api/stripe/customer', () => stripeService.createOrGetCustomer.mockResolvedValue({ isNew: true, customerId: 'cus_1' }), { userId: 1 }],
    ['get', '/api/stripe/customer/cus_1', () => stripeService.getCustomer.mockResolvedValue({ id: 'cus_1' })],
    ['get', '/api/stripe/payment-methods/cus_1', () => stripeService.listPaymentMethods.mockResolvedValue([])],
    ['delete', '/api/stripe/payment-method/pm_1', () => stripeService.detachPaymentMethod.mockResolvedValue({ id: 'pm_1' })],
    ['put', '/api/stripe/payment-method/default', () => stripeService.setDefaultPaymentMethod.mockResolvedValue(undefined), { customerId: 'cus_1', paymentMethodId: 'pm_1' }],
    ['post', '/api/stripe/payment-intents', () => stripeService.createPaymentIntent.mockResolvedValue({ id: 'pi_1' }), { amount: 1000, customerId: 'cus_1' }],
    ['patch', '/api/stripe/payment-intents/pi_1', () => stripeService.cancelPaymentIntent.mockResolvedValue({ id: 'pi_1' }), { status: 'canceled' }],
    ['patch', '/api/stripe/payment-intents/pi_1/state', () => stripeService.confirmPaymentIntent.mockResolvedValue({ id: 'pi_1' }), { status: 'confirmed', paymentMethodId: 'pm_1' }],
    ['get', '/api/stripe/payment-intents/pi_1', () => stripeService.getPaymentIntent.mockResolvedValue({ id: 'pi_1' })],
    ['post', '/api/stripe/refund', () => stripeService.createRefund.mockResolvedValue({ id: 're_1' }), { paymentIntentId: 'pi_1' }],
    ['post', '/api/stripe/subscription', () => stripeService.createSubscription.mockResolvedValue({ id: 'sub_1' }), { userId: 1, productId: 2, priceId: 'price_1' }],
    ['delete', '/api/stripe/subscription/sub_1?user_id=1&product_id=2', () => stripeService.cancelSubscription.mockResolvedValue({ id: 'sub_1' })],
    ['get', '/api/stripe/subscription/sub_1', () => stripeService.getSubscription.mockResolvedValue({ id: 'sub_1' })],
    ['get', '/api/stripe/transactions?userId=1', () => stripeRepository.getTransactionsByCustomerId.mockResolvedValue([{ id: 'tx_1' }])],
    ['post', '/api/stripe/ephemeral-keys', () => stripeService.createEphemeralKey.mockResolvedValue({ secret: 'ek' }), { customer_id: 'cus_1' }],
    ['post', '/api/stripe/payments/setup-config', () => stripeService.createSetupConfig.mockResolvedValue({ setupIntentId: 'seti_1' })]
  ])('%s %s -> éxito', async (...args) => {
    const [method, path, setupMock, body] = args;
    setupMock();
    const req = withAuth(request(app)[method](path));
    const res = body ? await req.send(body) : await req;
    expect(res.status).toBe(200);
  });

  it('POST /api/stripe/payment-intents -> 500', async () => {
    stripeService.createPaymentIntent.mockRejectedValue(new Error('Stripe timeout'));
    const res = await withAuth(request(app).post('/api/stripe/payment-intents')).send({ amount: 1000, customerId: 'cus_1' });
    expect(res.status).toBe(500);
  });
});
