"""Run every analysis query in sql/ against the Parquet files.

    python etl/run_queries.py          # run all queries, print a preview
    python etl/run_queries.py 06       # run only files starting with 06

The dashboard runs the exact same .sql files in the browser, so this
script doubles as a test: GitHub Actions runs it on every push and the
build fails if any query breaks.
"""

import sys
import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SQL_DIR = ROOT / "sql"


def connect() -> duckdb.DuckDBPyConnection:
    """Same setup as the website: full table + a `sales` view the queries use."""
    con = duckdb.connect()
    con.sql(f"CREATE TABLE sales_all AS SELECT * FROM '{(DATA / 'sales.parquet').as_posix()}'")
    con.sql(f"CREATE TABLE products  AS SELECT * FROM '{(DATA / 'products.parquet').as_posix()}'")
    con.sql("CREATE VIEW sales AS SELECT * FROM sales_all")   # the site adds filters here
    return con


def main() -> None:
    prefix = sys.argv[1] if len(sys.argv) > 1 else ""
    con = connect()
    files = sorted(SQL_DIR.glob(f"{prefix}*.sql"))
    if not files:
        sys.exit(f"No .sql files match '{prefix}'")

    for path in files:
        start = time.perf_counter()
        result = con.sql(path.read_text(encoding="utf-8"))
        df = result.df()
        ms = (time.perf_counter() - start) * 1000
        print(f"\n=== {path.name}  ({len(df):,} rows, {ms:.0f} ms)")
        print(df.head(12).to_string(index=False, max_colwidth=36))
    print(f"\nAll {len(files)} queries ran successfully.")


if __name__ == "__main__":
    main()
