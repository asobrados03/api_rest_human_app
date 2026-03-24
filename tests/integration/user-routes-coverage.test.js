import request from 'supertest';
import { jest } from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createUploadDocumentModule,
  createUploadProfilePicModule,
  createVerifyTokenModule,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

const mockGetConnection = jest.fn();
const userService = {
  getUserByIdService: jest.fn(),
  updateUserService: jest.fn(),
  deleteUserService: jest.fn(),
  deleteProfilePicService: jest.fn(),
  getUserStatsService: jest.fn(),
  getCoachesService: jest.fn(),
  assignPreferredCoachService: jest.fn(),
  getPreferredCoachService: jest.fn(),
  getPreferredCoachWithServiceService: jest.fn(),
  addCouponToUserService: jest.fn(),
  removeCouponToUserService: jest.fn(),
  getUserCouponService: jest.fn(),
  getUserDocumentsService: jest.fn(),
  uploadUserDocumentService: jest.fn(),
  deleteUserDocumentService: jest.fn(),
  getEwalletBalanceService: jest.fn(),
  getEwalletTransactionsService: jest.fn(),
  checkSavedPaymentMethodService: jest.fn(),
  getUserSubscriptionsService: jest.fn(),
  getSubscriptionsHistoryService: jest.fn()
};

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule());
jest.unstable_mockModule('../../middlewares/uploadProfile_Pic.js', () => createUploadProfilePicModule());
jest.unstable_mockModule('../../middlewares/uploadDocument.js', () => createUploadDocumentModule());
jest.unstable_mockModule('../../services/user.service.js', () => userService);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - User API completa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDbConnectionMock(mockGetConnection);
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
    ['get', '/api/mobile/user/preferred-coach-with-service?customer_id=1'],
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

  it.each([
    ['get', '/api/mobile/user?user_id=1', () => userService.getUserByIdService.mockResolvedValue({ id: 1 })],
    ['put', '/api/mobile/user', () => userService.updateUserService.mockResolvedValue({ id: 1 }), { user: '{}' }],
    ['delete', '/api/mobile/user?email=qa@human.app', () => userService.deleteUserService.mockResolvedValue({ email: 'qa@human.app', userId: 1 })],
    ['delete', '/api/mobile/user/photo?email=qa@human.app&profilePictureName=x.jpg', () => userService.deleteProfilePicService.mockResolvedValue({ email: 'qa@human.app', userId: 1 })],
    ['get', '/api/mobile/users/1/stats', () => userService.getUserStatsService.mockResolvedValue({ booked: 3 })],
    ['get', '/api/mobile/coaches', () => userService.getCoachesService.mockResolvedValue([{ id: 10 }])],
    ['post', '/api/mobile/user/preferred-coach', () => userService.assignPreferredCoachService.mockResolvedValue({ status: 200, message: 'Asignado' }), { service_name: 'Nutrición', customer_id: 1, coach_id: 7 }],
    ['get', '/api/mobile/user/preferred-coach?customer_id=1', () => userService.getPreferredCoachService.mockResolvedValue({ coach_id: 7 })],
    ['get', '/api/mobile/user/preferred-coach-with-service?customer_id=1', () => userService.getPreferredCoachWithServiceService.mockResolvedValue({ coach_id: 7 })],
    ['post', '/api/mobile/users/1/coupons', () => userService.addCouponToUserService.mockResolvedValue(undefined), { coupon_code: 'WELCOME10' }, 204],
    ['delete', '/api/mobile/users/1/coupons/WELCOME10', () => userService.removeCouponToUserService.mockResolvedValue(undefined), undefined, 204],
    ['get', '/api/mobile/users/1/coupons', () => userService.getUserCouponService.mockResolvedValue([{ coupon_code: 'WELCOME10' }])],
    ['post', '/api/mobile/users/1/documents', () => userService.uploadUserDocumentService.mockResolvedValue({ filename: 'id.pdf' }), undefined, 201],
    ['get', '/api/mobile/users/1/documents', () => userService.getUserDocumentsService.mockResolvedValue([{ filename: 'id.pdf' }])],
    ['delete', '/api/mobile/users/1/documents/id.pdf', () => userService.deleteUserDocumentService.mockResolvedValue({ deleted: true })],
    ['get', '/api/mobile/user/e-wallet-balance', () => userService.getEwalletBalanceService.mockResolvedValue({ balance: 100 })],
    ['get', '/api/mobile/user/transactions', () => userService.getEwalletTransactionsService.mockResolvedValue([{ amount: 10 }])],
    ['get', '/api/mobile/user/saved-payment-method', () => userService.checkSavedPaymentMethodService.mockResolvedValue({ hasSavedMethod: true })],
    ['get', '/api/mobile/user/subscriptions', () => userService.getUserSubscriptionsService.mockResolvedValue([{ id: 1 }])],
    ['get', '/api/mobile/user/subscriptions/history', () => userService.getSubscriptionsHistoryService.mockResolvedValue([{ id: 1 }])]
  ])('%s %s -> éxito', async (...args) => {
    const [method, path, setupMock, body, expectedStatus = 200] = args;
    setupMock();
    const req = withAuth(request(app)[method](path));
    const res = body ? await req.send(body) : await req;
    expect(res.status).toBe(expectedStatus);
  });

  it('GET /api/mobile/coaches -> 500', async () => {
    userService.getCoachesService.mockRejectedValue(new Error('Unexpected coaches error'));
    const res = await withAuth(request(app).get('/api/mobile/coaches'));
    expect(res.status).toBe(500);
  });
});
