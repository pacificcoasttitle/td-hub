export function getMonthRange(monthParam?: string | null, yearParam?: string | null) {
  const now = new Date();
  const month = monthParam ? Number(monthParam) : now.getMonth() + 1;
  const year = yearParam ? Number(yearParam) : now.getFullYear();

  if (isNaN(month) || month < 1 || month > 12 || isNaN(year) || year < 2020) {
    return {
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }

  return {
    month,
    year,
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  };
}
