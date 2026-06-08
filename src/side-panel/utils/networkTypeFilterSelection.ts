import type { NetworkRequestTypeFilter } from "../../shared/types";

export function resolveNetworkTypeFilterSelection(
  currentFilters: NetworkRequestTypeFilter[],
  filter: NetworkRequestTypeFilter,
  checked: boolean,
): NetworkRequestTypeFilter[] | undefined {
  if (filter === "all") {
    if (!checked) {
      return undefined;
    }

    return ["all"];
  }

  // 类型集不能为空；取消最后一个具体类型时回退到 All，保持与旧版“采集全部”语义一致。
  const withoutAll = currentFilters.filter((item) => item !== "all");
  const nextFilters = checked ? [...withoutAll, filter] : withoutAll.filter((item) => item !== filter);
  return nextFilters.length > 0 ? Array.from(new Set(nextFilters)) : ["all"];
}
