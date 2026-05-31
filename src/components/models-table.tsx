"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const SOURCE_URL = "https://models.dev/api.json";
const MAX_PRICE = 120;
const MAX_INPUT_PRICE = 15;
const DEFAULT_MIN_CONTEXT = 0;
const INPUT_PRICE_SCALE = 15;
const OUTPUT_PRICE_SCALE = 120;
const FILTER_STORAGE_KEY = "models-dev-explorer-filters-v1";

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
type SortState = {
  key: string;
  direction: SortDirection;
};
type ColumnKind = "boolean" | "number" | "text";
type EmptyFilterMode = "any" | "filled" | "empty";
type BooleanFilterMode = "any" | "true" | "false" | "empty";
type CapabilityKey = "reasoning" | "tool" | "structured" | "vision" | "cache";
type ModalityKey = "text" | "image" | "audio";
type ColumnGroup =
  | "Provider"
  | "Model"
  | "Capabilities"
  | "Modalities"
  | "Limits"
  | "Costs"
  | "Dates"
  | "Other";

type ColumnDef = {
  key: string;
  label: string;
  group: ColumnGroup;
  kind: ColumnKind;
  align?: "left" | "right";
  width: number;
};

type ModelRow = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  family: string;
  releaseDate: string;
  lastUpdated: string;
  status: string;
  openWeights: boolean;
  inputModalities: string[];
  outputModalities: string[];
  capabilities: Record<CapabilityKey, boolean>;
  context: number | null;
  outputLimit: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  providerApi: string;
  values: Record<string, string>;
  rawValues: Record<string, Primitive>;
  searchText: string;
};

type PreparedData = {
  rows: ModelRow[];
  providers: ProviderOption[];
  columns: ColumnDef[];
  families: string[];
  statuses: string[];
  maxContext: number;
};

type ProviderOption = {
  id: string;
  name: string;
  count: number;
};

type PersistedFilterState = {
  q?: string;
  columnFilters?: Record<string, string>;
  columnEmptyFilters?: Record<string, EmptyFilterMode>;
  columnBooleanFilters?: Record<string, BooleanFilterMode>;
  selectedCapabilities?: CapabilityKey[];
  selectedInputModalities?: ModalityKey[];
  selectedOutputModalities?: ModalityKey[];
  selectedProviders?: string[];
  selectedFamilies?: string[];
  selectedStatuses?: string[];
  openOnly?: boolean;
  maxPrice?: number;
  maxInputPrice?: number;
  minContext?: number;
  releaseAfter?: string;
  releaseBefore?: string;
  providerApiFilter?: string;
  sort?: SortState;
  visibleColumnKeys?: string[];
  sidebarOpen?: boolean;
};

const defaultColumnKeys = [
  "provider.name",
  "model.name",
  "model.family",
  "model.capabilities",
  "model.limit.context",
  "model.cost.input",
  "model.cost.output",
  "model.release_date",
];

const preferredColumnOrder = [
  ...defaultColumnKeys,
  "provider.id",
  "provider.api",
  "provider.npm",
  "provider.doc",
  "model.id",
  "model.open_weights",
  "model.reasoning",
  "model.tool_call",
  "model.structured_output",
  "model.attachment",
  "model.modalities.input",
  "model.modalities.output",
  "model.limit.output",
  "model.cost.cache_read",
  "model.cost.cache_write",
  "model.knowledge",
  "model.last_updated",
  "model.status",
];

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

function formatAny(value: JsonValue): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(formatAny).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function primitiveValue(value: JsonValue): Primitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : formatAny(value);
}

function flattenJson(
  value: Record<string, JsonValue>,
  prefix: string,
  values: Record<string, string>,
  rawValues: Record<string, Primitive>,
) {
  for (const [key, child] of Object.entries(value)) {
    if (key === "models") {
      continue;
    }

    const path = `${prefix}.${key}`;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flattenJson(child as Record<string, JsonValue>, path, values, rawValues);
    } else {
      values[path] = formatAny(child);
      rawValues[path] = primitiveValue(child);
    }
  }
}

