import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockFindUserByEmail = jest.fn();
const mockBcryptCompare = jest.fn();
const mockJwtSign = jest.fn();
const mockJwtVerify = jest.fn();

jest.unstable_mockModule('../../repositories/auth.repository.js', () => ({
  findUserByEmail: mockFindUserByEmail,
  findUserByDni: jest.fn(),
  createUser: jest.fn(),
  findUserById: jest.fn(),
  updateUserPassword: jest.fn(),
  updatePasswordByEmail: jest.fn()
}));

jest.unstable_mockModule('bcrypt', () => ({
  default: {
    compare: mockBcryptCompare,
    hash: jest.fn()
  }
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    sign: mockJwtSign,
    verify: mockJwtVerify
  }
}));

jest.unstable_mockModule('../../services/mailer.service.js', () => ({
  sendResetEmail: jest.fn()
}));

const {
  loginUserService,
  refreshTokensService
} = await import('../../services/auth.service.js');

describe('Unit - auth service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECRET_JWT_KEY = 'unit-secret';
  });

  it('loginUserService valida entradas requeridas', async () => {
    const dbPool = { getConnection: jest.fn() };

    await expect(loginUserService(dbPool, { email: '', password: '' })).rejects.toMatchObject({
      status: 400,
      message: 'Se requiere email y contraseña'
    });

    expect(dbPool.getConnection).not.toHaveBeenCalled();
  });

  it('loginUserService retorna 401 cuando usuario no existe', async () => {
    const release = jest.fn();
    const dbPool = {
      getConnection: jest.fn().mockResolvedValue({ release })
    };
    mockFindUserByEmail.mockResolvedValue(null);

    await expect(loginUserService(dbPool, { email: 'a@test.com', password: '123456' })).rejects.toMatchObject({
      status: 401,
      message: 'Credenciales inválidas'
    });

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('loginUserService retorna 401 cuando contraseña es inválida', async () => {
    const release = jest.fn();
    const dbPool = {
      getConnection: jest.fn().mockResolvedValue({ release })
    };

    mockFindUserByEmail.mockResolvedValue({ user_id: 3, email: 'a@test.com', password: 'hash' });
    mockBcryptCompare.mockResolvedValue(false);

    await expect(loginUserService(dbPool, { email: 'a@test.com', password: 'bad' })).rejects.toMatchObject({
      status: 401,
      message: 'Credenciales inválidas'
    });
  });

  it('loginUserService construye payload de usuario y tokens al autenticar', async () => {
    const release = jest.fn();
    const dbPool = {
      getConnection: jest.fn().mockResolvedValue({ release })
    };

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

    const result = await loginUserService(dbPool, { email: 'ANA@example.com ', password: 'secret' });

    expect(mockFindUserByEmail).toHaveBeenCalledWith(expect.anything(), 'ana@example.com');
    expect(result).toMatchObject({
      user: {
        id: 10,
        fullName: 'Ana Pérez',
        email: 'ana@example.com',
        postcode: 28001
      },
      accessToken: 'access-token',
      refreshToken: 'refresh-token'
    });
  });

  it('refreshTokensService maneja token inválido', () => {
    mockJwtVerify.mockImplementation(() => {
      throw new Error('expired');
    });

    expect(() => refreshTokensService('bad-refresh')).toThrow(
      expect.objectContaining({ status: 401, message: 'Refresh token inválido o expirado' })
    );
  });

  it('refreshTokensService genera nuevo refresh si está cerca de expirar', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    mockJwtVerify.mockReturnValue({ id: 1, email: 'a@test.com', type: 'refresh', exp: nowSec + 10 });
    mockJwtSign
      .mockReturnValueOnce('new-access-token')
      .mockReturnValueOnce('new-refresh-token');

    const result = refreshTokensService('old-refresh-token');

    expect(mockJwtSign).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token'
    });
  });

  it('refreshTokensService falla cuando payload no es refresh', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    mockJwtVerify.mockReturnValue({ id: 1, email: 'a@test.com', type: 'access', exp: nowSec + 9999 });

    expect(() => refreshTokensService('wrong-type-token')).toThrow(
      expect.objectContaining({ status: 401, message: 'Token no es de tipo refresh' })
    );
  });
});
