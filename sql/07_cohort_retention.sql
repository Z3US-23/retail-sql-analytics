-- title: Cohort retention
-- question: Of customers who first bought in a month, how many come back later?
-- skills: cohort analysis, datediff, FIRST_VALUE window over groups

WITH first_purchase AS (
    SELECT customer_id, min(date_trunc('month', invoice_ts))::DATE AS cohort_month
    FROM sales
    WHERE customer_id IS NOT NULL AND NOT is_return
    GROUP BY customer_id
),
activity AS (                     -- one row per customer per active month
    SELECT DISTINCT
        f.cohort_month,
        s.customer_id,
        datediff('month', f.cohort_month, date_trunc('month', s.invoice_ts)) AS month_number
    FROM sales s
    JOIN first_purchase f USING (customer_id)
    WHERE NOT s.is_return
)
SELECT
    cohort_month,
    month_number,
    count(*)                                                    AS active_customers,
    round(100.0 * count(*) / first_value(count(*)) OVER (
        PARTITION BY cohort_month ORDER BY month_number), 1)    AS retention_pct
FROM activity
GROUP BY cohort_month, month_number
ORDER BY cohort_month, month_number;
