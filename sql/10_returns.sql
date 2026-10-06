-- title: Products with the highest return rates
-- question: Which popular products come back most often?
-- skills: conditional aggregation, HAVING-style thresholds, COALESCE

WITH by_product AS (
    SELECT
        stock_code,
        sum(revenue)  FILTER (WHERE NOT is_return)            AS sold_value,
        -sum(revenue) FILTER (WHERE is_return)                AS returned_value,
        count(DISTINCT invoice) FILTER (WHERE NOT is_return)  AS orders
    FROM sales
    GROUP BY stock_code
)
SELECT
    b.stock_code,
    p.description                                                 AS product,
    round(b.sold_value)                                           AS sold_value,
    round(coalesce(b.returned_value, 0))                          AS returned_value,
    round(100 * coalesce(b.returned_value, 0) / b.sold_value, 1)  AS return_rate_pct,
    b.orders
FROM by_product b
LEFT JOIN products p USING (stock_code)
WHERE b.orders >= 100                -- ignore rarely sold items
  AND b.sold_value > 0
ORDER BY return_rate_pct DESC
LIMIT 15;
