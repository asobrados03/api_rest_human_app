/**
 * Módulo testeado: middlewares/uploadDocument.js
 * Dependencias mockeadas: multer y fs-extra porque la unidad depende de configuración de upload y filesystem externo.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import path from 'path';

const mockEnsureDir = jest.fn();
let capturedStorageConfig;
let capturedMulterConfig;

const mockMulter = jest.fn((config) => {
  capturedMulterConfig = config;
  return { middleware: 'upload-mobile-document' };
});
mockMulter.diskStorage = jest.fn((config) => {
  capturedStorageConfig = config;
  return { storage: true };
});

jest.unstable_mockModule('multer', () => ({ default: mockMulter }));
jest.unstable_mockModule('fs-extra', () => ({ default: { ensureDir: mockEnsureDir } }));

const { default: uploadMobileDocument, UPLOAD_DOC_PATH } = await import('../../middlewares/uploadDocument.js');

describe('Unit - uploadDocument middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('configuración de multer', () => {
    it('exporta instancia de upload configurada', () => {
      expect(uploadMobileDocument).toEqual({ middleware: 'upload-mobile-document' });
      expect(capturedMulterConfig).toBeDefined();
      expect(capturedMulterConfig.limits).toEqual({
        fileSize: 10 * 1024 * 1024,
        files: 1
      });
    });

    it('usa ruta local de documentos fuera de producción', () => {
      expect(UPLOAD_DOC_PATH).toBe(path.join(process.cwd(), 'pictures', 'document'));
    });
  });

  describe('storage.destination', () => {
    it('crea directorio usando customer_id del body cuando existe', async () => {
      const req = { body: { customer_id: 77 }, user_payload: { id: 12 } };
      const cb = jest.fn();

      await capturedStorageConfig.destination(req, {}, cb);

      expect(mockEnsureDir).toHaveBeenCalledWith(path.join(UPLOAD_DOC_PATH, '77'));
      expect(cb).toHaveBeenCalledWith(null, path.join(UPLOAD_DOC_PATH, '77'));
    });

    it('usa req.user_payload.id cuando customer_id no viene en body', async () => {
      const req = { body: {}, user_payload: { id: 12 } };
      const cb = jest.fn();

      await capturedStorageConfig.destination(req, {}, cb);

      expect(mockEnsureDir).toHaveBeenCalledWith(path.join(UPLOAD_DOC_PATH, '12'));
      expect(cb).toHaveBeenCalledWith(null, path.join(UPLOAD_DOC_PATH, '12'));
    });

    it('propaga error al callback cuando ensureDir falla', async () => {
      const req = { body: { customer_id: 9 }, user_payload: { id: 12 } };
      const cb = jest.fn();
      const err = new Error('disk error');
      mockEnsureDir.mockRejectedValue(err);

      await capturedStorageConfig.destination(req, {}, cb);

      expect(cb).toHaveBeenCalledWith(err);
    });
  });

  describe('storage.filename', () => {
    it('genera nombre único preservando extensión', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      const cb = jest.fn();

      capturedStorageConfig.filename({}, { originalname: 'informe final.pdf' }, cb);

      expect(cb).toHaveBeenCalledWith(null, 'informe final-1700000000000.pdf');
    });
  });

  describe('fileFilter', () => {
    it('acepta archivos con mime y extensión permitidos', () => {
      const cb = jest.fn();
      const file = { mimetype: 'application/pdf', originalname: 'contrato.PDF' };

      capturedMulterConfig.fileFilter({}, file, cb);

      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('rechaza archivos no permitidos', () => {
      const cb = jest.fn();
      const file = { mimetype: 'text/plain', originalname: 'nota.txt' };

      capturedMulterConfig.fileFilter({}, file, cb);

      expect(cb).toHaveBeenCalledWith(expect.any(Error), false);
      expect(cb.mock.calls[0][0].message).toContain('Tipo de archivo no soportado');
    });
  });
});
