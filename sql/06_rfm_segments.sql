-- title: RFM customer segments
-- question: Who are our best customers, and who is slipping away?
-- skills: multi-step CTEs, NTILE scoring, CASE segmentation rules

WITH snapshot AS (                -- "today" = the day after the last sale
    SELECT max(invoice_ts)::DATE + 1 AS day FROM sales
),
customers AS (
    SELECT
        customer_id,
        (SELECT day FROM snapshot) - max(invoice_ts)::DATE  AS recency_days,
        count(DISTINCT invoice)                             AS frequency,
        sum(revenue)                                        AS monetary
    FROM sales
    WHERE customer_id IS NOT NULL AND NOT is_return
    GROUP BY customer_id
),
scored AS (                       -- 1 = worst fifth, 5 = best fifth
    SELECT *,
        ntile(5) OVER (ORDER BY recency_days DESC, customer_id) AS r,
        ntile(5) OVER (ORDER BY frequency, monetary)             AS f,
        ntile(5) OVER (ORDER BY monetary, customer_id)           AS m
    FROM customers
),
segmented AS (
    SELECT *,
        CASE
            WHEN r >= 4 AND f >= 4 THEN 'Champions'
            WHEN r >= 3 AND f >= 3 THEN 'Loyal'
            WHEN r >= 4            THEN 'New & promising'
            WHEN r <= 2 AND f >= 4 THEN 'Can''t lose them'
            WHEN r <= 2 AND f >= 2 THEN 'At risk'
            WHEN r = 3             THEN 'Needs attention'
            ELSE                        'Hibernating'
        END AS segment
    FROM scored
)
SELECT
    segment,
    count(*)                                                     AS customers,
    round(100 * count(*) / sum(count(*)) OVER (), 1)             AS pct_customers,
    round(sum(monetary))                                         AS revenue,
    round(100 * sum(monetary) / sum(sum(monetary)) OVER (), 1)   AS pct_revenue,
    round(avg(recency_days))                                     AS avg_days_since_order,
    round(avg(frequency), 1)                                     AS avg_orders,
    round(avg(monetary))                                         AS avg_spend
FROM segmented
GROUP BY segment
ORDER BY revenue DESC;
