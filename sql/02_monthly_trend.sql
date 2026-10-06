-- title: Monthly revenue trend
-- question: Is the shop growing, and how seasonal are sales?
-- skills: CTEs, date_trunc, self-join on dates for growth rates

WITH monthly AS (
    SELECT
        date_trunc('month', invoice_ts)::DATE                 AS month,
        sum(revenue)                                          AS revenue,
        count(DISTINCT invoice) FILTER (WHERE NOT is_return)  AS orders,
        count(DISTINCT customer_id)                           AS customers
    FROM sales
    GROUP BY 1
)
SELECT
    m.month,
    round(m.revenue)                                    AS revenue,
    m.orders,
    m.customers,
    -- joining on the date (not LAG) stays correct even if a month is missing
    round(100 * (m.revenue / prev.revenue - 1), 1)      AS mom_growth_pct,
    round(100 * (m.revenue / last_year.revenue - 1), 1) AS yoy_growth_pct,
    -- the data stops on 9 Dec 2011, so that month is incomplete
    m.month = (SELECT date_trunc('month', max(invoice_ts)) FROM sales_all)
                                                        AS is_partial
FROM monthly m
LEFT JOIN monthly prev      ON prev.month      = m.month - INTERVAL 1 MONTH
LEFT JOIN monthly last_year ON last_year.month = m.month - INTERVAL 12 MONTH
ORDER BY m.month;
