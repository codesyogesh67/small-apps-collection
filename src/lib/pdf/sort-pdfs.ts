const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function parseDate(filename: string): Date | null {
  const base = filename.replace(/\.pdf$/i, "").trim();

  const match = base.match(/^([A-Za-z]{3})\s*(\d{1,2})-(\d{4})/i);
  if (!match) return null;

  const [, month, day, year] = match;

  const monthIndex = MONTH_MAP[month.toLowerCase()];
  if (monthIndex === undefined) return null;

  const date = new Date(Number(year), monthIndex, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sortPdfFilesByDate(
  input: File[] | FileList | null | undefined,
  order: "asc" | "desc" = "asc"
): File[] {
  const files = input ? Array.from(input) : [];

  return files.sort((a, b) => {
    const aDate = parseDate(a.name);
    const bDate = parseDate(b.name);

    if (!aDate && !bDate) return a.name.localeCompare(b.name);
    if (!aDate) return 1;
    if (!bDate) return -1;

    return order === "asc"
      ? aDate.getTime() - bDate.getTime()
      : bDate.getTime() - aDate.getTime();
  });
}
