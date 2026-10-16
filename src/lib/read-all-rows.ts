type Page<T> = { data: T[] | null; error: unknown };

/** The caller supplies a fresh, deterministically ordered query for each page. */
export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = 500,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error("Invalid page size");
  const rows: T[] = [];
  for (;;) {
    const result = await page(rows.length, rows.length + pageSize - 1);
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Missing query data");
    if (!result.data.length) return rows;
    rows.push(...result.data);
    // Stop only on an empty page: a project may cap responses below pageSize.
  }
}
