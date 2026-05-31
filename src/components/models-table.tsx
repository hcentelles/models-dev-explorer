"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const SOURCE_URL = "https://models.dev/api.json";
const MAX_PRICE = 120;
const INPUT_PRICE_SCALE = 15;
const OUTPUT_PRICE_SCALE = 120;

type Primitive = string | number | boolean | null | undefined;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };
type ApiProvider = {
  id?: string;
  name?: string;
  models?: Record<string, Record<string, JsonValue>>;
  [key: string]: JsonValue;
};
type ApiPayload = Record<string, ApiProvider>;
type ApiModel = Record<string, JsonValue>;
type SortDirection = "asc" | "desc";
type SortKey = "provider" | "model" | "family" | "context" | "input" | "output" | "release";
type SortState = {
  key: SortKey;
  direction: SortDirection;
};
type CapabilityKey = "reasoning" | "tool" | "structured" | "vision" | "cache";
type ModalityKey = "text" | "image" | "audio";

type ModelRow = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  family: string;
  releaseDate: string;
  openWeights: boolean;
  inputModalities: string[];
  capabilities: Record<CapabilityKey, boolean>;
  context: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  searchText: string;
};

type ProviderOption = {
  id: string;
  name: string;
  count: number;
};

const capabilityOptions: Array<{
  key: CapabilityKey;
  label: string;
  glyph: string;
}> = [
  { key: "reasoning", label: "Reasoning", glyph: "rsn" },
  { key: "tool", label: "Tool calling", glyph: "tool" },
  { key: "structured", label: "Structured output", glyph: "json" },
  { key: "vision", label: "Vision", glyph: "vis" },
  { key: "cache", label: "Prompt cache", glyph: "cache" },
];

const modalityOptions: Array<{ key: ModalityKey; label: string }> = [
  { key: "text", label: "text" },
  { key: "image", label: "image" },
  { key: "audio", label: "audio" },
];

const providerColors: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  google: "#4285f4",
  meta: "#0866ff",
  mistral: "#fa5410",
  xai: "#111111",
  deepseek: "#4d6bfe",
  qwen: "#615ced",
  cohere: "#39594d",
  moonshot: "#16161d",
  amazon: "#ff9900",
  "amazon-bedrock": "#ff9900",
  zai: "#1f6feb",
  "z.ai": "#1f6feb",
  "302ai": "#8b5cf6",
};

