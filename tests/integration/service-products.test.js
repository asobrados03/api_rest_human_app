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
const serviceProductsService = {
  listAllServices: jest.fn(),
  listServiceProducts: jest.fn(),
  listUserProducts: jest.fn(),
  assignProduct: jest.fn(),
  unassignProduct: jest.fn(),
  getActiveProductDetail: jest.fn(),
  getProductDetail: jest.fn()
};

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule({ id: 1, role: 'user' }));
jest.unstable_mockModule('../../services/service-products.service.js', () => serviceProductsService);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Service Products API completa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDbConnectionMock(mockGetConnection);
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

  it('POST /api/mobile/users/:id/products -> 400 faltan parámetros', async () => {
    const res = await withAuth(request(app).post('/api/mobile/users/10/products')).send({ product_id: 8 });
    expect(res.status).toBe(400);
  });

  it.each([
    ['get', '/api/mobile/services', () => serviceProductsService.listAllServices.mockResolvedValue([{ id: 1 }])],
    ['get', '/api/mobile/service-products?primary_service_id=1', () => serviceProductsService.listServiceProducts.mockResolvedValue([{ id: 2 }])],
    ['get', '/api/mobile/users/10/products', () => serviceProductsService.listUserProducts.mockResolvedValue([{ id: 3 }])],
    ['post', '/api/mobile/users/10/products', () => serviceProductsService.assignProduct.mockResolvedValue({ assigned: true }), { product_id: 8, payment_method: 'card' }],
    ['delete', '/api/mobile/users/10/products/8', () => serviceProductsService.unassignProduct.mockResolvedValue({ unassigned: true })],
    ['get', '/api/mobile/active-product-detail?user_id=10&product_id=8', () => serviceProductsService.getActiveProductDetail.mockResolvedValue({ product_id: 8 })],
    ['get', '/api/mobile/products/8', () => serviceProductsService.getProductDetail.mockResolvedValue({ id: 8 })]
  ])('%s %s -> éxito', async (...args) => {
    const [method, path, setupMock, body] = args;
    setupMock();
    const req = withAuth(request(app)[method](path));
    const res = body ? await req.send(body) : await req;
    expect(res.status).toBe(200);
  });

  it('GET /api/mobile/services -> 500', async () => {
    serviceProductsService.listAllServices.mockRejectedValue(new Error('DB timeout'));
    const res = await withAuth(request(app).get('/api/mobile/services'));
    expect(res.status).toBe(500);
  });
});
