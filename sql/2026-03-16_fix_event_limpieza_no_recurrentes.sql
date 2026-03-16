DROP EVENT IF EXISTS `limpiar_productos_consumidos`;

CREATE EVENT `limpiar_productos_consumidos`
ON SCHEDULE EVERY 1 DAY
STARTS '2026-03-06 00:00:00'
ON COMPLETION PRESERVE
ENABLE
DO
UPDATE active_products ap
JOIN products p ON ap.product_id = p.product_id
SET ap.deleted_at = NOW()
WHERE
  ap.deleted_at IS NULL
  AND (
    (
      p.type_of_product IN ('multi_sessions', 'single_session')
      AND (
        SELECT COUNT(*)
        FROM bookings b
        WHERE b.active_product_id = ap.active_product_id
          AND b.status != 'canceled'
          AND b.start_date < NOW()
      ) >= p.total_session
    )
    OR
    (
      p.type_of_product IN ('multi_sessions', 'single_session')
      AND ap.expiry_date IS NOT NULL
      AND ap.expiry_date < CURRENT_DATE()
    )
  );