function groupForColumn(key: string): ColumnGroup {
  if (key.startsWith("provider.")) return "Provider";
  if (key.includes(".cost.")) return "Costs";
  if (key.includes(".limit.")) return "Limits";
  if (key.includes(".modalities.")) return "Modalities";
  if (
    key === "model.capabilities" ||
    key === "model.reasoning" ||
    key === "model.tool_call" ||
    key === "model.structured_output" ||
    key === "model.attachment" ||
    key === "model.open_weights"
  ) {
    return "Capabilities";
  }
  if (key.includes("date") || key.includes("updated") || key.includes("knowledge")) return "Dates";
  if (key.startsWith("model.")) return "Model";
  return "Other";
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function labelForColumn(key: string) {
  return key
    .split(".")
    .map((part) => titleCase(part.replace(/_/g, " ")))
    .join(" ");
}

function widthForColumn(key: string, label: string) {
  if (key === "model.capabilities") return 245;
  if (key === "model.name" || key === "model.id") return 220;
  if (key === "provider.name" || key === "provider.id") return 165;
  if (key.includes(".cost.")) return 98;
  if (key.includes(".limit.")) return 112;
  if (key.includes("date") || key.includes("updated")) return 124;
  if (key.includes("modalities")) return 150;
  return Math.max(150, Math.min(260, label.length * 8));
}

function isEmptyValue(value: Primitive, formattedValue?: string) {
  return (
    value === null ||
    value === undefined ||
    (typeof formattedValue === "string" && formattedValue === "")
  );
}

function cellIsEmpty(row: ModelRow, key: string) {
  return isEmptyValue(row.rawValues[key], row.values[key] ?? "");
}

function classifyColumn(rows: ModelRow[], key: string): ColumnKind {
  const nonEmptyValues = rows
    .map((row) => row.rawValues[key])
    .filter((value) => !isEmptyValue(value));

  if (nonEmptyValues.length > 0 && nonEmptyValues.every((value) => typeof value === "boolean")) {
    return "boolean";
  }

  if (nonEmptyValues.length > 0 && nonEmptyValues.every((value) => typeof value === "number")) {
    return "number";
  }

  return "text";
}

function makeColumnDefs(keys: Set<string>, rows: ModelRow[]) {
  return [...keys]
    .sort((a, b) => {
      const aIndex = preferredColumnOrder.indexOf(a);
      const bIndex = preferredColumnOrder.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex) -
          (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
      }
      return a.localeCompare(b);
    })
    .map((key): ColumnDef => {
      const label = labelForColumn(key);

      return {
        key,
        label,
        group: groupForColumn(key),
        kind: classifyColumn(rows, key),
        align:
          key.includes(".cost.") ||
          key.includes(".limit.") ||
          key.includes("date") ||
          key.includes("updated")
            ? "right"
            : "left",
        width: widthForColumn(key, label),
      };
    });
}

