-- ============================================================
-- clean.sql — turn the raw Excel rows into two clean tables
--
-- Input : raw_lines  (every row of both Excel sheets, as text)
-- Output: sales      (one row per invoice line, products only)
--         products   (one row per stock code, with a clean name)
--
-- Every rule below was found by exploring the raw data first.
-- The counts in the comments are rows removed by that rule.
-- ============================================================

-- 1. Give every column a proper type.
--    Excel stores dates as "days since 1899-12-30", so we convert.
CREATE OR REPLACE TABLE typed AS
SELECT
    sheet,
    trim(Invoice)                                    AS invoice,
    upper(trim(StockCode))                           AS stock_code,
    trim(Description)                                AS description,
    Quantity::INTEGER                                AS quantity,
    TIMESTAMP '1899-12-30'
      + to_milliseconds(round(InvoiceDate::DOUBLE * 86400000)::BIGINT)
                                                     AS invoice_ts,
    round(Price::DOUBLE, 2)                          AS unit_price,
    "Customer ID"::INTEGER                           AS customer_id,
    CASE Country                                     -- tidy country names
        WHEN 'EIRE' THEN 'Ireland'
        WHEN 'RSA'  THEN 'South Africa'
        WHEN 'USA'  THEN 'United States'
        ELSE Country
    END                                              AS country
FROM raw_lines;

-- 2. The two sheets overlap: sheet 1 runs to 9 Dec 2010, but sheet 2
--    starts on 1 Dec 2010 and repeats those rows exactly.  (−22,523)
CREATE OR REPLACE TABLE no_overlap AS
SELECT * EXCLUDE (sheet)
FROM typed
WHERE NOT (sheet = 1 AND invoice_ts >= TIMESTAMP '2010-12-01');

-- 3. Keep real product lines only.
--    Product codes start with five digits (e.g. 85123A).  Everything
--    else is postage, bank charges, Amazon fees, manual adjustments,
--    samples or test items, which are not sales of goods.
--    Also drop zero/negative prices and negative quantities on normal
--    invoices: those are stock write-offs ("damaged", "missing").
CREATE OR REPLACE TABLE products_only AS
SELECT *
FROM no_overlap
WHERE regexp_matches(stock_code, '^[0-9]{5}')
  AND unit_price > 0
  AND (quantity > 0 OR invoice LIKE 'C%');

-- 4. Remove exact duplicate lines (same invoice, product, quantity,
--    price, time and customer), which are double scans.
CREATE OR REPLACE TABLE sales AS
SELECT DISTINCT
    invoice,
    invoice_ts,
    customer_id,
    country,
    stock_code,
    quantity,
    unit_price,
    round(quantity * unit_price, 2)  AS revenue,
    invoice LIKE 'C%'                AS is_return   -- 'C' = cancelled order
FROM products_only
ORDER BY invoice_ts, invoice, stock_code;

-- 5. One clean name per product: the description used most often.
CREATE OR REPLACE TABLE products AS
SELECT
    stock_code,
    mode(description) AS description
FROM products_only
WHERE description IS NOT NULL
  AND stock_code IN (SELECT stock_code FROM sales)
GROUP BY stock_code
ORDER BY stock_code;