function getObject(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function getString(value: JsonValue): string {
  return typeof value === "string" ? value : "";
}

function getBoolean(value: JsonValue): boolean {
  return value === true;
}

function getNumber(value: JsonValue): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getStringArray(value: JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeProviderKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function hashColor(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 78% 58%)`;
}

function providerColor(providerId: string, providerName: string) {
  const key = normalizeProviderKey(providerId || providerName);
  return providerColors[key] ?? hashColor(key || providerName);
}

function makeRows(payload: ApiPayload | null) {
  if (!payload) {
    return {
      rows: [] as ModelRow[],
      providers: [] as ProviderOption[],
      maxContext: 1,
    };
  }

  const rows: ModelRow[] = [];
  const providerCounts = new Map<string, ProviderOption>();

  for (const provider of Object.values(payload)) {
    const providerId = provider.id ?? "";
    const providerName = provider.name ?? providerId;
    const models = provider.models ?? {};

    for (const model of Object.values(models) as ApiModel[]) {
      const cost = getObject(model.cost);
      const limit = getObject(model.limit);
      const modalities = getObject(model.modalities);
      const inputModalities = getStringArray(modalities.input);
      const modelId = getString(model.id);
      const modelName = getString(model.name) || modelId;
      const family = getString(model.family);
      const context = getNumber(limit.context) ?? getNumber(limit.input);
      const inputPrice = getNumber(cost.input);
      const outputPrice = getNumber(cost.output);
      const row: ModelRow = {
        id: `${providerId}:${modelId}`,
        providerId,
        providerName,
        modelId,
        modelName,
        family,
        releaseDate: getString(model.release_date),
        openWeights: getBoolean(model.open_weights),
        inputModalities,
        capabilities: {
          reasoning: getBoolean(model.reasoning),
          tool: getBoolean(model.tool_call),
          structured: getBoolean(model.structured_output),
          vision: getBoolean(model.attachment) || inputModalities.includes("image"),
          cache: cost.cache_read !== undefined && cost.cache_read !== null,
        },
        context,
        inputPrice,
        outputPrice,
        searchText: `${providerName} ${providerId} ${modelName} ${modelId} ${family}`.toLowerCase(),
      };

      rows.push(row);

      const option = providerCounts.get(providerId) ?? {
        id: providerId,
        name: providerName,
        count: 0,
      };
      option.count += 1;
      providerCounts.set(providerId, option);
    }
  }

  return {
    rows,
    providers: [...providerCounts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    maxContext: Math.max(1, ...rows.map((row) => row.context ?? 0)),
  };
}

function formatContext(value: number | null) {
  if (value === null) {
    return "null";
  }

  if (value >= 1_000_000) {
    return `${trimNumber(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  return String(value);
}

function trimNumber(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatPrice(value: number | null) {
  if (value === null) {
    return "null";
  }

  if (value === 0) {
    return "Free";
  }

  if (value < 0.1) {
    return `$${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  }

  if (value < 1) {
    return `$${value.toFixed(2)}`;
  }

  return `$${value.toFixed(2).replace(/\.00$/, "").replace(/0$/, "")}`;
}

function compareRows(a: ModelRow, b: ModelRow, sort: SortState) {
  const direction = sort.direction === "asc" ? 1 : -1;
  const values: Record<SortKey, [string | number | null, string | number | null]> = {
    provider: [a.providerName, b.providerName],
    model: [a.modelName, b.modelName],
    family: [a.family, b.family],
    context: [a.context, b.context],
    input: [a.inputPrice, b.inputPrice],
    output: [a.outputPrice, b.outputPrice],
    release: [a.releaseDate, b.releaseDate],
  };
  const [left, right] = values[sort.key];

  if (left === null || left === "") {
    return right === null || right === "" ? 0 : 1;
  }

  if (right === null || right === "") {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * direction;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  }) * direction;
}

function nextSort(current: SortState, key: SortKey): SortState {
  return {
    key,
    direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
  };
}

function countActiveFilters({
  q,
  selectedCapabilities,
  selectedModalities,
  openOnly,
  maxPrice,
  selectedProviders,
}: {
  q: string;
  selectedCapabilities: ReadonlySet<CapabilityKey>;
  selectedModalities: ReadonlySet<ModalityKey>;
  openOnly: boolean;
  maxPrice: number;
  selectedProviders: ReadonlySet<string>;
}) {
  return (
    (q.trim() ? 1 : 0) +
    selectedCapabilities.size +
    selectedModalities.size +
    (openOnly ? 1 : 0) +
    (maxPrice < MAX_PRICE ? 1 : 0) +
    selectedProviders.size
  );
}

function toggleSetValue<T>(set: ReadonlySet<T>, value: T) {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function CapabilityChip({
  glyph,
  isOn,
  label,
}: {
  glyph: string;
  isOn: boolean;
  label: string;
}) {
  return (
    <span
      className={`rounded-[3px] border px-1.5 py-0.5 text-[9px] leading-none ${
        isOn
          ? "border-[rgba(200,242,78,.3)] bg-[rgba(200,242,78,.1)] text-[var(--acid)]"
          : "border-[var(--line)] bg-[var(--panel2)] text-[var(--ink3)] opacity-50"
      }`}
      title={label}
    >
      {glyph}
    </span>
  );
}

function Bar({
  color,
  scale,
  value,
}: {
  color: string;
  scale: "linear" | "log";
  value: number | null;
}) {
  const width =
    value === null
      ? 0
      : scale === "log"
        ? Math.min(100, (Math.log10(Math.max(1, value)) / Math.log10(2_000_000)) * 100)
        : Math.min(100, value);

  return (
    <span className="mt-1 block h-[3px] w-[64px] overflow-hidden rounded-full bg-[var(--line2)]">
      <span
        className="block h-full rounded-full"
        style={{ background: color, width: `${width}%` }}
      />
    </span>
  );
}

function HeaderButton({
  activeSort,
  align = "left",
  children,
  sortKey,
  onSort,
}: {
  activeSort: SortState;
  align?: "left" | "right";
  children: React.ReactNode;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const active = activeSort.key === sortKey;

  return (
    <button
      className={`w-full text-[10px] font-medium uppercase tracking-[.1em] transition-colors hover:text-[var(--acid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acid)] ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-[var(--acid)]" : "text-[var(--ink3)]"}`}
      onClick={() => onSort(sortKey)}
      type="button"
    >
      {children}
      {active ? (activeSort.direction === "asc" ? "▲" : "▼") : ""}
    </button>
  );
}

function FacetCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      className={`group flex w-full items-center gap-3 py-1.5 text-left text-[13px] transition-colors ${
        checked ? "text-[var(--ink)]" : "text-[var(--ink2)] hover:text-[var(--ink)]"
      }`}
      onClick={onChange}
      type="button"
    >
      <span
        className={`grid h-[15px] w-[15px] place-items-center rounded border text-[10px] leading-none ${
          checked
            ? "border-[var(--acid)] bg-[var(--acid)] text-[var(--bg)]"
            : "border-[var(--line2)]"
        }`}
      >
        {checked ? "x" : ""}
      </span>
      <span>{label}</span>
    </button>
  );
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
  const [q, setQ] = useState("");
  const [selectedCapabilities, setSelectedCapabilities] = useState<ReadonlySet<CapabilityKey>>(
    () => new Set(),
  );
  const [selectedModalities, setSelectedModalities] = useState<ReadonlySet<ModalityKey>>(
    () => new Set(),
  );
  const [selectedProviders, setSelectedProviders] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [openOnly, setOpenOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [sort, setSort] = useState<SortState>({ key: "release", direction: "desc" });
  const tableScrollRef = useRef<HTMLDivElement>(null);

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

  const { rows, providers, maxContext } = useMemo(() => makeRows(payload), [payload]);
  const activeFilterCount = countActiveFilters({
    q,
    selectedCapabilities,
    selectedModalities,
    openOnly,
    maxPrice,
    selectedProviders,
  });

  const filteredRows = useMemo(() => {
    const normalizedQ = q.trim().toLowerCase();

    return rows
      .filter((row) => {
        if (normalizedQ && !row.searchText.includes(normalizedQ)) {
          return false;
        }

        if (selectedProviders.size > 0 && !selectedProviders.has(row.providerId)) {
          return false;
        }

        for (const capability of selectedCapabilities) {
          if (!row.capabilities[capability]) {
            return false;
          }
        }

        for (const modality of selectedModalities) {
          if (!row.inputModalities.includes(modality)) {
            return false;
          }
        }

        if (openOnly && !row.openWeights) {
          return false;
        }

        if (maxPrice < MAX_PRICE) {
          return row.outputPrice !== null && row.outputPrice <= maxPrice;
        }

        return true;
      })
      .sort((a, b) => compareRows(a, b, sort));
  }, [
    maxPrice,
    openOnly,
    q,
    rows,
    selectedCapabilities,
    selectedModalities,
    selectedProviders,
    sort,
  ]);

  // TanStack Virtual intentionally returns function fields; this component does
  // not pass them into memoized children.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 62,
    overscan: 12,
  });

  function clearFilters() {
    setQ("");
    setSelectedCapabilities(new Set());
    setSelectedModalities(new Set());
    setSelectedProviders(new Set());
    setOpenOnly(false);
    setMaxPrice(MAX_PRICE);
  }

  return (
    <main className="console-shell">
      <aside className="console-rail">
        <section className="brand-block">
          <div className="brand-mark">◇</div>
          <div>
            <div className="brand-title">models.dev</div>
            <div className="brand-subtitle">catalog explorer</div>
          </div>
        </section>

        <label className="rail-search">
          <span>/</span>
          <input
            onChange={(event) => setQ(event.target.value)}
            placeholder="filter..."
            type="search"
            value={q}
          />
        </label>

        {activeFilterCount > 0 ? (
          <button className="clear-filters" onClick={clearFilters} type="button">
            clear {activeFilterCount} filters
          </button>
        ) : null}

        <FacetSection title="capabilities">
          {capabilityOptions.map((capability) => (
            <FacetCheckbox
              checked={selectedCapabilities.has(capability.key)}
              key={capability.key}
              label={capability.label}
              onChange={() =>
                setSelectedCapabilities((current) => toggleSetValue(current, capability.key))
              }
            />
          ))}
        </FacetSection>

        <FacetSection title="input modality">
          {modalityOptions.map((modality) => (
            <FacetCheckbox
              checked={selectedModalities.has(modality.key)}
              key={modality.key}
              label={modality.label}
              onChange={() =>
                setSelectedModalities((current) => toggleSetValue(current, modality.key))
              }
            />
          ))}
        </FacetSection>

        <FacetSection title="weights">
          <FacetCheckbox
            checked={openOnly}
            label="open weights only"
            onChange={() => setOpenOnly((current) => !current)}
          />
        </FacetSection>

        <FacetSection title="max output price">
          <input
            aria-label="Maximum output price"
            className="price-slider"
            max={MAX_PRICE}
            min={0.4}
            onChange={(event) => setMaxPrice(Number(event.target.value))}
            step={0.4}
            type="range"
            value={maxPrice}
          />
          <div className="price-caption">
            ≤ <strong>${trimNumber(maxPrice)}</strong> /M
          </div>
        </FacetSection>

        <FacetSection title="providers">
          <div className="provider-list">
            {providers.map((provider) => {
              const selected = selectedProviders.has(provider.id);
              const color = providerColor(provider.id, provider.name);

              return (
                <button
                  className={`provider-filter ${selected ? "selected" : ""}`}
                  key={provider.id}
                  onClick={() =>
                    setSelectedProviders((current) => toggleSetValue(current, provider.id))
                  }
                  type="button"
                >
                  <span className="provider-dot" style={{ background: color }} />
                  <span className="provider-name">{provider.name}</span>
                  <span className="provider-count">{provider.count}</span>
                </button>
              );
            })}
          </div>
        </FacetSection>
      </aside>

      <section className="console-main">
        <header className="topbar">
          <div className="result-summary">
            <strong>{filteredRows.length}</strong>
            <span>models</span>
            <span>/</span>
            <span>{rows.length}</span>
            <span>·</span>
            <span>{activeFilterCount} active filters</span>
          </div>

          <div className="topbar-actions">
            <a href={SOURCE_URL} rel="noreferrer" target="_blank">
              Source JSON
            </a>
            <button disabled={isLoading} onClick={loadData} type="button">
              {isLoading ? "Refreshing" : "Refresh"}
            </button>
            <SortPill activeSort={sort} label="date" sortKey="release" onSort={setSort} />
            <SortPill activeSort={sort} label="price" sortKey="output" onSort={setSort} />
            <SortPill activeSort={sort} label="context" sortKey="context" onSort={setSort} />
          </div>
        </header>

        {error ? <div className="console-error">{error}</div> : null}

        <div className="results-scroll-x">
          <div className="table-header">
            <HeaderButton
              activeSort={sort}
              sortKey="provider"
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              provider
            </HeaderButton>
            <HeaderButton
              activeSort={sort}
              sortKey="model"
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              model
            </HeaderButton>
            <HeaderButton
              activeSort={sort}
              sortKey="family"
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              family
            </HeaderButton>
            <div className="caps-header">caps</div>
            <HeaderButton
              activeSort={sort}
              align="right"
              sortKey="context"
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              context
            </HeaderButton>
            <HeaderButton
              activeSort={sort}
              align="right"
              sortKey="input"
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              in $/m
            </HeaderButton>
            <HeaderButton
              activeSort={sort}
              align="right"
              sortKey="output"
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              out $/m
            </HeaderButton>
            <HeaderButton
              activeSort={sort}
              align="right"
              sortKey="release"
              onSort={(key) => setSort(nextSort(sort, key))}
            >
              released
            </HeaderButton>
          </div>

          <div className="table-scroll" ref={tableScrollRef}>
            {filteredRows.length === 0 ? (
              <div className="empty-state">{"// no models match the active query"}</div>
            ) : (
              <div
                className="virtual-space"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = filteredRows[virtualRow.index];
                  return (
                    <ModelResultRow
                      key={row.id}
                      maxContext={maxContext}
                      row={row}
                      start={virtualRow.start}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="status-bar">
          <span className="ready">READY</span>
          <span>rows {filteredRows.length}</span>
          <span>
            sort {sort.key} {sort.direction}
          </span>
          <span className="updated">{updatedAt ? `fetched ${updatedAt}` : ""}</span>
          <span className="hint">click headers to sort · facets stack</span>
        </footer>
      </section>
    </main>
  );
}

function FacetSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="facet-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function SortPill({
  activeSort,
  label,
  sortKey,
  onSort,
}: {
  activeSort: SortState;
  label: string;
  sortKey: SortKey;
  onSort: (sort: SortState) => void;
}) {
  const active = activeSort.key === sortKey;

  return (
    <button
      className={`sort-pill ${active ? "active" : ""}`}
      onClick={() => onSort(nextSort(activeSort, sortKey))}
      type="button"
    >
      {label}
      {active ? (activeSort.direction === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );
}

function ModelResultRow({
  maxContext,
  row,
  start,
}: {
  maxContext: number;
  row: ModelRow;
  start: number;
}) {
  const color = providerColor(row.providerId, row.providerName);
  const contextWidth =
    row.context === null
      ? 0
      : (Math.log10(Math.max(1, row.context)) / Math.log10(Math.max(1, maxContext))) * 100;
  const inputWidth =
    row.inputPrice === null ? 0 : Math.min(100, (row.inputPrice / INPUT_PRICE_SCALE) * 100);
  const outputWidth =
    row.outputPrice === null ? 0 : Math.min(100, (row.outputPrice / OUTPUT_PRICE_SCALE) * 100);

  return (
    <div className="result-row" style={{ transform: `translateY(${start}px)` }}>
      <div className="provider-cell">
        <span className="provider-dot" style={{ background: color }} />
        <span>{row.providerName}</span>
      </div>
      <div className="model-cell">
        <span>{row.modelName}</span>
        {row.openWeights ? <span className="oss-badge">OSS</span> : null}
      </div>
      <div className="family-cell">{row.family || "—"}</div>
      <div className="cap-cell">
        {capabilityOptions.map((capability) => (
          <CapabilityChip
            glyph={capability.glyph}
            isOn={row.capabilities[capability.key]}
            key={capability.key}
            label={capability.label}
          />
        ))}
      </div>
      <MetricCell
        barColor="var(--cyan)"
        barWidth={contextWidth}
        className="context-value"
        value={formatContext(row.context)}
      />
      <MetricCell
        barColor="var(--blue)"
        barWidth={inputWidth}
        value={formatPrice(row.inputPrice)}
      />
      <MetricCell
        barColor="var(--acid-d)"
        barWidth={outputWidth}
        value={formatPrice(row.outputPrice)}
      />
      <div className="date-cell">{row.releaseDate || "null"}</div>
    </div>
  );
}

function MetricCell({
  barColor,
  barWidth,
  className,
  value,
}: {
  barColor: string;
  barWidth: number;
  className?: string;
  value: string;
}) {
  const isNull = value === "null";

  return (
    <div className={`metric-cell ${className ?? ""} ${isNull ? "nullish" : ""}`}>
      <span>{value}</span>
      <Bar color={barColor} scale="linear" value={barWidth} />
    </div>
  );
}
