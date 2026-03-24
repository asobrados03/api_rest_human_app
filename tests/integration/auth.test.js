import request from 'supertest';
import { jest } from '@jest/globals';

const mockLoginUserService = jest.fn();

jest.unstable_mockModule('../../services/auth.service.js', () => ({
  loginUserService: mockLoginUserService,
  registerUserService: jest.fn(),
  refreshTokensService: jest.fn(),
  changePasswordService: jest.fn(),
  resetPasswordService: jest.fn()
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined)
}));

const { default: app } = await import('../../app.js');

describe('Integración - Auth API (/api/mobile/sessions)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('debe iniciar sesión exitosamente y devolver tokens con status 200', async () => {
    mockLoginUserService.mockResolvedValue({
      user: { id: 25, email: 'ana@example.com', role: 'user' },
      accessToken: 'access-token-test',
      refreshToken: 'refresh-token-test'
    });

    const response = await request(app)
      .post('/api/mobile/sessions')
      .send({ email: 'ana@example.com', password: 'secret123' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toMatchObject({
      id: 25,
      email: 'ana@example.com',
      accessToken: 'access-token-test',
      refreshToken: 'refresh-token-test'
    });
    expect(mockLoginUserService).toHaveBeenCalledWith(expect.anything(), {
      email: 'ana@example.com',
      password: 'secret123'
    });
  });

  it('debe responder error de validación cuando auth.service lanza status 400', async () => {
    mockLoginUserService.mockRejectedValue({
      status: 400,
      message: 'Email o contraseña inválidos'
    });

    const response = await request(app)
      .post('/api/mobile/sessions')
      .send({ email: 'ana@example.com', password: '' });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ error: 'Email o contraseña inválidos' });
  });

  it('debe responder error 500 ante fallo inesperado del servicio', async () => {
    mockLoginUserService.mockRejectedValue(new Error('Unexpected DB failure'));

    const response = await request(app)
      .post('/api/mobile/sessions')
      .send({ email: 'ana@example.com', password: 'secret123' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Unexpected DB failure' });
  });
});
