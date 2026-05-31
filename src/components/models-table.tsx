"use client";

import { useMemo, useState } from "react";

const SOURCE_URL = "https://models.dev/api.json";

type Primitive = string | number | boolean | null | undefined;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };
type ApiProvider = {
  id?: string;
  name?: string;
  models?: Record<string, Record<string, JsonValue>>;
  [key: string]: JsonValue;
};
type ApiPayload = Record<string, ApiProvider>;
type SortDirection = "asc" | "desc";
type SortState = {
  key: string;
  direction: SortDirection;
} | null;
type PageSize = (typeof pageSizeOptions)[number];

type ModelRow = {
  rowId: string;
  values: Record<string, string>;
  searchText: string;
};

type PreparedData = {
  columns: string[];
  rows: ModelRow[];
  providerCount: number;
  modelCount: number;
};

const primaryColumns = [
  "provider.name",
  "provider.id",
  "model.name",
  "model.id",
  "model.family",
  "model.release_date",
  "model.last_updated",
  "model.open_weights",
  "model.reasoning",
  "model.tool_call",
  "model.structured_output",
  "model.attachment",
  "model.modalities.input",
  "model.modalities.output",
  "model.limit.context",
  "model.limit.output",
  "model.cost.input",
  "model.cost.output",
  "provider.api",
  "provider.doc",
  "provider.npm",
];

const pageSizeOptions = [100, 250, 500, "all"] as const;

function formatValue(value: JsonValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function flatten(
  value: Record<string, JsonValue>,
  prefix: string,
  target: Record<string, string>,
) {
  for (const [key, child] of Object.entries(value)) {
    if (key === "models") {
      continue;
    }

    const path = `${prefix}.${key}`;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flatten(child as Record<string, JsonValue>, path, target);
    } else {
      target[path] = formatValue(child);
    }
  }
}

function prepareData(payload: ApiPayload): PreparedData {
  const columns = new Set<string>();
  const rows: ModelRow[] = [];
  const providers = Object.values(payload);

  for (const provider of providers) {
    const providerValues: Record<string, string> = {};
    flatten(provider, "provider", providerValues);

    const models = provider.models ?? {};
    for (const model of Object.values(models)) {
      const values = { ...providerValues };
      flatten(model, "model", values);

      for (const key of Object.keys(values)) {
        columns.add(key);
      }

      const rowId = `${values["provider.id"] ?? "provider"}:${values["model.id"] ?? rows.length}`;
      rows.push({
        rowId,
        values,
        searchText: Object.values(values).join(" ").toLowerCase(),
      });
    }
  }

  const orderedColumns = [
    ...primaryColumns.filter((column) => columns.has(column)),
    ...[...columns]
      .filter((column) => !primaryColumns.includes(column))
      .sort((a, b) => a.localeCompare(b)),
  ];

  return {
    columns: orderedColumns,
    rows,
    providerCount: providers.length,
    modelCount: rows.length,
  };
}

function compareValues(a: string, b: string) {
  const aNumber = Number(a);
  const bNumber = Number(b);

  if (a !== "" && b !== "" && !Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
    return aNumber - bNumber;
  }

  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function columnLabel(column: string) {
  return column.replace(/\./g, " / ").replace(/_/g, " ");
}

function nextSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) {
    return { key, direction: "asc" };
  }

  if (current.direction === "asc") {
    return { key, direction: "desc" };
  }

  return null;
}

function parsePageSize(value: string): PageSize {
  return value === "all" ? "all" : (Number(value) as Exclude<PageSize, "all">);
}

