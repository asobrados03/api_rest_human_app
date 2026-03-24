/**
 * Módulo testeado: middlewares/uploadProfile_Pic.js
 * Dependencias mockeadas: multer, fs/promises, sharp y utils/pino.js porque acceden a I/O y librerías externas.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStat = jest.fn();
const mockWriteFile = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();

let multerCallback = null;
const mockMulterInstance = {
  single: jest.fn(() => (req, res, cb) => {
    cb(multerCallback);
  })
};

const mockMulter = jest.fn(() => mockMulterInstance);
mockMulter.diskStorage = jest.fn(() => ({}));
mockMulter.MulterError = class MulterError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
};

const sharpPipeline = {
  metadata: jest.fn(),
  resize: jest.fn().mockReturnThis(),
  png: jest.fn().mockReturnThis(),
  jpeg: jest.fn().mockReturnThis(),
  toBuffer: jest.fn()
};
const mockSharp = jest.fn(() => sharpPipeline);

jest.unstable_mockModule('multer', () => ({ default: mockMulter }));
jest.unstable_mockModule('fs/promises', () => ({
  default: { stat: mockStat, writeFile: mockWriteFile },
  stat: mockStat,
  writeFile: mockWriteFile
}));
jest.unstable_mockModule('sharp', () => ({ default: mockSharp }));
jest.unstable_mockModule('../../utils/pino.js', () => ({
  default: { info: mockLoggerInfo, error: mockLoggerError }
}));

const { compressImageIfNeeded, handleProfilePicUpload } = await import('../../middlewares/uploadProfile_Pic.js');

describe('Unit - uploadProfile_Pic middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    multerCallback = null;
    sharpPipeline.metadata.mockResolvedValue({ width: 1200 });
    sharpPipeline.toBuffer.mockResolvedValue(Buffer.from('compressed-image'));
  });

  describe('compressImageIfNeeded', () => {
    it('llama next sin comprimir cuando req.file no existe', async () => {
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await compressImageIfNeeded(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(mockStat).not.toHaveBeenCalled();
    });

    it('llama next sin comprimir cuando el archivo pesa <= 1MB', async () => {
      const req = { file: { originalname: 'avatar.jpg', filename: 'avatar.jpg' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      mockStat.mockResolvedValue({ size: 500_000 });

      await compressImageIfNeeded(req, res, next);

      expect(mockStat).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('comprime png mayores a 1MB y persiste el buffer', async () => {
      const req = { file: { originalname: 'avatar.png', filename: 'avatar.png' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      mockStat
        .mockResolvedValueOnce({ size: 2_000_000 })
        .mockResolvedValueOnce({ size: 800_000 });

      await compressImageIfNeeded(req, res, next);

      expect(sharpPipeline.png).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('responde 500 cuando ocurre error al leer/comprimir', async () => {
      const req = { file: { originalname: 'avatar.jpg', filename: 'avatar.jpg' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      mockStat.mockRejectedValue(new Error('disk error'));

      await compressImageIfNeeded(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error al comprimir imagen' });
      expect(mockLoggerError).toHaveBeenCalled();
    });
  });

  describe('handleProfilePicUpload', () => {
    it('llama next cuando multer no retorna error', () => {
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      multerCallback = null;
      handleProfilePicUpload(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('responde 413 cuando multer supera tamaño máximo', () => {
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      multerCallback = new mockMulter.MulterError('LIMIT_FILE_SIZE');
      handleProfilePicUpload(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({ error: 'El archivo es demasiado grande. Máximo 10 MB.' });
    });

    it('responde 400 cuando multer retorna error genérico', () => {
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      multerCallback = new Error('invalid mime');
      handleProfilePicUpload(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error al subir la imagen' });
      expect(mockLoggerError).toHaveBeenCalled();
    });
  });
});
