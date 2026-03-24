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
const serviceProductsRepository = {
  getServices: jest.fn(),
  getProductsByServiceId: jest.fn(),
  getActiveProductsByUserId: jest.fn(),
  getProductById: jest.fn(),
  findActiveProduct: jest.fn(),
  updateActiveProductExpiry: jest.fn(),
  getCouponByCode: jest.fn(),
  countInvoicesByPrefix: jest.fn(),
  getLatestWalletBalance: jest.fn(),
  createWalletTransaction: jest.fn(),
  createActiveProduct: jest.fn(),
  createSubscription: jest.fn(),
  cancelActiveProduct: jest.fn(),
  cancelSubscription: jest.fn(),
  getActiveProductDetail: jest.fn(),
  getProductServices: jest.fn(),
  getProductDetailById: jest.fn()
};

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule({ id: 1, role: 'user' }));
jest.unstable_mockModule('../../repositories/service-products.repository.js', () => serviceProductsRepository);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Service Products API completa', () => {
  // Cubre la lógica de negocio de asignación/renovación/cancelación y agregación de productos del servicio.
  let connection;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockObject(serviceProductsRepository);
    connection = createMockConnection();
    setupDbConnectionMock(mockGetConnection, connection);
  });

  it.each([
    ['get', '/api/mobile/services'],
    ['get', '/api/mobile/service-products?primary_service_id=1'],
    ['get', '/api/mobile/users/10/products'],
    ['post', '/api/mobile/users/10/products'],
    ['delete', '/api/mobile/users/10/products/8'],
    ['get', '/api/mobile/active-product-detail?user_id=10&product_id=8'],
    ['get', '/api/mobile/products/8']
  ])('%s %s -> 401 sin token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it('GET /api/mobile/service-products -> 400 query inválida', async () => {
    const res = await withAuth(request(app).get('/api/mobile/service-products?primary_service_id=abc'));
    expect(res.status).toBe(400);
  });

  it('GET /api/mobile/users/:id/products -> agrega service_ids para un mismo producto', async () => {
    serviceProductsRepository.getActiveProductsByUserId.mockResolvedValue([
      { id: 8, name: 'Plan', description: 'Desc', price: 100, image: 'a.png', centro: 'A', type_of_product: 'pack', service_id: 1 },
      { id: 8, name: 'Plan', description: 'Desc', price: 100, image: 'a.png', centro: 'A', type_of_product: 'pack', service_id: 2 }
    ]);

    const res = await withAuth(request(app).get('/api/mobile/users/10/products'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: 8, service_ids: [1, 2] })
    ]);
  });

  it('POST /api/mobile/users/:id/products -> 404 cuando el producto no existe', async () => {
    serviceProductsRepository.getProductById.mockResolvedValue(null);

    const res = await withAuth(request(app).post('/api/mobile/users/10/products')).send({
      product_id: 8,
      payment_method: 'card'
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Producto no encontrado');
  });

  it('POST /api/mobile/users/:id/products -> 409 si el producto ya está activo y no es renovación', async () => {
    serviceProductsRepository.getProductById.mockResolvedValue({ product_id: 8, sell_price: 40, valid_due: 30 });
    serviceProductsRepository.findActiveProduct.mockResolvedValue({ active_product_id: 44, expiry_date: new Date().toISOString() });

    const res = await withAuth(request(app).post('/api/mobile/users/10/products')).send({
      product_id: 8,
      payment_method: 'card'
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('ya está activo');
  });

  it('POST /api/mobile/users/:id/products -> renueva suscripción existente cuando viene subscription_id', async () => {
    serviceProductsRepository.getProductById.mockResolvedValue({ product_id: 8, sell_price: 40, valid_due: 30 });
    serviceProductsRepository.findActiveProduct.mockResolvedValue({
      active_product_id: 77,
      expiry_date: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString()
    });

    const res = await withAuth(request(app).post('/api/mobile/users/10/products')).send({
      product_id: 8,
      payment_method: 'card',
      subscription_id: 'sub_123'
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ action: 'renewed', assigned_id: 77 }));
    expect(serviceProductsRepository.updateActiveProductExpiry).toHaveBeenCalledTimes(1);
  });

  it('POST /api/mobile/users/:id/products -> 402 cuando pago cash no tiene saldo', async () => {
    serviceProductsRepository.getProductById.mockResolvedValue({
      product_id: 8,
      sell_price: 100,
      valid_due: 30,
      centro: 'HQ',
      type_of_product: 'pack'
    });
    serviceProductsRepository.findActiveProduct.mockResolvedValue(null);
    serviceProductsRepository.countInvoicesByPrefix.mockResolvedValue(3);
    serviceProductsRepository.getLatestWalletBalance.mockResolvedValue(10);

    const res = await withAuth(request(app).post('/api/mobile/users/10/products')).send({
      product_id: 8,
      payment_method: 'cash'
    });

    expect(res.status).toBe(402);
    expect(res.body.error).toBe('Saldo insuficiente');
  });

  it('POST /api/mobile/users/:id/products -> calcula descuento y crea producto activo', async () => {
    serviceProductsRepository.getProductById.mockResolvedValue({
      product_id: 8,
      sell_price: 100,
      valid_due: 30,
      centro: 'HQ',
      type_of_product: 'pack'
    });
    serviceProductsRepository.findActiveProduct.mockResolvedValue(null);
    serviceProductsRepository.getCouponByCode.mockResolvedValue({ coupon_id: 5, is_percentage: 1, discount: 20 });
    serviceProductsRepository.countInvoicesByPrefix.mockResolvedValue(9);
    serviceProductsRepository.createActiveProduct.mockResolvedValue({ insertId: 123 });

    const res = await withAuth(request(app).post('/api/mobile/users/10/products')).send({
      product_id: 8,
      payment_method: 'card',
      coupon_code: 'WELCOME20'
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ action: 'created', assigned_id: 123 }));
    expect(serviceProductsRepository.createActiveProduct).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ totalAmount: 80, discount: 20, couponId: 5 })
    );
  });

  it('DELETE /api/mobile/users/:userId/products/:productId -> 200 y calcula valid_until', async () => {
    serviceProductsRepository.cancelActiveProduct.mockResolvedValue({ canceled: true });
    serviceProductsRepository.cancelSubscription.mockResolvedValue(undefined);

    const res = await withAuth(request(app).delete('/api/mobile/users/10/products/8'));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('GET /api/mobile/active-product-detail -> 404 si no existe producto activo', async () => {
    serviceProductsRepository.getActiveProductDetail.mockResolvedValue(null);

    const res = await withAuth(request(app).get('/api/mobile/active-product-detail?user_id=10&product_id=8'));

    expect(res.status).toBe(404);
  });

  it('GET /api/mobile/products/:id -> 400 cuando id inválido', async () => {
    const res = await withAuth(request(app).get('/api/mobile/products/abc'));
    expect(res.status).toBe(400);
  });

  it('GET /api/mobile/products/:id -> 200 cuando existe', async () => {
    serviceProductsRepository.getProductDetailById.mockResolvedValue({ id: 8, name: 'Pack' });

    const res = await withAuth(request(app).get('/api/mobile/products/8'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 8, name: 'Pack' });
  });
});
