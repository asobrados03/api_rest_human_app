import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDbModule,
  createLoggerModule,
  createMockConnection,
  createUploadProfilePicModule,
  createVerifyTokenModule,
  resetMockObject,
  setupDbConnectionMock,
  withAuth
} from './helpers/test-helpers.js';

process.env.SECRET_JWT_KEY = process.env.SECRET_JWT_KEY || 'test-secret';

const mockGetConnection = jest.fn();
const authRepository = {
  findUserByEmail: jest.fn(),
  findUserByDni: jest.fn(),
  createUser: jest.fn(),
  findUserById: jest.fn(),
  updateUserPassword: jest.fn(),
  updatePasswordByEmail: jest.fn()
};
const mailerService = { sendResetEmail: jest.fn() };

jest.unstable_mockModule('../../config/database.js', () => createDbModule(mockGetConnection));
jest.unstable_mockModule('../../middlewares/verifyToken.js', () => createVerifyTokenModule());
jest.unstable_mockModule('../../middlewares/uploadProfile_Pic.js', () => createUploadProfilePicModule());
jest.unstable_mockModule('../../repositories/auth.repository.js', () => authRepository);
jest.unstable_mockModule('../../services/mailer.service.js', () => mailerService);
jest.unstable_mockModule('../../utils/logger.js', () => createLoggerModule());

const { default: app } = await import('../../app.js');

describe('Integración - Auth API completa', () => {
  // Cubre validaciones de entrada y reglas de negocio del servicio de autenticación con repositorio mockeado.
  let connection;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockObject(authRepository);
    resetMockObject(mailerService);
    connection = createMockConnection();
    setupDbConnectionMock(mockGetConnection, connection);
  });

  it('POST /api/mobile/users -> 201 con normalización de email y fecha', async () => {
    authRepository.findUserByEmail.mockResolvedValue(undefined);
    authRepository.findUserByDni.mockResolvedValue(undefined);
    authRepository.createUser.mockResolvedValue(10);

    const res = await request(app).post('/api/mobile/users').send({
      nombre: 'Ana',
      apellidos: 'Tester',
      rawEmail: ' New@Human.App ',
      telefono: '600000000',
      password: 'Secret123',
      fechaNacimientoRaw: '01011990',
      codigoPostal: '28001'
    });

    expect(res.status).toBe(201);
    expect(authRepository.findUserByEmail).toHaveBeenCalledWith(connection, 'new@human.app');
    expect(authRepository.createUser).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ email: 'new@human.app', fechaSql: '1990-01-01' })
    );
  });

  it('POST /api/mobile/users -> 409 cuando el email ya existe', async () => {
    authRepository.findUserByEmail.mockResolvedValue({ user_id: 2 });

    const res = await request(app).post('/api/mobile/users').send({
      nombre: 'Ana', apellidos: 'Tester', rawEmail: 'qa@human.app', telefono: '600000000',
      password: 'Secret123', fechaNacimientoRaw: '01011990', codigoPostal: '28001'
    });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'El email ya está en uso' });
  });

  it('POST /api/mobile/sessions -> 400 cuando faltan credenciales', async () => {
    const res = await request(app).post('/api/mobile/sessions').send({ email: 'qa@human.app' });
    expect(res.status).toBe(400);
  });

  it('POST /api/mobile/sessions -> 401 cuando la contraseña no coincide', async () => {
    const validHash = await bcrypt.hash('correcta', 10);
    authRepository.findUserByEmail.mockResolvedValue({
      user_id: 1,
      email: 'qa@human.app',
      password: validHash
    });

    const res = await request(app).post('/api/mobile/sessions').send({ email: 'qa@human.app', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Credenciales inválidas' });
  });

  it('POST /api/mobile/sessions -> 200 y devuelve tokens cuando el login es válido', async () => {
    const validHash = await bcrypt.hash('Secret123', 10);
    authRepository.findUserByEmail.mockResolvedValue({
      user_id: 1,
      user_name: 'QA User',
      email: 'qa@human.app',
      password: validHash
    });

    const res = await request(app).post('/api/mobile/sessions').send({ email: 'qa@human.app', password: 'Secret123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      id: 1,
      fullName: 'QA User',
      email: 'qa@human.app',
      accessToken: expect.any(String),
      refreshToken: expect.any(String)
    }));
  });

  it('POST /api/mobile/tokens/refresh -> 401 sin Bearer', async () => {
    const res = await request(app).post('/api/mobile/tokens/refresh');
    expect(res.status).toBe(401);
  });

  it('POST /api/mobile/tokens/refresh -> 200 con refresh token válido', async () => {
    const refreshToken = jwt.sign(
      { id: 1, email: 'qa@human.app', type: 'refresh' },
      process.env.SECRET_JWT_KEY,
      { expiresIn: '7d' }
    );

    const res = await request(app)
      .post('/api/mobile/tokens/refresh')
      .set('Authorization', `Bearer ${refreshToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String)
    });
  });

  it('POST /api/mobile/sessions -> 500 cuando hay fallo de infraestructura en DB', async () => {
    mockGetConnection.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).post('/api/mobile/sessions').send({
      email: 'qa@human.app',
      password: 'Secret123'
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual(expect.objectContaining({
      error: expect.any(String)
    }));
  });

  it('DELETE /api/mobile/sessions/current -> 204 con token', async () => {
    const res = await withAuth(request(app).delete('/api/mobile/sessions/current'));
    expect(res.status).toBe(204);
  });

  it('PUT /api/mobile/change-password -> 401 si userId no coincide con token', async () => {
    const res = await withAuth(request(app).put('/api/mobile/change-password')).send({
      currentPassword: 'old', newPassword: 'new', userId: 99
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No estás autorizado' });
  });

  it('PUT /api/mobile/change-password -> 200 cuando cambia correctamente', async () => {
    const oldHash = await bcrypt.hash('Secret123', 10);
    authRepository.findUserById.mockResolvedValue({
      user_id: 1,
      password: oldHash
    });
    authRepository.updateUserPassword.mockResolvedValue(undefined);

    const res = await withAuth(request(app).put('/api/mobile/change-password')).send({
      currentPassword: 'Secret123',
      newPassword: 'Secret456',
      userId: 1
    });

    expect(res.status).toBe(200);
    expect(authRepository.updateUserPassword).toHaveBeenCalledTimes(1);
  });

  it('PUT /api/mobile/reset-password -> 404 cuando el usuario no existe', async () => {
    authRepository.updatePasswordByEmail.mockResolvedValue(false);

    const res = await request(app).put('/api/mobile/reset-password').send({ email: 'no@human.app' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no encontrado' });
  });

  it('PUT /api/mobile/reset-password -> 500 cuando falla el envío de email', async () => {
    authRepository.updatePasswordByEmail.mockResolvedValue(true);
    mailerService.sendResetEmail.mockRejectedValue(new Error('smtp down'));

    const res = await request(app).put('/api/mobile/reset-password').send({ email: 'qa@human.app' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error al enviar el correo' });
  });
});
