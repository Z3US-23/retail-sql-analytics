"""Build the clean Parquet files the dashboard reads.

Run once from the project folder:
    python etl/build_data.py

Steps:
  1. Download the UCI "Online Retail II" Excel file (if not already in raw/).
  2. Load both sheets into DuckDB.
  3. Run etl/clean.sql to build the `sales` and `products` tables.
  4. Save them to data/*.parquet and print a cleaning report.
"""

import io
import json
import urllib.request
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW_XLSX = ROOT / "raw" / "online_retail_II.xlsx"
DATA_DIR = ROOT / "data"
CLEAN_SQL = ROOT / "etl" / "clean.sql"
SOURCE_URL = "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip"
SHEETS = ["Year 2009-2010", "Year 2010-2011"]


def download_raw() -> None:
    if RAW_XLSX.exists():
        return
    print("Downloading dataset from UCI ...")
    RAW_XLSX.parent.mkdir(exist_ok=True)
    with urllib.request.urlopen(SOURCE_URL, timeout=300) as resp:
        archive = zipfile.ZipFile(io.BytesIO(resp.read()))
    archive.extract("online_retail_II.xlsx", RAW_XLSX.parent)


def load_raw(con: duckdb.DuckDBPyConnection) -> None:
    con.sql("INSTALL excel; LOAD excel;")
    parts = [
        f"SELECT {i} AS sheet, * FROM read_xlsx('{RAW_XLSX.as_posix()}', "
        f"sheet='{name}', all_varchar=true)"
        for i, name in enumerate(SHEETS, start=1)
    ]
    con.sql("CREATE OR REPLACE TABLE raw_lines AS " + " UNION ALL ".join(parts))


def count(con: duckdb.DuckDBPyConnection, table: str) -> int:
    return con.sql(f"SELECT count(*) FROM {table}").fetchone()[0]


def main() -> None:
    download_raw()
    con = duckdb.connect()
    print("Loading Excel sheets (takes ~30 s) ...")
    load_raw(con)
    con.execute(CLEAN_SQL.read_text(encoding="utf-8"))

    steps = ["raw_lines", "no_overlap", "products_only", "sales"]
    rows = {t: count(con, t) for t in steps}
    print("\nCleaning report")
    print(f"  raw rows                  {rows['raw_lines']:>10,}")
    print(f"  − sheet overlap           {rows['raw_lines'] - rows['no_overlap']:>10,}")
    print(f"  − non-product / bad rows  {rows['no_overlap'] - rows['products_only']:>10,}")
    print(f"  − exact duplicates        {rows['products_only'] - rows['sales']:>10,}")
    print(f"  = clean sales lines       {rows['sales']:>10,}")
    print(f"  products                  {count(con, 'products'):>10,}")

    DATA_DIR.mkdir(exist_ok=True)
    for table in ["sales", "products"]:
        out = DATA_DIR / f"{table}.parquet"
        con.sql(f"COPY {table} TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
        print(f"  wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB)")

    # The website shows this as the "data cleaning" funnel.
    report = {
        "raw_rows": rows["raw_lines"],
        "sheet_overlap": rows["raw_lines"] - rows["no_overlap"],
        "non_product_or_invalid": rows["no_overlap"] - rows["products_only"],
        "exact_duplicates": rows["products_only"] - rows["sales"],
        "clean_rows": rows["sales"],
        "products": count(con, "products"),
    }
    (DATA_DIR / "cleaning_report.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
