import { brand } from "@/config/brand";

export function buildSalesExportFilename(date: Date): string {
  return `${brand.ids.salesExportFilePrefix}-${date.toISOString().slice(0, 10)}.csv`;
}
