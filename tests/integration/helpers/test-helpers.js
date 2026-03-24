import { jest } from '@jest/globals';

export const createMockConnection = () => ({
  release: jest.fn(),
  beginTransaction: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  execute: jest.fn()
});

export const createDbModule = (mockGetConnection) => ({
  default: {
    getConnection: mockGetConnection,
    query: jest.fn(),
    execute: jest.fn()
  }
});

export const setupDbConnectionMock = (mockGetConnection, connection = createMockConnection()) => {
  mockGetConnection.mockResolvedValue(connection);
  return connection;
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
  UPLOAD_PATH: '/tmp/profile_pic',
  compressImageIfNeeded: (_req, _res, next) => next(),
  handleProfilePicUpload: (req, _res, next) => {
    req.file = req.file || null;
    next();
  }
});

export const createUploadDocumentModule = () => ({
  __esModule: true,
  default: { single: () => (req, _res, next) => next() }
});

export const createLoggerModule = () => ({
  logActivity: jest.fn().mockResolvedValue(undefined)
});

export const withAuth = (reqBuilder) => reqBuilder.set('Authorization', 'Bearer ok');

export const resetMockObject = (mockObj) => {
  Object.values(mockObj).forEach((value) => {
    if (typeof value === 'function' && 'mockReset' in value) {
      value.mockReset();
    }
  });
};
