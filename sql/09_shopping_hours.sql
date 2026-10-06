-- title: When do customers order?
-- question: Which days and hours are busiest?
-- skills: date-part functions, GROUP BY ALL, building a heatmap grid

SELECT
    isodow(invoice_ts)               AS day_number,   -- 1 = Monday
    strftime(invoice_ts, '%a')       AS day,
    hour(invoice_ts)                 AS hour,
    count(DISTINCT invoice)          AS orders,
    round(sum(revenue))              AS revenue
FROM sales
WHERE NOT is_return
GROUP BY ALL
ORDER BY day_number, hour;