export function ModelsTable({
  initialError,
  initialFetchedAt,
  initialPayload,
}: {
  initialError: string | null;
  initialFetchedAt: string | null;
  initialPayload: ApiPayload | null;
}) {
  const [payload, setPayload] = useState<ApiPayload | null>(initialPayload);
  const [error, setError] = useState<string | null>(initialError);
  const [isLoading, setIsLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialFetchedAt);
  const [search, setSearch] = useState("");
  const [columnSearch, setColumnSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [sort, setSort] = useState<SortState>({
    key: "provider.name",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(250);

  async function loadData() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/models", {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Unable to load data");
      }

      setPayload(data);
      setUpdatedAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load data");
    } finally {
      setIsLoading(false);
    }
  }

  const preparedData = useMemo(() => (payload ? prepareData(payload) : null), [payload]);
  const allColumns = useMemo(() => preparedData?.columns ?? [], [preparedData]);
  const visibleColumns = useMemo(
    () => allColumns.filter((column) => !hiddenColumns.has(column)),
    [allColumns, hiddenColumns],
  );
  const matchingColumnOptions = useMemo(() => {
    const normalizedSearch = columnSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return allColumns;
    }

    return allColumns.filter((column) =>
      columnLabel(column).toLowerCase().includes(normalizedSearch),
    );
  }, [allColumns, columnSearch]);

  const filteredRows = useMemo(() => {
    if (!preparedData) {
      return [];
    }

    const normalizedSearch = search.trim().toLowerCase();
    const activeFilters = Object.entries(filters)
      .map(([key, value]) => [key, value.trim().toLowerCase()] as const)
      .filter(([, value]) => value);

    const matchingRows = preparedData.rows.filter((row) => {
      if (normalizedSearch && !row.searchText.includes(normalizedSearch)) {
        return false;
      }

      return activeFilters.every(([key, value]) =>
        (row.values[key] ?? "").toLowerCase().includes(value),
      );
    });

    if (!sort) {
      return matchingRows;
    }

    return [...matchingRows].sort((a, b) => {
      const result = compareValues(a.values[sort.key] ?? "", b.values[sort.key] ?? "");
      return sort.direction === "asc" ? result : -result;
    });
  }, [filters, preparedData, search, sort]);

  const totalPages =
    pageSize === "all" ? 1 : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows =
    pageSize === "all"
      ? filteredRows
      : filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  function showAllColumns() {
    setHiddenColumns(new Set());
  }

  function showPrimaryColumnsOnly() {
    const primaryVisible = new Set(primaryColumns.filter((column) => allColumns.includes(column)));
    const nextHiddenColumns = new Set(
      allColumns.filter((column) => !primaryVisible.has(column)),
    );

    setHiddenColumns(nextHiddenColumns);
    setFilters((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([column]) => !nextHiddenColumns.has(column)),
      ),
    );
    setSort((current) =>
      current && nextHiddenColumns.has(current.key) ? null : current,
    );
    setPage(1);
  }

  function toggleColumn(column: string) {
    const isHidden = hiddenColumns.has(column);

    if (!isHidden && visibleColumns.length <= 1) {
      return;
    }

    setHiddenColumns((current) => {
      const next = new Set(current);

      if (isHidden) {
        next.delete(column);
      } else {
        next.add(column);
      }

      return next;
    });

    if (!isHidden) {
      setFilters((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== column)),
      );
      setSort((current) => (current?.key === column ? null : current));
    }

    setPage(1);
  }

  return (
    <div className="flex min-h-screen flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">models.dev live data</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal text-slate-950">
            Model catalog
          </h1>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
            <a
              className="font-medium text-slate-900 underline decoration-emerald-500 underline-offset-4"
              href={SOURCE_URL}
              rel="noreferrer"
              target="_blank"
            >
              Source JSON
            </a>
            {preparedData ? <span>{preparedData.providerCount} providers</span> : null}
            {preparedData ? <span>{preparedData.modelCount} models</span> : null}
            {preparedData ? (
              <span>
                {visibleColumns.length} of {preparedData.columns.length} columns shown
              </span>
            ) : null}
            {updatedAt ? <span>Fetched {updatedAt}</span> : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            className="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 sm:w-80"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search all fields"
            type="search"
            value={search}
          />
          <button
            className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-950 transition hover:border-slate-400 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isLoading}
            onClick={loadData}
            type="button"
          >
            {isLoading ? "Loading" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <section className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </section>
      ) : null}

      {preparedData ? (
        <details className="rounded-md border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-950 marker:text-slate-500">
            <span>Columns</span>
            <span className="text-xs font-medium text-slate-600">
              {visibleColumns.length} shown / {preparedData.columns.length} total
            </span>
          </summary>
          <div className="border-t border-slate-200 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 sm:max-w-sm"
                onChange={(event) => setColumnSearch(event.target.value)}
                placeholder="Find columns"
                type="search"
                value={columnSearch}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 transition hover:border-slate-400 hover:bg-slate-100"
                  onClick={showAllColumns}
                  type="button"
                >
                  Show all
                </button>
                <button
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 transition hover:border-slate-400 hover:bg-slate-100"
                  onClick={showPrimaryColumnsOnly}
                  type="button"
                >
                  Primary only
                </button>
              </div>
            </div>
            <div className="mt-4 grid max-h-56 grid-cols-1 gap-2 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {matchingColumnOptions.map((column) => {
                const isVisible = !hiddenColumns.has(column);
                const isLastVisible = isVisible && visibleColumns.length <= 1;

                return (
                  <label
                    className="flex min-h-10 items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800"
                    key={column}
                  >
                    <input
                      checked={isVisible}
                      className="mt-0.5 h-4 w-4 accent-emerald-700"
                      disabled={isLastVisible}
                      onChange={() => toggleColumn(column)}
                      type="checkbox"
                    />
                    <span className="break-words capitalize">{columnLabel(column)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </details>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700">
        <div>
          {preparedData ? (
            <span>
              Showing {visibleRows.length} of {filteredRows.length} matching rows
            </span>
          ) : (
            <span>Loading rows</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="font-medium" htmlFor="page-size">
            Rows
          </label>
          <select
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950"
            id="page-size"
            onChange={(event) => {
              setPageSize(parsePageSize(event.target.value));
              setPage(1);
            }}
            value={String(pageSize)}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All" : option}
              </option>
            ))}
          </select>
          <button
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={safePage <= 1 || pageSize === "all"}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            type="button"
          >
            Previous
          </button>
          <span className="min-w-20 text-center">
            {safePage} / {totalPages}
          </span>
          <button
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={safePage >= totalPages || pageSize === "all"}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            type="button"
          >
            Next
          </button>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-100 text-slate-900 shadow-sm">
              <tr>
                {visibleColumns.map((column) => {
                  const sortMarker =
                    sort?.key === column ? (sort.direction === "asc" ? "Asc" : "Desc") : "";

                  return (
                    <th
                      className="w-56 min-w-56 border-b border-r border-slate-200 p-0 align-top last:border-r-0"
                      key={column}
                      scope="col"
                    >
                      <button
                        className="flex min-h-12 w-full items-start justify-between gap-2 px-3 py-2 text-left font-semibold capitalize text-slate-950 transition hover:bg-slate-200"
                        onClick={() => {
                          setSort((current) => nextSort(current, column));
                          setPage(1);
                        }}
                        type="button"
                      >
                        <span>{columnLabel(column)}</span>
                        <span className="shrink-0 text-xs font-medium text-emerald-700">
                          {sortMarker}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
              <tr>
                {visibleColumns.map((column) => (
                  <th
                    className="w-56 min-w-56 border-b border-r border-slate-200 bg-white p-2 last:border-r-0"
                    key={`${column}-filter`}
                    scope="col"
                  >
                    <input
                      aria-label={`Filter ${columnLabel(column)}`}
                      className="h-8 w-full rounded-md border border-slate-300 px-2 text-xs font-normal text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                      onChange={(event) => {
                        setFilters((current) => ({
                          ...current,
                          [column]: event.target.value,
                        }));
                        setPage(1);
                      }}
                      placeholder="Filter"
                      value={filters[column] ?? ""}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && !preparedData ? (
                <tr>
                  <td className="p-6 text-slate-600">Loading</td>
                </tr>
              ) : null}
              {!isLoading && preparedData && visibleRows.length === 0 ? (
                <tr>
                  <td className="p-6 text-slate-600" colSpan={visibleColumns.length || 1}>
                    No rows
                  </td>
                </tr>
              ) : null}
              {preparedData
                ? visibleRows.map((row) => (
                    <tr className="odd:bg-white even:bg-slate-50" key={row.rowId}>
                      {visibleColumns.map((column) => (
                        <td
                          className="max-w-56 border-b border-r border-slate-200 px-3 py-2 align-top text-slate-800 last:border-r-0"
                          key={`${row.rowId}-${column}`}
                          title={row.values[column] ?? ""}
                        >
                          <span className="line-clamp-3 break-words">
                            {row.values[column] ?? ""}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
