/**
 * Módulo testeado: services/service-products.service.js
 * Dependencias mockeadas: repositories/service-products.repository.js y utils/pino.js por acceso a DB/log externo.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockRepo = {
  getServices: jest.fn(),
  getProductsByServiceId: jest.fn(),
  getActiveProductsByUserId: jest.fn(),
  getProductById: jest.fn(),
  findActiveProduct: jest.fn(),
  updateActiveProductExpiry: jest.fn(),
  getCouponByCode: jest.fn(),
  countInvoicesByPrefix: jest.fn(),
  getLatestWalletBalance: jest.fn(),
  createWalletTransaction: jest.fn(),
  createActiveProduct: jest.fn(),
  createSubscription: jest.fn(),
  cancelActiveProduct: jest.fn(),
  cancelSubscription: jest.fn(),
  getActiveProductDetail: jest.fn(),
  getProductServices: jest.fn(),
  getProductDetailById: jest.fn()
};

jest.unstable_mockModule('../../repositories/service-products.repository.js', () => mockRepo);
jest.unstable_mockModule('../../utils/pino.js', () => ({ default: { info: jest.fn(), warn: jest.fn() } }));

const {
  listUserProducts,
  assignProduct,
  getProductDetail
} = await import('../../services/service-products.service.js');

describe('Unit - service-products service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listUserProducts', () => {
    it('agrupa productos por id y concatena service_ids', async () => {
      mockRepo.getActiveProductsByUserId.mockResolvedValue([
        { id: 10, name: 'A', description: 'd', price: 1, image: null, centro: 'x', type_of_product: 'single', stripe_subscription_id: null, stripe_payment_intent_id: null, service_id: 5 },
        { id: 10, name: 'A', description: 'd', price: 1, image: null, centro: 'x', type_of_product: 'single', stripe_subscription_id: null, stripe_payment_intent_id: null, service_id: 6 }
      ]);

      const rows = await listUserProducts({}, 3);

      expect(rows).toEqual([
        expect.objectContaining({ id: 10, service_ids: [5, 6] })
      ]);
      expect(mockRepo.getActiveProductsByUserId).toHaveBeenCalledWith({}, 3);
    });
  });

  describe('assignProduct', () => {
    it('lanza 404 cuando el producto no existe', async () => {
      mockRepo.getProductById.mockResolvedValue(null);

      await expect(assignProduct({}, { user_id: 1, product_id: 2, payment_method: 'card' }))
        .rejects.toMatchObject({ status: 404, message: 'Producto no encontrado' });
    });

    it('lanza 409 cuando ya existe activo sin renovación', async () => {
      mockRepo.getProductById.mockResolvedValue({ sell_price: 20, valid_due: 30, type_of_product: 'single' });
      mockRepo.findActiveProduct.mockResolvedValue({ active_product_id: 77 });

      await expect(assignProduct({}, { user_id: 1, product_id: 2, payment_method: 'card' }))
        .rejects.toMatchObject({ status: 409, message: 'El producto ya está activo y no es una renovación' });
    });

    it('renueva producto cuando existe y llega subscription_id', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-01T00:00:00Z'));
      mockRepo.getProductById.mockResolvedValue({ valid_due: 30 });
      mockRepo.findActiveProduct.mockResolvedValue({ active_product_id: 77, expiry_date: '2026-03-15T00:00:00Z' });

      const result = await assignProduct({}, {
        user_id: 1,
        product_id: 2,
        payment_method: 'card',
        subscription_id: 'sub_1'
      });

      expect(mockRepo.updateActiveProductExpiry).toHaveBeenCalledWith({}, 77, expect.any(Date));
      expect(result).toEqual({ assigned_id: 77, action: 'renewed' });
      jest.useRealTimers();
    });

    it('lanza 402 si pago cash y no hay saldo suficiente', async () => {
      mockRepo.getProductById.mockResolvedValue({ sell_price: 100, valid_due: 30, centro: 'a', type_of_product: 'single' });
      mockRepo.findActiveProduct.mockResolvedValue(null);
      mockRepo.countInvoicesByPrefix.mockResolvedValue(10);
      mockRepo.getLatestWalletBalance.mockResolvedValue(20);

      await expect(assignProduct({}, { user_id: 1, product_id: 2, payment_method: 'cash' }))
        .rejects.toMatchObject({ status: 402, message: 'Saldo insuficiente' });
    });

    it('crea active product y subscription cuando pago cash y producto recurrente', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-03-10T12:00:00Z'));
      mockRepo.getProductById.mockResolvedValue({
        sell_price: 100,
        valid_due: 30,
        centro: 'north',
        type_of_product: 'recurrent'
      });
      mockRepo.findActiveProduct.mockResolvedValue(null);
      mockRepo.countInvoicesByPrefix.mockResolvedValue(3);
      mockRepo.getLatestWalletBalance.mockResolvedValue(200);
      mockRepo.createActiveProduct.mockResolvedValue({ insertId: 55 });

      const result = await assignProduct({}, { user_id: 1, product_id: 2, payment_method: 'cash' });

      expect(mockRepo.createWalletTransaction).toHaveBeenCalled();
      expect(mockRepo.createActiveProduct).toHaveBeenCalledWith({}, expect.objectContaining({
        userId: 1,
        productId: 2,
        paymentMethod: 'cash'
      }));
      expect(mockRepo.createSubscription).toHaveBeenCalledWith({}, expect.objectContaining({ userId: 1 }));
      expect(result).toEqual({ assigned_id: 55, action: 'created' });
      jest.useRealTimers();
    });
  });

  describe('getProductDetail', () => {
    it('lanza 400 si el productId no es entero positivo', async () => {
      await expect(getProductDetail({ getConnection: jest.fn() }, 0)).rejects.toMatchObject({ status: 400 });
    });

    it('lanza 404 si no existe producto', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.getProductDetailById.mockResolvedValue(null);

      await expect(getProductDetail(dbPool, 7)).rejects.toMatchObject({ status: 404 });
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('retorna producto cuando existe', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.getProductDetailById.mockResolvedValue({ id: 7, name: 'Pack' });

      const result = await getProductDetail(dbPool, 7);

      expect(result).toEqual({ id: 7, name: 'Pack' });
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('libera conexión incluso si el repositorio falla', async () => {
      const connection = { release: jest.fn() };
      const dbPool = { getConnection: jest.fn().mockResolvedValue(connection) };
      mockRepo.getProductDetailById.mockRejectedValue(new Error('db read failed'));

      await expect(getProductDetail(dbPool, 7)).rejects.toThrow('db read failed');
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });
});
