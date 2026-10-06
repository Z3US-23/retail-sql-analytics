-- title: Headline numbers
-- question: How big is the business in the selected period?
-- skills: aggregate FILTER clauses, COUNT DISTINCT, NULL-safe division

SELECT
    round(sum(revenue))                                         AS net_revenue,
    count(DISTINCT invoice) FILTER (WHERE NOT is_return)        AS orders,
    count(DISTINCT customer_id)                                 AS customers,
    round(
        sum(revenue) FILTER (WHERE NOT is_return)
        / nullif(count(DISTINCT invoice) FILTER (WHERE NOT is_return), 0)
    , 2)                                                        AS avg_order_value,
    sum(quantity) FILTER (WHERE NOT is_return)                  AS units_sold,
    round(100 * -sum(revenue) FILTER (WHERE is_return)
        / nullif(sum(revenue) FILTER (WHERE NOT is_return), 0)
    , 2)                                                        AS return_rate_pct,
    count(DISTINCT stock_code)                                  AS products_sold,
    count(DISTINCT country)                                     AS countries
FROM sales;
