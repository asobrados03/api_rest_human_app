import request from 'supertest';
import {beforeEach, describe, expect, it, jest} from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createUploadProfilePicModule,
  createVerifyTokenModule,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

const mockGetConnection = jest.fn();
const authService = {
  registerUserService: jest.fn(),
  loginUserService: jest.fn(),
  refreshTokensService: jest.fn(),
  changePasswordService: jest.fn(),
  resetPasswordService: jest.fn()
};

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule());
jest.unstable_mockModule('../../middlewares/uploadProfile_Pic.js', () => createUploadProfilePicModule());
jest.unstable_mockModule('../../services/auth.service.js', () => authService);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Auth API completa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDbConnectionMock(mockGetConnection);
  });

  it('POST /api/mobile/users -> 201', async () => {
    authService.registerUserService.mockResolvedValue({ userId: 10, email: 'new@human.app' });
    const res = await request(app).post('/api/mobile/users').send({ email: 'new@human.app', password: 'Secret123' });
    expect(res.status).toBe(201);
  });

  it('POST /api/mobile/sessions -> 200', async () => {
    authService.loginUserService.mockResolvedValue({ user: { id: 1 }, accessToken: 'at', refreshToken: 'rt' });
    const res = await request(app).post('/api/mobile/sessions').send({ email: 'qa@human.app', password: 'x' });
    expect(res.status).toBe(200);
  });

  it('POST /api/mobile/tokens/refresh -> 401 sin Bearer', async () => {
    const res = await request(app).post('/api/mobile/tokens/refresh');
    expect(res.status).toBe(401);
  });

  it('POST /api/mobile/tokens/refresh -> 200', async () => {
    authService.refreshTokensService.mockReturnValue({ accessToken: 'new-at', refreshToken: 'new-rt' });
    const res = await withAuth(request(app).post('/api/mobile/tokens/refresh'));
    expect(res.status).toBe(200);
  });

  it.each([
    ['delete', '/api/mobile/sessions/current'],
    ['put', '/api/mobile/change-password']
  ])('%s %s -> 401 sin token', async (method, path) => {
    const res = await request(app)[method](path).send({ currentPassword: 'a', newPassword: 'b' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/mobile/sessions/current -> 204 con token', async () => {
    const res = await withAuth(request(app).delete('/api/mobile/sessions/current'));
    expect(res.status).toBe(204);
  });

  it('PUT /api/mobile/change-password -> 200 con token', async () => {
    authService.changePasswordService.mockResolvedValue({ userId: 1 });
    const res = await withAuth(request(app).put('/api/mobile/change-password')).send({ currentPassword: 'old', newPassword: 'new', userId: 1 });
    expect(res.status).toBe(200);
  });

  it('PUT /api/mobile/reset-password -> 200', async () => {
    authService.resetPasswordService.mockResolvedValue(undefined);
    const res = await request(app).put('/api/mobile/reset-password').send({ email: 'qa@human.app' });
    expect(res.status).toBe(200);
  });

  it('POST /api/mobile/sessions -> 500', async () => {
    authService.loginUserService.mockRejectedValue(new Error('Unexpected auth error'));
    const res = await request(app).post('/api/mobile/sessions').send({ email: 'qa@human.app', password: 'x' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Unexpected auth error' });
  });
});
