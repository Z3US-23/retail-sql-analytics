-- title: Customer concentration (Lorenz curve)
-- question: How unequal is spending? Do a few customers carry the shop?
-- skills: running totals with window frames, Gini coefficient in pure SQL

WITH customer_revenue AS (
    SELECT customer_id, sum(revenue) AS revenue
    FROM sales
    WHERE customer_id IS NOT NULL
    GROUP BY customer_id
    HAVING sum(revenue) > 0
),
ranked AS (                       -- smallest spender first, as in a Lorenz curve
    SELECT
        revenue,
        row_number() OVER (ORDER BY revenue)  AS rn,
        count(*)     OVER ()                  AS n,
        sum(revenue) OVER (ORDER BY revenue ROWS UNBOUNDED PRECEDING)
          / sum(revenue) OVER ()              AS cum_share
    FROM customer_revenue
),
gini AS (                         -- G = 2 * sum(i * x_i) / (n * sum(x_i)) - (n + 1) / n
    SELECT 2 * sum(rn * revenue) / (max(n) * sum(revenue))
           - (max(n) + 1) / max(n) AS gini
    FROM ranked
),
top_shares AS (                   -- exact revenue share of the biggest 1%, 10%, 20%
    SELECT
        100 * sum(revenue) FILTER (WHERE rn > n * 0.99) / sum(revenue) AS top1,
        100 * sum(revenue) FILTER (WHERE rn > n * 0.90) / sum(revenue) AS top10,
        100 * sum(revenue) FILTER (WHERE rn > n * 0.80) / sum(revenue) AS top20
    FROM ranked
)
SELECT
    round(100.0 * rn / n, 2)      AS pct_customers,
    round(100 * cum_share, 2)     AS pct_revenue,
    round(gini.gini, 3)           AS gini,
    n                             AS customers,
    round(t.top1, 1)              AS top1_pct,
    round(t.top10, 1)             AS top10_pct,
    round(t.top20, 1)             AS top20_pct
FROM ranked, gini, top_shares t
WHERE rn % greatest(n // 200, 1) = 0 OR rn = n     -- ~200 points is enough to draw
ORDER BY rn;
