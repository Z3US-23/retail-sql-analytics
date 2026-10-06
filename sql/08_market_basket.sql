-- title: Products bought together
-- question: Which products land in the same basket more often than chance predicts?
-- skills: self-join, market-basket metrics (support, confidence, lift)

WITH baskets AS (                 -- each product once per order
    SELECT DISTINCT invoice, stock_code
    FROM sales
    WHERE NOT is_return
),
total AS (SELECT count(DISTINCT invoice) AS orders FROM baskets),
item_orders AS (
    SELECT stock_code, count(*) AS orders FROM baskets GROUP BY stock_code
),
popular AS (                      -- top 150 items only, to keep the self-join fast
    SELECT stock_code FROM item_orders ORDER BY orders DESC, stock_code LIMIT 150
),
pairs AS (
    SELECT a.stock_code AS item_a, b.stock_code AS item_b, count(*) AS together
    FROM baskets a
    JOIN baskets b
      ON a.invoice = b.invoice
     AND a.stock_code < b.stock_code          -- each pair once, no self-pairs
    WHERE a.stock_code IN (SELECT stock_code FROM popular)
      AND b.stock_code IN (SELECT stock_code FROM popular)
    GROUP BY 1, 2
)
SELECT
    p.item_a,
    p.item_b,
    pa.description                                              AS product_a,
    pb.description                                              AS product_b,
    p.together                                                  AS orders_together,
    round(100.0 * p.together / t.orders, 2)                     AS support_pct,
    round(100.0 * p.together / least(ia.orders, ib.orders), 1)  AS confidence_pct,
    round(p.together * t.orders / (ia.orders * ib.orders)::DOUBLE, 1) AS lift
FROM pairs p
CROSS JOIN total t
JOIN item_orders ia ON ia.stock_code = p.item_a
JOIN item_orders ib ON ib.stock_code = p.item_b
LEFT JOIN products pa ON pa.stock_code = p.item_a
LEFT JOIN products pb ON pb.stock_code = p.item_b
WHERE p.together >= 30
ORDER BY lift DESC, orders_together DESC
LIMIT 25;
