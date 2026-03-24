import request from 'supertest';
import { jest } from '@jest/globals';

const mockListAllServices = jest.fn();
const mockListServiceProducts = jest.fn();

jest.unstable_mockModule('../../middlewares/verifyToken.js', () => ({
  verifyToken: (req, _res, next) => {
    req.user_payload = { id: 15 };
    next();
  }
}));

jest.unstable_mockModule('../../services/service-products.service.js', () => ({
  listAllServices: mockListAllServices,
  listServiceProducts: mockListServiceProducts,
  listUserProducts: jest.fn(),
  assignProduct: jest.fn(),
  unassignProduct: jest.fn(),
  getActiveProductDetail: jest.fn(),
  getProductDetail: jest.fn()
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined)
}));

const { default: app } = await import('../../app.js');

describe('Integración - Service Products API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/mobile/services -> 200 y lista de servicios', async () => {
    mockListAllServices.mockResolvedValue([
      { id: 1, name: 'Nutrición' },
      { id: 2, name: 'Fisioterapia' }
    ]);

    const response = await request(app)
      .get('/api/mobile/services')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual([
      { id: 1, name: 'Nutrición' },
      { id: 2, name: 'Fisioterapia' }
    ]);
  });

  it('GET /api/mobile/service-products -> 400 por query inválida', async () => {
    const response = await request(app)
      .get('/api/mobile/service-products?primary_service_id=abc')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Parámetro ID inválido' });
    expect(mockListServiceProducts).not.toHaveBeenCalled();
  });

  it('GET /api/mobile/services -> 500 si falla el servicio', async () => {
    mockListAllServices.mockRejectedValue(new Error('DB temporary error'));

    const response = await request(app)
      .get('/api/mobile/services')
      .set('Authorization', 'Bearer fake-token');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Error al obtener los servicios',
      details: 'DB temporary error'
    });
  });
});
