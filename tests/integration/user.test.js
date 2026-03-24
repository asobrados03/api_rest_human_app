import request from 'supertest';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createMockConnection,
  createUploadDocumentModule,
  createUploadProfilePicModule,
  createVerifyTokenModule,
  resetMockObject,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

const mockGetConnection = jest.fn();
const userRepository = {
  findUserById: jest.fn(),
  findUserByEmail: jest.fn(),
  findAllSubscriptions: jest.fn(),
  findSubscriptionHistory: jest.fn(),
  findProfilePicName: jest.fn(),
  updateUserDynamic: jest.fn(),
  deleteUserByEmail: jest.fn(),
  findAllCoaches: jest.fn(),
  findServiceByName: jest.fn(),
  findPrimaryServiceByName: jest.fn(),
  findPreferredCoachRelation: jest.fn(),
  updatePreferredCoach: jest.fn(),
  createPreferredCoach: jest.fn(),
  findPreferredCoachByCustomer: jest.fn(),
  removeUserProfilePic: jest.fn(),
  getStatsLastMonth: jest.fn(),
  getStatsTopCoach: jest.fn(),
  getStatsPending: jest.fn(),
  findValidCouponByCode: jest.fn(),
  findCouponByCodeSimple: jest.fn(),
  getUserCouponsIds: jest.fn(),
  updateUserCouponsIds: jest.fn(),
  findCouponsDetails: jest.fn(),
  findUserDocuments: jest.fn(),
  createUserDocument: jest.fn(),
  findDocumentByFilename: jest.fn(),
  deleteDocumentRecord: jest.fn(),
  findEwalletBalance: jest.fn(),
  findEwalletTransactions: jest.fn(),
  findSavedPaymentMethod: jest.fn()
};

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule());
jest.unstable_mockModule('../../middlewares/uploadProfile_Pic.js', () => createUploadProfilePicModule());
jest.unstable_mockModule('../../middlewares/uploadDocument.js', () => createUploadDocumentModule());
jest.unstable_mockModule('../../repositories/user.repository.js', () => userRepository);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - User API completa', () => {
  // Cubre lógica del servicio de usuario: autorización por token, validaciones y transformación de datos.
  let connection;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockObject(userRepository);
    connection = createMockConnection();
    setupDbConnectionMock(mockGetConnection, connection);
  });

  it.each([
    ['get', '/api/mobile/user?user_id=1'],
    ['put', '/api/mobile/user'],
    ['delete', '/api/mobile/user?email=qa@human.app'],
    ['delete', '/api/mobile/user/photo?email=qa@human.app&profilePictureName=x.jpg'],
    ['get', '/api/mobile/users/1/stats'],
    ['get', '/api/mobile/coaches'],
    ['post', '/api/mobile/user/preferred-coach'],
    ['get', '/api/mobile/user/preferred-coach?customer_id=1'],
    ['get', '/api/mobile/user/preferred-coach-with-service?customer_id=1&service_name=Nutrición'],
    ['post', '/api/mobile/users/1/coupons'],
    ['delete', '/api/mobile/users/1/coupons/WELCOME10'],
    ['get', '/api/mobile/users/1/coupons'],
    ['post', '/api/mobile/users/1/documents'],
    ['get', '/api/mobile/users/1/documents'],
    ['delete', '/api/mobile/users/1/documents/id.pdf'],
    ['get', '/api/mobile/user/e-wallet-balance'],
    ['get', '/api/mobile/user/transactions'],
    ['get', '/api/mobile/user/saved-payment-method'],
    ['get', '/api/mobile/user/subscriptions'],
    ['get', '/api/mobile/user/subscriptions/history']
  ])('%s %s -> 401 sin token', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it('GET /api/mobile/user -> 400 si falta user_id', async () => {
    const res = await withAuth(request(app).get('/api/mobile/user'));
    expect(res.status).toBe(400);
  });

  it('GET /api/mobile/user -> 200 con normalización de campos', async () => {
    userRepository.findUserById.mockResolvedValue({
      id: 1,
      fullName: 'QA User',
      email: 'qa@human.app',
      postcode: '28001',
      dni: '',
      profilePictureName: ''
    });

    const res = await withAuth(request(app).get('/api/mobile/user?user_id=1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ postcode: 28001, dni: null, profilePictureName: null }));
  });

  it('PUT /api/mobile/user -> 401 cuando token no coincide con usuario a actualizar', async () => {
    const res = await withAuth(request(app).put('/api/mobile/user')).send({
      user: JSON.stringify({ id: 2, email: 'otro@human.app' })
    });

    expect(res.status).toBe(401);
  });

  it('PUT /api/mobile/user -> 200 cuando update dinámico es correcto', async () => {
    userRepository.updateUserDynamic.mockResolvedValue(undefined);
    userRepository.findUserById
      .mockResolvedValueOnce({ profile_pic: null })
      .mockResolvedValueOnce({ id: 1, email: 'qa@human.app', postcode: '28002', dni: '123', profilePictureName: 'a.png' });

    const res = await withAuth(request(app).put('/api/mobile/user')).send({
      user: JSON.stringify({ id: 1, email: 'qa@human.app', fullName: 'Nuevo Nombre', dateOfBirth: '10/04/1992' })
    });

    expect(res.status).toBe(200);
    expect(userRepository.updateUserDynamic).toHaveBeenCalledTimes(1);
  });

  it('DELETE /api/mobile/user -> 404 cuando no existe email', async () => {
    userRepository.findUserByEmail.mockResolvedValue(undefined);

    const res = await withAuth(request(app).delete('/api/mobile/user?email=qa@human.app'));

    expect(res.status).toBe(404);
  });

  it('DELETE /api/mobile/user/photo -> 404 si no hay foto de perfil', async () => {
    userRepository.findProfilePicName.mockResolvedValue(null);

    const res = await withAuth(request(app).delete('/api/mobile/user/photo?email=qa@human.app&profilePictureName=x.jpg'));

    expect(res.status).toBe(404);
  });

  it('GET /api/mobile/users/:id/stats -> 200 agrega métricas y entrenador más frecuente', async () => {
    userRepository.getStatsLastMonth.mockResolvedValue([{ total: 2 }, { total: 1 }]);
    userRepository.getStatsTopCoach.mockResolvedValue([{ coach_name: 'Coach 1', cnt: 2 }, { coach_name: 'Coach 2', cnt: 5 }]);
    userRepository.getStatsPending.mockResolvedValue([{ total: 4 }]);

    const res = await withAuth(request(app).get('/api/mobile/users/1/stats'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      last_month_workouts: 3,
      pending_bookings: 4,
      most_frequent_trainer: 'Coach 2'
    });
  });

  it('POST /api/mobile/user/preferred-coach -> 400 cuando el servicio no existe', async () => {
    userRepository.findServiceByName.mockResolvedValue(null);

    const res = await withAuth(request(app).post('/api/mobile/user/preferred-coach')).send({
      service_name: 'Inexistente', customer_id: 1, coach_id: 7
    });

    expect(res.status).toBe(400);
  });

  it('GET /api/mobile/user/preferred-coach -> 200 devuelve coach preferido', async () => {
    userRepository.findPreferredCoachByCustomer.mockResolvedValue({ coach_id: 7 });

    const res = await withAuth(request(app).get('/api/mobile/user/preferred-coach?customer_id=1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferred_coach_id: 7 });
  });

  it('GET /api/mobile/user/preferred-coach-with-service -> 200', async () => {
    userRepository.findPrimaryServiceByName.mockResolvedValue({ primary_service_id: 9 });
    userRepository.findPreferredCoachRelation.mockResolvedValue({ coach_id: 3 });

    const res = await withAuth(request(app).get('/api/mobile/user/preferred-coach-with-service?customer_id=1&service_name=Nutrición'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferred_coach_id: 3 });
  });

  it('POST /api/mobile/users/:id/coupons -> 204 cuando añade cupón válido', async () => {
    userRepository.findValidCouponByCode.mockResolvedValue({ coupon_id: 11, customer_ids: null });
    userRepository.getUserCouponsIds.mockResolvedValue({ coupons_ids: '' });
    userRepository.updateUserCouponsIds.mockResolvedValue(undefined);

    const res = await withAuth(request(app).post('/api/mobile/users/1/coupons')).send({ coupon_code: 'WELCOME10' });

    expect(res.status).toBe(204);
  });

  it('DELETE /api/mobile/users/:id/coupons/:coupon -> 400 si el usuario no lo tiene', async () => {
    userRepository.findCouponByCodeSimple.mockResolvedValue({ coupon_id: 11 });
    userRepository.getUserCouponsIds.mockResolvedValue({ coupons_ids: '1,2,3' });

    const res = await withAuth(request(app).delete('/api/mobile/users/1/coupons/WELCOME10'));

    expect(res.status).toBe(400);
  });

  it('GET /api/mobile/users/:id/coupons -> 204 cuando no hay cupones', async () => {
    userRepository.getUserCouponsIds.mockResolvedValue({ coupons_ids: '' });

    const res = await withAuth(request(app).get('/api/mobile/users/1/coupons'));

    expect(res.status).toBe(204);
  });

  it('POST /api/mobile/users/:id/documents -> 400 cuando no se sube archivo', async () => {
    const res = await withAuth(request(app).post('/api/mobile/users/1/documents'));
    expect(res.status).toBe(400);
  });

  it('GET /api/mobile/users/:id/documents -> 200', async () => {
    userRepository.findUserDocuments.mockResolvedValue([{ filename: 'id.pdf' }]);

    const res = await withAuth(request(app).get('/api/mobile/users/1/documents'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ filename: 'id.pdf' }]);
  });

  it('DELETE /api/mobile/users/:id/documents/:filename -> 404 si no existe', async () => {
    userRepository.findDocumentByFilename.mockResolvedValue(null);

    const res = await withAuth(request(app).delete('/api/mobile/users/1/documents/id.pdf'));

    expect(res.status).toBe(404);
  });

  it('GET endpoints de e-wallet/suscripciones -> 200', async () => {
    userRepository.findEwalletBalance.mockResolvedValue({ balance: 100 });
    userRepository.findEwalletTransactions.mockResolvedValue([{ amount: 10, balance: 100, product_name: 'Pack', type: 'purchase', created_at: '2026-01-01' }]);
    userRepository.findSavedPaymentMethod.mockResolvedValue({ id: 1 });
    userRepository.findAllSubscriptions.mockResolvedValue([{ id: 1, paymentmethod: 'ewallet', order_prefix: 'ORD-1' }]);
    userRepository.findSubscriptionHistory.mockResolvedValue([{ id: 1, method: 'ewallet', message: null, pasref: null, orderid: null }]);

    const [balance, tx, saved, subs, history] = await Promise.all([
      withAuth(request(app).get('/api/mobile/user/e-wallet-balance')),
      withAuth(request(app).get('/api/mobile/user/transactions')),
      withAuth(request(app).get('/api/mobile/user/saved-payment-method')),
      withAuth(request(app).get('/api/mobile/user/subscriptions')),
      withAuth(request(app).get('/api/mobile/user/subscriptions/history'))
    ]);

    expect(balance.status).toBe(200);
    expect(tx.status).toBe(200);
    expect(saved.status).toBe(200);
    expect(subs.status).toBe(200);
    expect(history.status).toBe(200);
  });
});
