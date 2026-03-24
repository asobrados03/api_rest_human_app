import {beforeEach, describe, expect, it, jest} from '@jest/globals';

const mockVerify = jest.fn();
const mockLoggerError = jest.fn();

jest.unstable_mockModule('jsonwebtoken', () => ({
  default: {
    verify: mockVerify
  }
}));

jest.unstable_mockModule('../../utils/pino.js', () => ({
  default: {
    error: mockLoggerError
  }
}));

const { verifyToken } = await import('../../middlewares/verifyToken.js');

describe('Unit - verifyToken middleware', () => {
  const createRes = () => {
    return {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SECRET_JWT_KEY = 'test-secret';
  });

  it('permite continuar cuando el token es válido', () => {
    const payload = { id: 1, email: 'unit@test.com' };
    mockVerify.mockReturnValue(payload);

    const req = { headers: { authorization: 'Bearer valid.token' } };
    const res = createRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(mockVerify).toHaveBeenCalledWith('valid.token', 'test-secret');
    expect(req.user_payload).toEqual(payload);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responde 401 cuando falta el token', () => {
    const req = { headers: {} };
    const res = createRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer realm="HumanPerform", charset="UTF-8"'
    );
    expect(res.json).toHaveBeenCalledWith({ error: 'Token not provided' });
  });

  it('responde 401 y registra error cuando el token no es válido', () => {
    mockVerify.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    const req = { headers: { authorization: 'Bearer invalid.token' } };
    const res = createRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledWith(
      { errMessage: 'jwt malformed' },
      '🔒 verifyToken failed'
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token not valid' });
  });
});
