-- title: Best-selling products
-- question: Which products bring in the most money after returns?
-- skills: aggregate first then join, dimension lookup, net vs gross revenue

WITH by_product AS (              -- aggregate 1M rows down to ~4,700 products first...
    SELECT
        stock_code,
        sum(revenue)                                         AS net_revenue,
        sum(quantity)                                        AS net_units,
        count(DISTINCT invoice) FILTER (WHERE NOT is_return) AS orders
    FROM sales
    GROUP BY stock_code
)
SELECT                            -- ...then join the small result to the product names
    b.stock_code,
    p.description                                  AS product,
    round(b.net_revenue)                           AS net_revenue,
    b.net_units,
    b.orders,
    round(b.net_revenue / nullif(b.net_units, 0), 2) AS avg_unit_price
FROM by_product b
LEFT JOIN products p USING (stock_code)
ORDER BY b.net_revenue DESC
LIMIT 15;
