/**
 * Módulo testeado: services/auth.service.js
 * Dependencias mockeadas: repositories/auth.repository.js, bcrypt, jsonwebtoken, node:crypto y services/mailer.service.js
 * porque son dependencias externas (DB, hashing, JWT, generación aleatoria y envío de email).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFindUserByEmail = jest.fn();
const mockFindUserByDni = jest.fn();
const mockCreateUser = jest.fn();
const mockFindUserById = jest.fn();
const mockUpdateUserPassword = jest.fn();
const mockUpdatePasswordByEmail = jest.fn();

const mockBcryptCompare = jest.fn();
const mockBcryptHash = jest.fn();

const mockJwtSign = jest.fn();
const mockJwtVerify = jest.fn();

const mockSendResetEmail = jest.fn();
const mockRandomBytes = jest.fn();

jest.unstable_mockModule('../../repositories/auth.repository.js', () => ({
  findUserByEmail: mockFindUserByEmail,
  findUserByDni: mockFindUserByDni,
  createUser: mockCreateUser,
  findUserById: mockFindUserById,
  updateUserPassword: mockUpdateUserPassword,
  updatePasswordByEmail: mockUpdatePasswordByEmail
}));

jest.unstable_mockModule('bcrypt', () => ({
  default: {
    compare: mockBcryptCompare,
    hash: mockBcryptHash
  }
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    sign: mockJwtSign,
    verify: mockJwtVerify
  }
}));

jest.unstable_mockModule('node:crypto', () => ({
  default: {
    randomBytes: mockRandomBytes
  }
}));

jest.unstable_mockModule('../../services/mailer.service.js', () => ({
  sendResetEmail: mockSendResetEmail
}));

const {
  registerUserService,
  loginUserService,
  refreshTokensService,
  changePasswordService,
  resetPasswordService
} = await import('../../services/auth.service.js');

describe('Unit - auth service', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    process.env.SECRET_JWT_KEY = 'unit-secret';
  });

  describe('registerUserService', () => {
    it('lanza 400 cuando faltan campos obligatorios', async () => {
      await expect(registerUserService({}, {
        nombre: 'Ana',
        apellidos: '',
        rawEmail: 'ana@example.com',
        telefono: '111',
        password: '123',
        fechaNacimientoRaw: '01011990',
        codigoPostal: ''
      })).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Faltan campos')
      });
    });

    it('lanza 400 cuando la fecha no es válida', async () => {
      await expect(registerUserService({}, {
        nombre: 'Ana',
        apellidos: 'Pérez',
        rawEmail: 'ana@example.com',
        telefono: '111',
        password: '123',
        fechaNacimientoRaw: 'ABCD',
        codigoPostal: '28001'
      })).rejects.toMatchObject({ status: 400, message: 'Formato de fecha inválido. Usa ddMMyyyy' });
    });

    it('crea usuario con email normalizado y commitea la transacción', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };

      mockFindUserByEmail.mockResolvedValue(null);
      mockFindUserByDni.mockResolvedValue(null);
      mockBcryptHash.mockResolvedValue('hashed-password');
      mockCreateUser.mockResolvedValue(99);

      const result = await registerUserService(dbPool, {
        nombre: ' Ana ',
        apellidos: ' Pérez ',
        rawEmail: ' ANA@EXAMPLE.COM ',
        telefono: ' 600123123 ',
        password: 'secret',
        fechaNacimientoRaw: '01011990',
        codigoPostal: ' 28001 ',
        direccionPostal: ' Calle Sol ',
        dni: ' 12345678A ',
        sexo: ' F ',
        deviceType: 'ios',
        profilePicFilename: 'avatar.jpg'
      });

      expect(mockFindUserByEmail).toHaveBeenCalledWith(connection, 'ana@example.com');
      expect(mockCreateUser).toHaveBeenCalledWith(connection, expect.objectContaining({
        nombreCompleto: 'Ana Pérez',
        email: 'ana@example.com',
        hashedPassword: 'hashed-password',
        telefono: '600123123'
      }));
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(result).toEqual({ userId: 99, email: 'ana@example.com' });
    });

    it('hace rollback cuando el email ya existe', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockFindUserByEmail.mockResolvedValue({ user_id: 1 });

      await expect(registerUserService(dbPool, {
        nombre: 'Ana',
        apellidos: 'Pérez',
        rawEmail: 'ana@example.com',
        telefono: '111',
        password: '123',
        fechaNacimientoRaw: '01011990',
        codigoPostal: '28001'
      })).rejects.toMatchObject({ status: 409, message: 'El email ya está en uso' });

      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('loginUserService', () => {
    it('devuelve 400 si faltan credenciales', async () => {
      const dbPool = { getConnection: jest.fn() };
      await expect(loginUserService(dbPool, { email: '', password: '' })).rejects.toMatchObject({
        status: 400,
        message: 'Se requiere email y contraseña'
      });
      expect(dbPool.getConnection).not.toHaveBeenCalled();
    });

    it('devuelve 401 si el usuario no existe', async () => {
      const release = jest.fn();
      const dbPool = { getConnection: jest.fn().mockResolvedValue({ release }) };
      mockFindUserByEmail.mockResolvedValue(null);

      await expect(loginUserService(dbPool, { email: 'a@test.com', password: '123456' })).rejects.toMatchObject({
        status: 401,
        message: 'Credenciales inválidas'
      });

      expect(release).toHaveBeenCalledTimes(1);
    });

    it('devuelve 401 si la contraseña no coincide', async () => {
      const release = jest.fn();
      const dbPool = { getConnection: jest.fn().mockResolvedValue({ release }) };

      mockFindUserByEmail.mockResolvedValue({ user_id: 3, email: 'a@test.com', password: 'hash' });
      mockBcryptCompare.mockResolvedValue(false);

      await expect(loginUserService(dbPool, { email: 'a@test.com', password: 'bad' })).rejects.toMatchObject({
        status: 401,
        message: 'Credenciales inválidas'
      });
    });

    it('retorna usuario mapeado y tokens cuando autentica', async () => {
      const release = jest.fn();
      const dbPool = { getConnection: jest.fn().mockResolvedValue({ release }) };

      mockFindUserByEmail.mockResolvedValue({
        user_id: 10,
        user_name: 'Ana Pérez',
        email: 'ana@example.com',
        password: 'hash-ok',
        phone: '666777888',
        sex: 'F',
        date_of_birth: '1990-01-01',
        postal_code: '28001',
        address: 'Calle Luna',
        dni: '12345678A',
        profile_pic: 'ana.png',
        type: 'user'
      });
      mockBcryptCompare.mockResolvedValue(true);
      mockJwtSign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');

      const result = await loginUserService(dbPool, { email: ' ANA@example.com ', password: 'secret' });

      expect(mockFindUserByEmail).toHaveBeenCalledWith(expect.anything(), 'ana@example.com');
      expect(result).toMatchObject({
        user: { id: 10, fullName: 'Ana Pérez', email: 'ana@example.com', postcode: 28001 },
        accessToken: 'access-token',
        refreshToken: 'refresh-token'
      });
    });
  });

  describe('refreshTokensService', () => {
    it('lanza 401 cuando el refresh token es inválido', () => {
      mockJwtVerify.mockImplementation(() => { throw new Error('expired'); });

      expect(() => refreshTokensService('bad-refresh')).toThrow(
        expect.objectContaining({ status: 401, message: 'Refresh token inválido o expirado' })
      );
    });

    it('lanza 401 cuando el payload no es de tipo refresh', () => {
      mockJwtVerify.mockReturnValue({ id: 1, email: 'a@test.com', type: 'access', exp: 2000 });

      expect(() => refreshTokensService('wrong-type-token')).toThrow(
        expect.objectContaining({ status: 401, message: 'Token no es de tipo refresh' })
      );
    });

    it('mantiene el mismo refresh token si aún no está cerca de expirar', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000 * 1000);
      mockJwtVerify.mockReturnValue({ id: 1, email: 'a@test.com', type: 'refresh', exp: 1_000_000 + (2 * 24 * 60 * 60) });
      mockJwtSign.mockReturnValue('new-access-token');

      const result = refreshTokensService('old-refresh-token');

      expect(mockJwtSign).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ accessToken: 'new-access-token', refreshToken: 'old-refresh-token' });
    });

    it('genera nuevo refresh token cuando está por expirar', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000 * 1000);
      mockJwtVerify.mockReturnValue({ id: 1, email: 'a@test.com', type: 'refresh', exp: 1_000_000 + 10 });
      mockJwtSign.mockReturnValueOnce('new-access-token').mockReturnValueOnce('new-refresh-token');

      const result = refreshTokensService('old-refresh-token');

      expect(mockJwtSign).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' });
    });
  });

  describe('changePasswordService', () => {
    it('rechaza cuando userId no coincide con el token', async () => {
      await expect(changePasswordService({}, {
        currentPassword: 'old',
        newPassword: 'new',
        userId: 7,
        userIdToken: 8
      })).rejects.toMatchObject({ status: 401, message: 'No estás autorizado' });
    });

    it('actualiza contraseña y confirma transacción en caso exitoso', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockFindUserById.mockResolvedValue({ user_id: 7, password: 'old-hash' });
      mockBcryptCompare.mockResolvedValue(true);
      mockBcryptHash.mockResolvedValue('new-hash');

      const result = await changePasswordService(dbPool, {
        currentPassword: 'old',
        newPassword: 'new',
        userId: 7,
        userIdToken: 7
      });

      expect(mockUpdateUserPassword).toHaveBeenCalledWith(connection, 7, 'new-hash');
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ userId: 7 });
    });
  });

  describe('resetPasswordService', () => {
    it('lanza 400 cuando falta email', async () => {
      await expect(resetPasswordService({}, '')).rejects.toMatchObject({ status: 400, message: 'Falta el email' });
    });

    it('lanza 404 y rollback cuando no actualiza ningún usuario', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };

      mockRandomBytes.mockReturnValue(Buffer.from('password-seed-123'));
      mockBcryptHash.mockResolvedValue('hash');
      mockUpdatePasswordByEmail.mockResolvedValue(false);

      await expect(resetPasswordService(dbPool, 'ana@example.com')).rejects.toMatchObject({
        status: 404,
        message: 'Usuario no encontrado'
      });

      expect(connection.rollback).toHaveBeenCalled();
      expect(mockSendResetEmail).not.toHaveBeenCalled();
    });

    it('lanza 500 y rollback cuando falla el envío de correo', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };

      mockRandomBytes.mockReturnValue(Buffer.from('password-seed-123'));
      mockBcryptHash.mockResolvedValue('hash');
      mockUpdatePasswordByEmail.mockResolvedValue(true);
      mockSendResetEmail.mockRejectedValue(new Error('smtp failed'));

      await expect(resetPasswordService(dbPool, 'ana@example.com')).rejects.toMatchObject({
        status: 500,
        message: 'Error al enviar el correo'
      });

      expect(connection.rollback).toHaveBeenCalled();
      expect(connection.commit).not.toHaveBeenCalled();
    });

    it('resetea contraseña y commitea cuando todo sale bien', async () => {
      const connection = {
        beginTransaction: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn()
      };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };

      mockRandomBytes.mockReturnValue(Buffer.from('password-seed-123'));
      mockBcryptHash.mockResolvedValue('hash');
      mockUpdatePasswordByEmail.mockResolvedValue(true);
      mockSendResetEmail.mockResolvedValue({ ok: true });

      const result = await resetPasswordService(dbPool, 'ana@example.com');

      expect(mockUpdatePasswordByEmail).toHaveBeenCalledWith(connection, 'ana@example.com', 'hash');
      expect(mockSendResetEmail).toHaveBeenCalledTimes(1);
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ email: 'ana@example.com' });
    });
  });
});
