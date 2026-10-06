-- title: Revenue by country
-- question: Which markets matter, and do overseas customers buy differently?
-- skills: GROUP BY, window functions over aggregates (share of total, RANK)

SELECT
    country,
    round(sum(revenue))                                         AS revenue,
    round(100 * sum(revenue) / sum(sum(revenue)) OVER (), 2)    AS share_pct,
    count(DISTINCT customer_id)                                 AS customers,
    count(DISTINCT invoice) FILTER (WHERE NOT is_return)        AS orders,
    round(
        sum(revenue) FILTER (WHERE NOT is_return)
        / nullif(count(DISTINCT invoice) FILTER (WHERE NOT is_return), 0)
    )                                                           AS avg_order_value,
    rank() OVER (ORDER BY sum(revenue) DESC)                    AS revenue_rank
FROM sales
GROUP BY country
HAVING sum(revenue) > 0
ORDER BY revenue DESC;
