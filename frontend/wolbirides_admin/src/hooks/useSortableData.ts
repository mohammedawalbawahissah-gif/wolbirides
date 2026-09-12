import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export function useSortableData<T>(items: T[], initialKey?: keyof T, initialDir: SortDirection = "desc") {
  const [sortKey, setSortKey] = useState<keyof T | null>(initialKey ?? null);
  const [direction, setDirection] = useState<SortDirection>(initialDir);

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    const copy = [...items];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (av == null && bv == null) cmp = 0;
      else if (av == null) cmp = -1;
      else if (bv == null) cmp = 1;
      else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [items, sortKey, direction]);

  function requestSort(key: keyof T) {
    if (sortKey === key) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  return { sorted, sortKey, direction, requestSort };
}