function makeRows(payload: ApiPayload | null): PreparedData {
  if (!payload) {
    return {
      rows: [],
      providers: [],
      columns: [],
      families: [],
      statuses: [],
      maxContext: 1,
    };
  }

  const rows: ModelRow[] = [];
  const providerCounts = new Map<string, ProviderOption>();
  const columnKeys = new Set<string>();
  const families = new Set<string>();
  const statuses = new Set<string>();

  for (const provider of Object.values(payload)) {
    const providerId = provider.id ?? "";
    const providerName = provider.name ?? providerId;
    const models = provider.models ?? {};

    for (const model of Object.values(models) as ApiModel[]) {
      const values: Record<string, string> = {};
      const rawValues: Record<string, Primitive> = {};
      const cost = getObject(model.cost);
      const limit = getObject(model.limit);
      const modalities = getObject(model.modalities);
      const inputModalities = getStringArray(modalities.input);
      const outputModalities = getStringArray(modalities.output);
      const modelId = getString(model.id);
      const modelName = getString(model.name) || modelId;
      const family = getString(model.family);
      const context = getNumber(limit.context) ?? getNumber(limit.input);
      const outputLimit = getNumber(limit.output);
      const inputPrice = getNumber(cost.input);
      const outputPrice = getNumber(cost.output);
      const releaseDate = getString(model.release_date);
      const lastUpdated = getString(model.last_updated);
      const status = getString(model.status);
      const openWeights = getBoolean(model.open_weights);
      const capabilities: Record<CapabilityKey, boolean> = {
        reasoning: getBoolean(model.reasoning),
        tool: getBoolean(model.tool_call),
        structured: getBoolean(model.structured_output),
        vision: getBoolean(model.attachment) || inputModalities.includes("image"),
        cache: cost.cache_read !== undefined && cost.cache_read !== null,
      };

      flattenJson(provider, "provider", values, rawValues);
      flattenJson(model, "model", values, rawValues);

      values["provider.name"] = providerName;
      values["provider.id"] = providerId;
      values["model.name"] = modelName;
      values["model.id"] = modelId;
      values["model.family"] = family;
      values["model.capabilities"] = capabilityOptions
        .filter((capability) => capabilities[capability.key])
        .map((capability) => capability.glyph)
        .join(", ");
      values["model.limit.context"] = context === null ? "" : String(context);
      values["model.limit.output"] = outputLimit === null ? "" : String(outputLimit);
      values["model.cost.input"] = inputPrice === null ? "" : String(inputPrice);
      values["model.cost.output"] = outputPrice === null ? "" : String(outputPrice);
      values["model.release_date"] = releaseDate;
      values["model.last_updated"] = lastUpdated;
      values["model.status"] = status;
      rawValues["provider.name"] = providerName;
      rawValues["provider.id"] = providerId;
      rawValues["model.name"] = modelName;
      rawValues["model.id"] = modelId;
      rawValues["model.family"] = family;
      rawValues["model.capabilities"] = values["model.capabilities"];
      rawValues["model.limit.context"] = context;
      rawValues["model.limit.output"] = outputLimit;
      rawValues["model.cost.input"] = inputPrice;
      rawValues["model.cost.output"] = outputPrice;
      rawValues["model.release_date"] = releaseDate;
      rawValues["model.last_updated"] = lastUpdated;
      rawValues["model.status"] = status;

      for (const key of Object.keys(values)) {
        columnKeys.add(key);
      }

      if (family) families.add(family);
      if (status) statuses.add(status);

      rows.push({
        id: `${providerId}:${modelId}`,
        providerId,
        providerName,
        modelId,
        modelName,
        family,
        releaseDate,
        lastUpdated,
        status,
        openWeights,
        inputModalities,
        outputModalities,
        capabilities,
        context,
        outputLimit,
        inputPrice,
        outputPrice,
        providerApi: getString(provider.api),
        values,
        rawValues,
        searchText: Object.values(values).join(" ").toLowerCase(),
      });

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
    columns: makeColumnDefs(columnKeys, rows),
    families: [...families].sort((a, b) => a.localeCompare(b)),
    statuses: [...statuses].sort((a, b) => a.localeCompare(b)),
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
  const left = a.rawValues[sort.key] ?? a.values[sort.key] ?? "";
  const right = b.rawValues[sort.key] ?? b.values[sort.key] ?? "";

  if (left === null || left === undefined || left === "") {
    return right === null || right === undefined || right === "" ? 0 : 1;
  }

  if (right === null || right === undefined || right === "") {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * direction;
  }

  if (typeof left === "boolean" && typeof right === "boolean") {
    return (Number(left) - Number(right)) * direction;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  }) * direction;
}

function nextSort(current: SortState, key: string): SortState {
  return {
    key,
    direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
  };
}

function countActiveFilters({
  q,
  selectedCapabilities,
  selectedInputModalities,
  selectedOutputModalities,
  selectedFamilies,
  selectedStatuses,
  openOnly,
  maxPrice,
  maxInputPrice,
  minContext,
  releaseAfter,
  releaseBefore,
  providerApiFilter,
  selectedProviders,
  columnFilters,
  columnEmptyFilters,
  columnBooleanFilters,
}: {
  q: string;
  selectedCapabilities: ReadonlySet<CapabilityKey>;
  selectedInputModalities: ReadonlySet<ModalityKey>;
  selectedOutputModalities: ReadonlySet<ModalityKey>;
  selectedFamilies: ReadonlySet<string>;
  selectedStatuses: ReadonlySet<string>;
  openOnly: boolean;
  maxPrice: number;
  maxInputPrice: number;
  minContext: number;
  releaseAfter: string;
  releaseBefore: string;
  providerApiFilter: string;
  selectedProviders: ReadonlySet<string>;
  columnFilters: Record<string, string>;
  columnEmptyFilters: Record<string, EmptyFilterMode>;
  columnBooleanFilters: Record<string, BooleanFilterMode>;
}) {
  return (
    (q.trim() ? 1 : 0) +
    selectedCapabilities.size +
    selectedInputModalities.size +
    selectedOutputModalities.size +
    selectedFamilies.size +
    selectedStatuses.size +
    (openOnly ? 1 : 0) +
    (maxPrice < MAX_PRICE ? 1 : 0) +
    (maxInputPrice < MAX_INPUT_PRICE ? 1 : 0) +
    (minContext > DEFAULT_MIN_CONTEXT ? 1 : 0) +
    (releaseAfter ? 1 : 0) +
    (releaseBefore ? 1 : 0) +
    (providerApiFilter.trim() ? 1 : 0) +
    selectedProviders.size +
    Object.values(columnFilters).filter((value) => value.trim()).length +
    Object.values(columnEmptyFilters).filter((value) => value !== "any").length +
    Object.values(columnBooleanFilters).filter((value) => value !== "any").length
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

function cleanRecord<T extends string>(record: Record<string, T> | undefined, defaultValue: T) {
  const entries = Object.entries(record ?? {}).filter(([, value]) => value && value !== defaultValue);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function cleanTextRecord(record: Record<string, string>) {
  const entries = Object.entries(record)
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function compactFilterState(state: PersistedFilterState): PersistedFilterState {
  return {
    q: state.q?.trim() || undefined,
    columnFilters: cleanTextRecord(state.columnFilters ?? {}),
    columnEmptyFilters: cleanRecord(state.columnEmptyFilters, "any"),
    columnBooleanFilters: cleanRecord(state.columnBooleanFilters, "any"),
    selectedCapabilities:
      state.selectedCapabilities && state.selectedCapabilities.length > 0
        ? state.selectedCapabilities
        : undefined,
    selectedInputModalities:
      state.selectedInputModalities && state.selectedInputModalities.length > 0
        ? state.selectedInputModalities
        : undefined,
    selectedOutputModalities:
      state.selectedOutputModalities && state.selectedOutputModalities.length > 0
        ? state.selectedOutputModalities
        : undefined,
    selectedProviders:
      state.selectedProviders && state.selectedProviders.length > 0
        ? state.selectedProviders
        : undefined,
    selectedFamilies:
      state.selectedFamilies && state.selectedFamilies.length > 0 ? state.selectedFamilies : undefined,
    selectedStatuses:
      state.selectedStatuses && state.selectedStatuses.length > 0
        ? state.selectedStatuses
        : undefined,
    openOnly: state.openOnly || undefined,
    maxPrice: state.maxPrice !== undefined && state.maxPrice < MAX_PRICE ? state.maxPrice : undefined,
    maxInputPrice:
      state.maxInputPrice !== undefined && state.maxInputPrice < MAX_INPUT_PRICE
        ? state.maxInputPrice
        : undefined,
    minContext:
      state.minContext !== undefined && state.minContext > DEFAULT_MIN_CONTEXT
        ? state.minContext
        : undefined,
    releaseAfter: state.releaseAfter || undefined,
    releaseBefore: state.releaseBefore || undefined,
    providerApiFilter: state.providerApiFilter?.trim() || undefined,
    sort:
      state.sort && (state.sort.key !== "model.release_date" || state.sort.direction !== "desc")
        ? state.sort
        : undefined,
    visibleColumnKeys:
      state.visibleColumnKeys &&
      (state.visibleColumnKeys.length !== defaultColumnKeys.length ||
        state.visibleColumnKeys.some((key, index) => key !== defaultColumnKeys[index]))
        ? state.visibleColumnKeys
        : undefined,
    sidebarOpen: state.sidebarOpen === false ? false : undefined,
  };
}

function hasPersistedValues(state: PersistedFilterState) {
  return Object.values(state).some((value) => value !== undefined);
}

function parsePersistedFilterState(value: string | null): PersistedFilterState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as PersistedFilterState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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

function Bar({ color, value }: { color: string; value: number }) {
  return (
    <span className="mt-1 block h-[3px] w-[64px] overflow-hidden rounded-full bg-[var(--line2)]">
      <span
        className="block h-full rounded-full"
        style={{ background: color, width: `${Math.max(0, Math.min(100, value))}%` }}
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
  sortKey: string;
  onSort: (key: string) => void;
}) {
  const active = activeSort.key === sortKey;

  return (
    <button
      className={`column-sort ${align === "right" ? "right" : ""} ${active ? "active" : ""}`}
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
    <button className={`facet-check ${checked ? "checked" : ""}`} onClick={onChange} type="button">
      <span>{checked ? "x" : ""}</span>
      <span>{label}</span>
    </button>
  );
}

function FacetSection({ children, title }: { children: React.ReactNode; title: string }) {
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
  sortKey: string;
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

function MiniTextFilter({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="mini-filter">
      <span>{label}</span>
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  );
}

function ColumnPicker({
  columns,
  visibleColumnKeys,
  columnSearch,
  onColumnSearchChange,
  onDefault,
  onShowAll,
  onToggle,
}: {
  columns: ColumnDef[];
  visibleColumnKeys: ReadonlySet<string>;
  columnSearch: string;
  onColumnSearchChange: (value: string) => void;
  onDefault: () => void;
  onShowAll: () => void;
  onToggle: (column: string) => void;
}) {
  const normalizedSearch = columnSearch.trim().toLowerCase();
  const groups = columns.reduce<Record<string, ColumnDef[]>>((acc, column) => {
    if (
      normalizedSearch &&
      !column.label.toLowerCase().includes(normalizedSearch) &&
      !column.key.toLowerCase().includes(normalizedSearch)
    ) {
      return acc;
    }
    acc[column.group] = acc[column.group] ?? [];
    acc[column.group].push(column);
    return acc;
  }, {});

  return (
    <details className="column-picker">
      <summary>
        columns <span>{visibleColumnKeys.size}/{columns.length}</span>
      </summary>
      <div className="column-picker-panel">
        <div className="column-picker-controls">
          <input
            onChange={(event) => onColumnSearchChange(event.target.value)}
            placeholder="find columns..."
            type="search"
            value={columnSearch}
          />
          <button onClick={onDefault} type="button">
            Default
          </button>
          <button onClick={onShowAll} type="button">
            Show all
          </button>
        </div>
        <div className="column-groups">
          {Object.entries(groups).map(([group, groupColumns]) => (
            <section key={group}>
              <h3>{group}</h3>
              {groupColumns.map((column) => {
                const checked = visibleColumnKeys.has(column.key);
                const disabled = checked && visibleColumnKeys.size === 1;

                return (
                  <label className="column-option" key={column.key}>
                    <input
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(column.key)}
                      type="checkbox"
                    />
                    <span>{column.label}</span>
                  </label>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </details>
  );
}

function ColumnFilterControl({
  column,
  booleanMode,
  emptyMode,
  textValue,
  onBooleanModeChange,
  onEmptyModeChange,
  onTextChange,
}: {
  column: ColumnDef;
  booleanMode: BooleanFilterMode;
  emptyMode: EmptyFilterMode;
  textValue: string;
  onBooleanModeChange: (value: BooleanFilterMode) => void;
  onEmptyModeChange: (value: EmptyFilterMode) => void;
  onTextChange: (value: string) => void;
}) {
  if (column.kind === "boolean") {
    return (
      <select
        aria-label={`Boolean filter ${column.label}`}
        className="column-filter-select boolean"
        onChange={(event) => onBooleanModeChange(event.target.value as BooleanFilterMode)}
        value={booleanMode}
      >
        <option value="any">any</option>
        <option value="true">true</option>
        <option value="false">false</option>
        <option value="empty">empty</option>
      </select>
    );
  }

  return (
    <div className="column-filter-control">
      <input
        aria-label={`Filter ${column.label}`}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="filter"
        type="search"
        value={textValue}
      />
      <select
        aria-label={`Empty filter ${column.label}`}
        className="column-filter-select"
        onChange={(event) => onEmptyModeChange(event.target.value as EmptyFilterMode)}
        value={emptyMode}
      >
        <option value="any">any</option>
        <option value="filled">filled</option>
        <option value="empty">empty</option>
      </select>
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
      <Bar color={barColor} value={barWidth} />
    </div>
  );
}

function CellValue({
  column,
  maxContext,
  row,
}: {
  column: ColumnDef;
  maxContext: number;
  row: ModelRow;
}) {
  if (column.key === "provider.name") {
    return (
      <div className="provider-cell">
        <span
          className="provider-dot"
          style={{ background: providerColor(row.providerId, row.providerName) }}
        />
        <span>{row.providerName}</span>
      </div>
    );
  }

  if (column.key === "model.name") {
    return (
      <div className="model-cell">
        <span>{row.modelName}</span>
        {row.openWeights ? <span className="oss-badge">OSS</span> : null}
      </div>
    );
  }

  if (column.key === "model.capabilities") {
    return (
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
    );
  }

  if (column.key === "model.limit.context") {
    const width =
      row.context === null
        ? 0
        : (Math.log10(Math.max(1, row.context)) / Math.log10(Math.max(1, maxContext))) * 100;

    return (
      <MetricCell
        barColor="var(--cyan)"
        barWidth={width}
        className="context-value"
        value={formatContext(row.context)}
      />
    );
  }

  if (column.key === "model.cost.input") {
    return (
      <MetricCell
        barColor="var(--blue)"
        barWidth={row.inputPrice === null ? 0 : (row.inputPrice / INPUT_PRICE_SCALE) * 100}
        value={formatPrice(row.inputPrice)}
      />
    );
  }

  if (column.key === "model.cost.output") {
    return (
      <MetricCell
        barColor="var(--acid-d)"
        barWidth={row.outputPrice === null ? 0 : (row.outputPrice / OUTPUT_PRICE_SCALE) * 100}
        value={formatPrice(row.outputPrice)}
      />
    );
  }

  if (column.key.includes(".cost.")) {
    const rawValue = row.rawValues[column.key];
    const value = typeof rawValue === "number" ? rawValue : null;
    return <span className={value === null ? "nullish" : ""}>{formatPrice(value)}</span>;
  }

  if (column.key.includes(".limit.")) {
    const rawValue = row.rawValues[column.key];
    const value = typeof rawValue === "number" ? rawValue : null;
    return <span className={value === null ? "nullish" : ""}>{formatContext(value)}</span>;
  }

  return <span>{row.values[column.key] || "—"}</span>;
}

function ModelResultRow({
  columns,
  gridTemplate,
  maxContext,
  row,
  start,
}: {
  columns: ColumnDef[];
  gridTemplate: string;
  maxContext: number;
  row: ModelRow;
  start: number;
}) {
  return (
    <div
      className="result-row"
      style={{ gridTemplateColumns: gridTemplate, transform: `translateY(${start}px)` }}
    >
      {columns.map((column) => (
        <div
          className={`result-cell ${column.align === "right" ? "right" : ""} ${
            column.key === "model.family" ? "family-cell" : ""
          }`}
          key={`${row.id}:${column.key}`}
          title={row.values[column.key]}
        >
          <CellValue column={column} maxContext={maxContext} row={row} />
        </div>
      ))}
    </div>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [q, setQ] = useState("");
  const [columnSearch, setColumnSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [columnEmptyFilters, setColumnEmptyFilters] = useState<Record<string, EmptyFilterMode>>({});
  const [columnBooleanFilters, setColumnBooleanFilters] = useState<
    Record<string, BooleanFilterMode>
  >({});
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<ReadonlySet<string>>(
    () => new Set(defaultColumnKeys),
  );
  const [selectedCapabilities, setSelectedCapabilities] = useState<ReadonlySet<CapabilityKey>>(
    () => new Set(),
  );
  const [selectedInputModalities, setSelectedInputModalities] = useState<ReadonlySet<ModalityKey>>(
    () => new Set(),
  );
  const [selectedOutputModalities, setSelectedOutputModalities] = useState<ReadonlySet<ModalityKey>>(
    () => new Set(),
  );
  const [selectedProviders, setSelectedProviders] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedFamilies, setSelectedFamilies] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedStatuses, setSelectedStatuses] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [openOnly, setOpenOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [maxInputPrice, setMaxInputPrice] = useState(MAX_INPUT_PRICE);
  const [minContext, setMinContext] = useState(DEFAULT_MIN_CONTEXT);
  const [releaseAfter, setReleaseAfter] = useState("");
  const [releaseBefore, setReleaseBefore] = useState("");
  const [providerApiFilter, setProviderApiFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "model.release_date", direction: "desc" });
  const [hasLoadedPersistedFilters, setHasLoadedPersistedFilters] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const currentPersistedState = useCallback((): PersistedFilterState => {
    return compactFilterState({
      q,
      columnFilters,
      columnEmptyFilters,
      columnBooleanFilters,
      selectedCapabilities: [...selectedCapabilities],
      selectedInputModalities: [...selectedInputModalities],
      selectedOutputModalities: [...selectedOutputModalities],
      selectedProviders: [...selectedProviders],
      selectedFamilies: [...selectedFamilies],
      selectedStatuses: [...selectedStatuses],
      openOnly,
      maxPrice,
      maxInputPrice,
      minContext,
      releaseAfter,
      releaseBefore,
      providerApiFilter,
      sort,
      visibleColumnKeys: [...visibleColumnKeys],
      sidebarOpen,
    });
  }, [
    columnBooleanFilters,
    columnEmptyFilters,
    columnFilters,
    maxInputPrice,
    maxPrice,
    minContext,
    openOnly,
    providerApiFilter,
    q,
    releaseAfter,
    releaseBefore,
    selectedCapabilities,
    selectedFamilies,
    selectedInputModalities,
    selectedOutputModalities,
    selectedProviders,
    selectedStatuses,
    sidebarOpen,
    sort,
    visibleColumnKeys,
  ]);

  const applyPersistedState = useCallback((state: PersistedFilterState | null) => {
    if (!state) {
      return;
    }

    setQ(state.q ?? "");
    setColumnFilters(state.columnFilters ?? {});
    setColumnEmptyFilters(state.columnEmptyFilters ?? {});
    setColumnBooleanFilters(state.columnBooleanFilters ?? {});
    setSelectedCapabilities(new Set(state.selectedCapabilities ?? []));
    setSelectedInputModalities(new Set(state.selectedInputModalities ?? []));
    setSelectedOutputModalities(new Set(state.selectedOutputModalities ?? []));
    setSelectedProviders(new Set(state.selectedProviders ?? []));
    setSelectedFamilies(new Set(state.selectedFamilies ?? []));
    setSelectedStatuses(new Set(state.selectedStatuses ?? []));
    setOpenOnly(Boolean(state.openOnly));
    setMaxPrice(typeof state.maxPrice === "number" ? state.maxPrice : MAX_PRICE);
    setMaxInputPrice(
      typeof state.maxInputPrice === "number" ? state.maxInputPrice : MAX_INPUT_PRICE,
    );
    setMinContext(
      typeof state.minContext === "number" ? state.minContext : DEFAULT_MIN_CONTEXT,
    );
    setReleaseAfter(state.releaseAfter ?? "");
    setReleaseBefore(state.releaseBefore ?? "");
    setProviderApiFilter(state.providerApiFilter ?? "");
    if (state.sort?.key && (state.sort.direction === "asc" || state.sort.direction === "desc")) {
      setSort(state.sort);
    }
    if (state.visibleColumnKeys && state.visibleColumnKeys.length > 0) {
      setVisibleColumnKeys(new Set(state.visibleColumnKeys));
    }
    if (typeof state.sidebarOpen === "boolean") {
      setSidebarOpen(state.sidebarOpen);
    }
  }, []);

  useEffect(() => {
    function readUrlState() {
      const params = new URLSearchParams(window.location.search);
      return parsePersistedFilterState(params.get("filters"));
    }

    function readLocalState() {
      return parsePersistedFilterState(window.localStorage.getItem(FILTER_STORAGE_KEY));
    }

    applyPersistedState(readUrlState() ?? readLocalState());
    setHasLoadedPersistedFilters(true);

    function handlePopState() {
      applyPersistedState(readUrlState());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyPersistedState]);

  useEffect(() => {
    if (!hasLoadedPersistedFilters) {
      return;
    }

    const state = currentPersistedState();
    const nextUrl = new URL(window.location.href);

    if (hasPersistedValues(state)) {
      const serialized = JSON.stringify(state);
      window.localStorage.setItem(FILTER_STORAGE_KEY, serialized);
      nextUrl.searchParams.set("filters", serialized);
    } else {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
      nextUrl.searchParams.delete("filters");
    }

    window.history.replaceState(null, "", nextUrl);
  }, [
    currentPersistedState,
    hasLoadedPersistedFilters,
  ]);

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

  const { rows, providers, columns, families, statuses, maxContext } = useMemo(
    () => makeRows(payload),
    [payload],
  );
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);
  const visibleColumns = useMemo(() => {
    const selected = [...visibleColumnKeys]
      .map((key) => columnMap.get(key))
      .filter((column): column is ColumnDef => Boolean(column));
    return selected.length > 0 ? selected : columns.slice(0, 1);
  }, [columnMap, columns, visibleColumnKeys]);
  const gridTemplate = visibleColumns.map((column) => `${column.width}px`).join(" ");
  const gridWidth = visibleColumns.reduce((total, column) => total + column.width, 0);
  const activeFilterCount = countActiveFilters({
    q,
    selectedCapabilities,
    selectedInputModalities,
    selectedOutputModalities,
    selectedFamilies,
    selectedStatuses,
    openOnly,
    maxPrice,
    maxInputPrice,
    minContext,
    releaseAfter,
    releaseBefore,
    providerApiFilter,
    selectedProviders,
    columnFilters,
    columnEmptyFilters,
    columnBooleanFilters,
  });

  const filteredRows = useMemo(() => {
    const normalizedQ = q.trim().toLowerCase();
    const normalizedProviderApi = providerApiFilter.trim().toLowerCase();
    const activeColumnFilters = Object.entries(columnFilters)
      .map(([key, value]) => [key, value.trim().toLowerCase()] as const)
      .filter(([, value]) => value);
    const activeEmptyFilters = Object.entries(columnEmptyFilters).filter(
      ([, value]) => value !== "any",
    );
    const activeBooleanFilters = Object.entries(columnBooleanFilters).filter(
      ([, value]) => value !== "any",
    );

    return rows
      .filter((row) => {
        if (normalizedQ && !row.searchText.includes(normalizedQ)) return false;
        if (normalizedProviderApi && !row.providerApi.toLowerCase().includes(normalizedProviderApi)) {
          return false;
        }
        if (selectedProviders.size > 0 && !selectedProviders.has(row.providerId)) return false;
        if (selectedFamilies.size > 0 && !selectedFamilies.has(row.family)) return false;
        if (selectedStatuses.size > 0 && !selectedStatuses.has(row.status)) return false;
        for (const capability of selectedCapabilities) {
          if (!row.capabilities[capability]) return false;
        }
        for (const modality of selectedInputModalities) {
          if (!row.inputModalities.includes(modality)) return false;
        }
        for (const modality of selectedOutputModalities) {
          if (!row.outputModalities.includes(modality)) return false;
        }
        if (openOnly && !row.openWeights) return false;
        if (maxPrice < MAX_PRICE && (row.outputPrice === null || row.outputPrice > maxPrice)) {
          return false;
        }
        if (
          maxInputPrice < MAX_INPUT_PRICE &&
          (row.inputPrice === null || row.inputPrice > maxInputPrice)
        ) {
          return false;
        }
        if (minContext > DEFAULT_MIN_CONTEXT && (row.context === null || row.context < minContext)) {
          return false;
        }
        if (releaseAfter && (!row.releaseDate || row.releaseDate < releaseAfter)) return false;
        if (releaseBefore && (!row.releaseDate || row.releaseDate > releaseBefore)) return false;
        if (
          !activeColumnFilters.every(([key, value]) =>
            (row.values[key] ?? "").toLowerCase().includes(value),
          )
        ) {
          return false;
        }
        if (
          !activeEmptyFilters.every(([key, value]) => {
            const isEmpty = cellIsEmpty(row, key);
            return value === "empty" ? isEmpty : !isEmpty;
          })
        ) {
          return false;
        }
        return activeBooleanFilters.every(([key, value]) => {
          if (value === "empty") {
            return cellIsEmpty(row, key);
          }
          return row.rawValues[key] === (value === "true");
        });
      })
      .sort((a, b) => compareRows(a, b, sort));
  }, [
    columnBooleanFilters,
    columnEmptyFilters,
    columnFilters,
    maxInputPrice,
    maxPrice,
    minContext,
    openOnly,
    providerApiFilter,
    q,
    releaseAfter,
    releaseBefore,
    rows,
    selectedCapabilities,
    selectedFamilies,
    selectedInputModalities,
    selectedOutputModalities,
    selectedProviders,
    selectedStatuses,
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
    setColumnFilters({});
    setColumnEmptyFilters({});
    setColumnBooleanFilters({});
    setSelectedCapabilities(new Set());
    setSelectedInputModalities(new Set());
    setSelectedOutputModalities(new Set());
    setSelectedProviders(new Set());
    setSelectedFamilies(new Set());
    setSelectedStatuses(new Set());
    setOpenOnly(false);
    setMaxPrice(MAX_PRICE);
    setMaxInputPrice(MAX_INPUT_PRICE);
    setMinContext(DEFAULT_MIN_CONTEXT);
    setReleaseAfter("");
    setReleaseBefore("");
    setProviderApiFilter("");
  }

  function showDefaultColumns() {
    setVisibleColumnKeys(new Set(defaultColumnKeys.filter((key) => columnMap.has(key))));
  }

  function showAllColumns() {
    setVisibleColumnKeys(new Set(columns.map((column) => column.key)));
  }

  function toggleColumn(key: string) {
    setVisibleColumnKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <main className={`console-shell ${sidebarOpen ? "" : "rail-hidden"}`}>
      {sidebarOpen ? (
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

          <FacetSection title="modality">
            <div className="facet-subtitle">input</div>
            {modalityOptions.map((modality) => (
              <FacetCheckbox
                checked={selectedInputModalities.has(modality.key)}
                key={`input-${modality.key}`}
                label={modality.label}
                onChange={() =>
                  setSelectedInputModalities((current) => toggleSetValue(current, modality.key))
                }
              />
            ))}
            <div className="facet-subtitle">output</div>
            {modalityOptions.map((modality) => (
              <FacetCheckbox
                checked={selectedOutputModalities.has(modality.key)}
                key={`output-${modality.key}`}
                label={modality.label}
                onChange={() =>
                  setSelectedOutputModalities((current) => toggleSetValue(current, modality.key))
                }
              />
            ))}
          </FacetSection>

          <FacetSection title="identity">
            <FacetCheckbox
              checked={openOnly}
              label="open weights only"
              onChange={() => setOpenOnly((current) => !current)}
            />
            <MiniTextFilter
              label="provider api"
              onChange={setProviderApiFilter}
              placeholder="api contains..."
              value={providerApiFilter}
            />
          </FacetSection>

          <FacetSection title="limits and price">
            <label className="range-filter">
              <span>min context {formatContext(minContext)}</span>
              <input
                max={2_000_000}
                min={DEFAULT_MIN_CONTEXT}
                onChange={(event) => setMinContext(Number(event.target.value))}
                step={8_000}
                type="range"
                value={minContext}
              />
            </label>
            <label className="range-filter">
              <span>
                max input <strong>${trimNumber(maxInputPrice)}</strong> /M
              </span>
              <input
                max={MAX_INPUT_PRICE}
                min={0}
                onChange={(event) => setMaxInputPrice(Number(event.target.value))}
                step={0.25}
                type="range"
                value={maxInputPrice}
              />
            </label>
            <label className="range-filter">
              <span>
                max output <strong>${trimNumber(maxPrice)}</strong> /M
              </span>
              <input
                max={MAX_PRICE}
                min={0.4}
                onChange={(event) => setMaxPrice(Number(event.target.value))}
                step={0.4}
                type="range"
                value={maxPrice}
              />
            </label>
          </FacetSection>

          <FacetSection title="dates">
            <MiniTextFilter
              label="released after"
              onChange={setReleaseAfter}
              placeholder="YYYY-MM-DD"
              value={releaseAfter}
            />
            <MiniTextFilter
              label="released before"
              onChange={setReleaseBefore}
              placeholder="YYYY-MM-DD"
              value={releaseBefore}
            />
          </FacetSection>

          <FacetSection title="families">
            <div className="provider-list">
              {families.slice(0, 80).map((family) => (
                <button
                  className={`provider-filter ${selectedFamilies.has(family) ? "selected" : ""}`}
                  key={family}
                  onClick={() => setSelectedFamilies((current) => toggleSetValue(current, family))}
                  type="button"
                >
                  <span className="provider-dot family-dot" />
                  <span className="provider-name">{family}</span>
                  <span className="provider-count" />
                </button>
              ))}
            </div>
          </FacetSection>

          {statuses.length > 0 ? (
            <FacetSection title="status">
              {statuses.map((status) => (
                <FacetCheckbox
                  checked={selectedStatuses.has(status)}
                  key={status}
                  label={status}
                  onChange={() => setSelectedStatuses((current) => toggleSetValue(current, status))}
                />
              ))}
            </FacetSection>
          ) : null}

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
      ) : null}

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
            <button onClick={() => setSidebarOpen((current) => !current)} type="button">
              {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            </button>
            <ColumnPicker
              columnSearch={columnSearch}
              columns={columns}
              visibleColumnKeys={new Set(visibleColumns.map((column) => column.key))}
              onColumnSearchChange={setColumnSearch}
              onDefault={showDefaultColumns}
              onShowAll={showAllColumns}
              onToggle={toggleColumn}
            />
            <a href={SOURCE_URL} rel="noreferrer" target="_blank">
              Source JSON
            </a>
            <button disabled={isLoading} onClick={loadData} type="button">
              {isLoading ? "Refreshing" : "Refresh"}
            </button>
            <SortPill
              activeSort={sort}
              label="date"
              sortKey="model.release_date"
              onSort={setSort}
            />
            <SortPill
              activeSort={sort}
              label="price"
              sortKey="model.cost.output"
              onSort={setSort}
            />
            <SortPill
              activeSort={sort}
              label="context"
              sortKey="model.limit.context"
              onSort={setSort}
            />
          </div>
        </header>

        {error ? <div className="console-error">{error}</div> : null}

        <div className="results-scroll-x">
          <div className="table-head" style={{ minWidth: `${gridWidth}px` }}>
            <div className="table-header" style={{ gridTemplateColumns: gridTemplate }}>
              {visibleColumns.map((column) => (
                <HeaderButton
                  activeSort={sort}
                  align={column.align}
                  key={column.key}
                  sortKey={column.key}
                  onSort={(key) => setSort(nextSort(sort, key))}
                >
                  {column.label}
                </HeaderButton>
              ))}
            </div>
            <div className="table-filter-row" style={{ gridTemplateColumns: gridTemplate }}>
              {visibleColumns.map((column) => (
                <ColumnFilterControl
                  booleanMode={columnBooleanFilters[column.key] ?? "any"}
                  column={column}
                  emptyMode={columnEmptyFilters[column.key] ?? "any"}
                  key={column.key}
                  textValue={columnFilters[column.key] ?? ""}
                  onBooleanModeChange={(value) =>
                    setColumnBooleanFilters((current) => ({
                      ...current,
                      [column.key]: value,
                    }))
                  }
                  onEmptyModeChange={(value) =>
                    setColumnEmptyFilters((current) => ({
                      ...current,
                      [column.key]: value,
                    }))
                  }
                  onTextChange={(value) =>
                    setColumnFilters((current) => ({
                      ...current,
                      [column.key]: value,
                    }))
                  }
                />
              ))}
            </div>
          </div>

          <div className="table-scroll" ref={tableScrollRef} style={{ minWidth: `${gridWidth}px` }}>
            {filteredRows.length === 0 ? (
              <div className="empty-state">{"// no models match the active query"}</div>
            ) : (
              <div
                className="virtual-space"
                style={{ height: `${rowVirtualizer.getTotalSize()}px`, minWidth: `${gridWidth}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = filteredRows[virtualRow.index];
                  return (
                    <ModelResultRow
                      columns={visibleColumns}
                      gridTemplate={gridTemplate}
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
          <span>columns {visibleColumns.length}</span>
          <span className="updated">{updatedAt ? `fetched ${updatedAt}` : ""}</span>
          <span className="hint">click headers to sort · filters stack</span>
        </footer>
      </section>
    </main>
  );
}
