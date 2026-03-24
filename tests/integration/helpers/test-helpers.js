import { jest } from '@jest/globals';

export const createDbModule = (getConnection) => ({
  default: {
    getConnection,
    query: jest.fn(),
    execute: jest.fn()
  }
});

export const setupDbConnectionMock = (mockGetConnection) => {
  mockGetConnection.mockResolvedValue({
    release: jest.fn(),
    query: jest.fn(),
    execute: jest.fn(),
    ping: jest.fn()
  });
};

export const createVerifyTokenModule = (payload = { id: 1, role: 'user', email: 'qa@human.app' }) => ({
  verifyToken: (req, res, next) => {
    if (!req.headers.authorization) {
      return res
        .status(401)
        .set('WWW-Authenticate', 'Bearer realm="HumanPerform"')
        .json({ error: 'Token not provided' });
    }

    req.user_payload = payload;
    req.user = payload;
    next();
  }
});

export const createUploadProfilePicModule = () => ({
  __esModule: true,
  default: { single: () => (req, _res, next) => next() },
  compressImageIfNeeded: (_req, _res, next) => next(),
  handleProfilePicUpload: (_req, _res, next) => next()
});

export const createUploadDocumentModule = () => ({
  __esModule: true,
  default: { single: () => (req, _res, next) => next() }
});

export const createLoggerModule = () => ({
  logActivity: jest.fn().mockResolvedValue(undefined)
});

export const withAuth = (reqBuilder) => reqBuilder.set('Authorization', 'Bearer ok');
