import request from 'supertest';
import { jest } from '@jest/globals';

const mockCreatePaymentIntent = jest.fn();

jest.unstable_mockModule('../../middlewares/verifyToken.js', () => ({
  verifyToken: (req, _res, next) => {
    req.user_payload = { id: 77, email: 'integration@test.dev' };
    next();
  }
}));

jest.unstable_mockModule('../../services/stripe.service.js', () => ({
  createPaymentIntent: mockCreatePaymentIntent,
  createOrGetCustomer: jest.fn(),
  getCustomer: jest.fn(),
  listPaymentMethods: jest.fn(),
  detachPaymentMethod: jest.fn(),
  setDefaultPaymentMethod: jest.fn(),
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
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined)
}));

const { default: app } = await import('../../app.js');

describe('Integración - Stripe API (/api/stripe/payment-intents)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('debe crear un payment intent y devolver status 200', async () => {
    mockCreatePaymentIntent.mockResolvedValue({
      id: 'pi_123',
      status: 'requires_confirmation',
      amount: 5000
    });

    const response = await request(app)
      .post('/api/stripe/payment-intents')
      .set('Authorization', 'Bearer fake-token')
      .send({ amount: 5000, customerId: 'cus_123', currency: 'eur' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      success: true,
      data: {
        id: 'pi_123',
        status: 'requires_confirmation',
        amount: 5000
      }
    });
  });

  it('debe devolver 400 cuando faltan parámetros requeridos', async () => {
    const response = await request(app)
      .post('/api/stripe/payment-intents')
      .set('Authorization', 'Bearer fake-token')
      .send({ currency: 'eur' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'amount y customerId son requeridos'
    });
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });

  it('debe devolver 500 cuando Stripe service falla', async () => {
    mockCreatePaymentIntent.mockRejectedValue(new Error('Stripe down'));

    const response = await request(app)
      .post('/api/stripe/payment-intents')
      .set('Authorization', 'Bearer fake-token')
      .send({ amount: 5000, customerId: 'cus_123', currency: 'eur' });

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      message: 'Error al crear Payment Intent',
      error: 'Stripe down'
    });
  });
});
