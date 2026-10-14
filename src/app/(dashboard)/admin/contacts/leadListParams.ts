import { LEAD_STATUSES } from "./leadStatus";

export const LEAD_LIST_DRIP_FILTERS = ["ACTIVE", "PAUSED", "COMPLETED", "EXITED", "NONE"] as const;
export const LEAD_LIST_SORT_KEYS = ["name", "status", "source", "adCampaign", "drip", "tags", "added"] as const;

export type LeadListSortKey = (typeof LEAD_LIST_SORT_KEYS)[number];
export type LeadListSort = { key: LeadListSortKey; dir: 1 | -1 };

export interface LeadListUrlState {
  search: string;
  statusFilter: string;
  sourceFilter: string;
  dripFilter: string;
  tagFilter: string[];
  sort: LeadListSort | null;
  showExcluded: boolean;
}

export interface LeadListParamOptions {
  sources: readonly string[];
  campaignNames: readonly string[];
  tags: readonly string[];
}

type SearchParamsReader = Pick<URLSearchParams, "get" | "getAll" | "toString">;

const MANAGED_PARAMS = [
  "q",
  "status",
  "source",
  "drip",
  "tag",
  "sort",
  "dir",
  "showExcluded",
] as const;

function allowedValue(value: string | null, allowed: readonly string[]): string {
  return value !== null && allowed.includes(value) ? value : "ALL";
}

function isSortKey(value: string | null): value is LeadListSortKey {
  return value !== null && (LEAD_LIST_SORT_KEYS as readonly string[]).includes(value);
}

export function parseLeadListParams(
  params: SearchParamsReader,
  options: LeadListParamOptions
): LeadListUrlState {
  const rawSearch = params.get("q") ?? "";
  const search = rawSearch.trim() ? rawSearch : "";
  const statusFilter = allowedValue(params.get("status"), LEAD_STATUSES);
  const sourceFilter = allowedValue(params.get("source"), options.sources);
  const dripFilter = allowedValue(
    params.get("drip"),
    [...LEAD_LIST_DRIP_FILTERS, ...options.campaignNames]
  );
  const allowedTags = new Set(options.tags);
  const tagFilter = Array.from(new Set(params.getAll("tag").filter((tag) => allowedTags.has(tag))));
  const sortKey = params.get("sort");
  const sortDirection = params.get("dir");
  const sort = isSortKey(sortKey) && (sortDirection === "asc" || sortDirection === "desc")
    ? { key: sortKey, dir: sortDirection === "asc" ? 1 as const : -1 as const }
    : null;

  const showExcluded = params.get("showExcluded") === "true";

  return { search, statusFilter, sourceFilter, dripFilter, tagFilter, sort, showExcluded };
}

export function serializeLeadListParams(
  state: LeadListUrlState,
  currentParams?: SearchParamsReader
): URLSearchParams {
  const params = new URLSearchParams(currentParams?.toString());
  for (const name of MANAGED_PARAMS) params.delete(name);

  if (state.search.trim()) params.set("q", state.search);
  if (state.statusFilter !== "ALL") params.set("status", state.statusFilter);
  if (state.sourceFilter !== "ALL") params.set("source", state.sourceFilter);
  if (state.dripFilter !== "ALL") params.set("drip", state.dripFilter);
  for (const tag of state.tagFilter) params.append("tag", tag);
  if (state.sort) {
    params.set("sort", state.sort.key);
    params.set("dir", state.sort.dir === 1 ? "asc" : "desc");
  }
  if (state.showExcluded) params.set("showExcluded", "true");

  return params;
}
