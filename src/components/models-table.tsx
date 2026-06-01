"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  Columns3Icon,
  DatabaseIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldContent, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarInput,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SOURCE_URL = "https://models.dev/api.json";
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
type CostFreeMode = "include" | "exclude" | "only";
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
  minInputPrice?: number;
  maxInputPrice?: number;
  minOutputPrice?: number;
  maxOutputPrice?: number;
  minContext?: number;
  maxContext?: number;
  releaseAfter?: string;
  releaseBefore?: string;
  providerApiFilter?: string;
  sort?: SortState;
  visibleColumnKeys?: string[];
  sidebarOpen?: boolean;
  costFreeFilters?: Record<string, CostFreeMode>;
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

function formatNumberInputValue(value: number | null) {
  return value === null ? "" : String(value);
}

function parseNumberInputValue(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  minInputPrice,
  maxInputPrice,
  minOutputPrice,
  maxOutputPrice,
  minContext,
  maxContextLimit,
  releaseAfter,
  releaseBefore,
  providerApiFilter,
  selectedProviders,
  columnFilters,
  columnEmptyFilters,
  columnBooleanFilters,
  costFreeFilters,
}: {
  q: string;
  selectedCapabilities: ReadonlySet<CapabilityKey>;
  selectedInputModalities: ReadonlySet<ModalityKey>;
  selectedOutputModalities: ReadonlySet<ModalityKey>;
  selectedFamilies: ReadonlySet<string>;
  selectedStatuses: ReadonlySet<string>;
  openOnly: boolean;
  minInputPrice: number | null;
  maxInputPrice: number | null;
  minOutputPrice: number | null;
  maxOutputPrice: number | null;
  minContext: number | null;
  maxContextLimit: number | null;
  releaseAfter: string;
  releaseBefore: string;
  providerApiFilter: string;
  selectedProviders: ReadonlySet<string>;
  columnFilters: Record<string, string>;
  columnEmptyFilters: Record<string, EmptyFilterMode>;
  columnBooleanFilters: Record<string, BooleanFilterMode>;
  costFreeFilters: Record<string, CostFreeMode>;
}) {
  return (
    (q.trim() ? 1 : 0) +
    selectedCapabilities.size +
    selectedInputModalities.size +
    selectedOutputModalities.size +
    selectedFamilies.size +
    selectedStatuses.size +
    (openOnly ? 1 : 0) +
    (minInputPrice !== null ? 1 : 0) +
    (maxInputPrice !== null ? 1 : 0) +
    (minOutputPrice !== null ? 1 : 0) +
    (maxOutputPrice !== null ? 1 : 0) +
    (minContext !== null && minContext > DEFAULT_MIN_CONTEXT ? 1 : 0) +
    (maxContextLimit !== null ? 1 : 0) +
    (releaseAfter ? 1 : 0) +
    (releaseBefore ? 1 : 0) +
    (providerApiFilter.trim() ? 1 : 0) +
    selectedProviders.size +
    Object.values(columnFilters).filter((value) => value.trim()).length +
    Object.values(columnEmptyFilters).filter((value) => value !== "any").length +
    Object.values(columnBooleanFilters).filter((value) => value !== "any").length +
    Object.values(costFreeFilters).filter((value) => value !== "include").length
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
    minInputPrice: state.minInputPrice ?? undefined,
    maxInputPrice: state.maxInputPrice ?? undefined,
    minOutputPrice: state.minOutputPrice ?? undefined,
    maxOutputPrice: state.maxOutputPrice ?? undefined,
    minContext:
      state.minContext !== undefined && state.minContext > DEFAULT_MIN_CONTEXT
        ? state.minContext
        : undefined,
    maxContext: state.maxContext ?? undefined,
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
    costFreeFilters: cleanRecord(state.costFreeFilters, "include"),
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
    <Badge
      className={cn("h-5 rounded-md px-1.5 font-mono text-[10px]", !isOn && "opacity-45")}
      title={label}
      variant={isOn ? "secondary" : "outline"}
    >
      {glyph}
    </Badge>
  );
}

function Bar({ className, value }: { className?: string; value: number }) {
  return (
    <span className="mt-1 block h-1 w-16 overflow-hidden rounded-full bg-muted">
      <span
        className={cn("block h-full rounded-full bg-primary", className)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
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
    <Button
      className={cn(
        "h-auto min-h-10 justify-start whitespace-normal rounded-md px-2 py-1.5 text-left font-mono text-[11px] uppercase leading-tight text-muted-foreground",
        align === "right" && "justify-end text-right",
        active && "text-foreground",
      )}
      onClick={() => onSort(sortKey)}
      size="sm"
      type="button"
      variant="ghost"
    >
      <span className="min-w-0 truncate">{children}</span>
      {active ? (
        activeSort.direction === "asc" ? (
          <ArrowUpIcon data-icon="inline-end" />
        ) : (
          <ArrowDownIcon data-icon="inline-end" />
        )
      ) : null}
    </Button>
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
    <Field orientation="horizontal">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <FieldLabel className="min-w-0 flex-1 cursor-pointer font-mono text-xs text-sidebar-foreground/80">
        {label}
      </FieldLabel>
    </Field>
  );
}

function FacetSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="font-mono uppercase tracking-wide">{title}</SidebarGroupLabel>
      <SidebarGroupContent className="flex flex-col gap-2">{children}</SidebarGroupContent>
    </SidebarGroup>
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
    <Field className="gap-1.5">
      <FieldLabel className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </FieldLabel>
      <Input
        className="h-8 font-mono text-xs"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </Field>
  );
}

function MiniNumberRangeFilter({
  label,
  max,
  maxValue,
  minValue,
  onMaxChange,
  onMinChange,
  step,
  suffix,
}: {
  label: string;
  maxValue: number | null;
  minValue: number | null;
  max?: number;
  onMaxChange: (value: number | null) => void;
  onMinChange: (value: number | null) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <FieldSet className="gap-2">
      <FieldLabel className="font-mono text-[11px] uppercase text-muted-foreground">
        {label}
      </FieldLabel>
      <FieldGroup className="grid grid-cols-2 gap-2">
        <Field className="gap-1">
          <FieldLabel className="font-mono text-[10px] uppercase text-muted-foreground">
            min
          </FieldLabel>
          <Input
            className="h-8 font-mono text-xs"
            min={0}
            max={max}
            onChange={(event) => onMinChange(parseNumberInputValue(event.target.value))}
            placeholder="any"
            step={step}
            type="number"
            value={formatNumberInputValue(minValue)}
          />
        </Field>
        <Field className="gap-1">
          <FieldLabel className="font-mono text-[10px] uppercase text-muted-foreground">
            max
          </FieldLabel>
          <Input
            className="h-8 font-mono text-xs"
            min={0}
            max={max}
            onChange={(event) => onMaxChange(parseNumberInputValue(event.target.value))}
            placeholder="any"
            step={step}
            type="number"
            value={formatNumberInputValue(maxValue)}
          />
        </Field>
      </FieldGroup>
      {suffix ? <div className="font-mono text-[10px] uppercase text-muted-foreground">{suffix}</div> : null}
    </FieldSet>
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
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
        <Columns3Icon data-icon="inline-start" />
        Columns
        <Badge className="ml-1 font-mono" variant="secondary">
          {visibleColumnKeys.size}/{columns.length}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-[min(760px,calc(100vw-2rem))] p-3">
        <DropdownMenuGroup className="flex flex-col gap-3">
          <Field>
            <FieldLabel className="sr-only">Find columns</FieldLabel>
            <Input
              className="font-mono text-xs"
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            onChange={(event) => onColumnSearchChange(event.target.value)}
            placeholder="find columns..."
            type="search"
            value={columnSearch}
          />
          </Field>
          <div className="flex gap-2">
            <Button onClick={onDefault} size="sm" type="button" variant="secondary">
              Default
            </Button>
            <Button onClick={onShowAll} size="sm" type="button" variant="outline">
              Show all
            </Button>
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <div className="grid max-h-[52vh] gap-4 overflow-auto md:grid-cols-3">
          {Object.entries(groups).map(([group, groupColumns]) => (
            <DropdownMenuGroup className="flex flex-col gap-1" key={group}>
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              {groupColumns.map((column) => {
                const checked = visibleColumnKeys.has(column.key);
                const disabled = checked && visibleColumnKeys.size === 1;

                return (
                  <DropdownMenuCheckboxItem
                      checked={checked}
                      disabled={disabled}
                    key={column.key}
                      onChange={() => onToggle(column.key)}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnFilterControl({
  column,
  booleanMode,
  costFreeMode,
  emptyMode,
  textValue,
  onBooleanModeChange,
  onCostFreeModeChange,
  onEmptyModeChange,
  onTextChange,
}: {
  column: ColumnDef;
  booleanMode: BooleanFilterMode;
  costFreeMode: CostFreeMode;
  emptyMode: EmptyFilterMode;
  textValue: string;
  onBooleanModeChange: (value: BooleanFilterMode) => void;
  onCostFreeModeChange: (value: CostFreeMode) => void;
  onEmptyModeChange: (value: EmptyFilterMode) => void;
  onTextChange: (value: string) => void;
}) {
  const isCostColumn = column.key.includes(".cost.");
  const hasTextFilter = Boolean(textValue.trim());
  const hasModeFilter = emptyMode !== "any";
  const hasBooleanFilter = booleanMode !== "any";
  const hasFreeFilter = costFreeMode !== "include";
  const compactColumn = column.width < 125;
  const filterShellClassName =
    "rounded-full border bg-muted/25 shadow-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40";
  const activeShellClassName = "border-primary/60 bg-primary/5";
  const nativeSelectClassName =
    "[&_[data-slot=native-select]]:h-7 [&_[data-slot=native-select]]:rounded-full [&_[data-slot=native-select]]:border-0 [&_[data-slot=native-select]]:bg-transparent [&_[data-slot=native-select]]:px-3 [&_[data-slot=native-select]]:pr-7 [&_[data-slot=native-select]]:font-mono [&_[data-slot=native-select]]:text-[11px] [&_[data-slot=native-select-icon]]:right-2";

  if (column.kind === "boolean") {
    return (
      <div className="pr-2">
        <NativeSelect
          aria-label={`Boolean filter ${column.label}`}
          className={cn(
            "w-full",
            filterShellClassName,
            nativeSelectClassName,
            hasBooleanFilter && activeShellClassName,
          )}
          onChange={(event) => onBooleanModeChange(event.target.value as BooleanFilterMode)}
          size="sm"
          value={booleanMode}
        >
          <NativeSelectOption value="any">any</NativeSelectOption>
          <NativeSelectOption value="true">true</NativeSelectOption>
          <NativeSelectOption value="false">false</NativeSelectOption>
          <NativeSelectOption value="empty">empty</NativeSelectOption>
        </NativeSelect>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1 pr-2">
      <div
        className={cn(
          "flex min-w-0 items-center",
          filterShellClassName,
          (hasTextFilter || hasModeFilter) && activeShellClassName,
        )}
      >
        <InputGroup className="h-8 flex-1 border-0 bg-transparent shadow-none ring-0">
          <InputGroupInput
            aria-label={`Filter ${column.label}`}
            className="h-8 px-1 font-mono text-[12px]"
            onChange={(event) => onTextChange(event.target.value)}
            placeholder=""
            type="search"
            value={textValue}
          />
          <InputGroupAddon align="inline-start" className="pl-2 pr-1">
            <SearchIcon />
          </InputGroupAddon>
          {hasTextFilter ? (
            <InputGroupAddon align="inline-end" className="pl-0 pr-1">
              <InputGroupButton
                aria-label={`Clear filter ${column.label}`}
                onClick={() => onTextChange("")}
                size="icon-xs"
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        <Separator className="h-4" orientation="vertical" />
        <NativeSelect
          aria-label={`Empty filter ${column.label}`}
          className={cn(
            compactColumn ? "w-[58px] shrink-0" : "w-[76px] shrink-0",
            nativeSelectClassName,
            hasModeFilter && "[&_[data-slot=native-select]]:text-foreground",
          )}
          onChange={(event) => onEmptyModeChange(event.target.value as EmptyFilterMode)}
          size="sm"
          value={emptyMode}
        >
          <NativeSelectOption value="any">any</NativeSelectOption>
          <NativeSelectOption value="filled">filled</NativeSelectOption>
          <NativeSelectOption value="empty">empty</NativeSelectOption>
        </NativeSelect>
      </div>
      {isCostColumn ? (
        <NativeSelect
          aria-label={`Free filter ${column.label}`}
          className={cn(
            "w-full",
            filterShellClassName,
            nativeSelectClassName,
            hasFreeFilter && activeShellClassName,
          )}
          onChange={(event) => onCostFreeModeChange(event.target.value as CostFreeMode)}
          size="sm"
          value={costFreeMode}
        >
          <NativeSelectOption value="include">any</NativeSelectOption>
          <NativeSelectOption value="exclude">paid</NativeSelectOption>
          <NativeSelectOption value="only">free</NativeSelectOption>
        </NativeSelect>
      ) : null}
    </div>
  );
}

function MetricCell({
  barClassName,
  barWidth,
  className,
  value,
}: {
  barClassName?: string;
  barWidth: number;
  className?: string;
  value: string;
}) {
  const isNull = value === "null";

  return (
    <div className={cn("flex flex-col items-end pr-2 font-mono tabular-nums", className, isNull && "text-muted-foreground")}>
      <span>{value}</span>
      <Bar className={barClassName} value={barWidth} />
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
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="block size-2 rounded-sm"
          style={{ background: providerColor(row.providerId, row.providerName) }}
        />
        <span className="truncate">{row.providerName}</span>
      </div>
    );
  }

  if (column.key === "model.name") {
    return (
      <div className="flex min-w-0 items-center gap-2 font-medium text-foreground">
        <span className="truncate">{row.modelName}</span>
        {row.openWeights ? (
          <Badge className="h-5 rounded-md px-1.5 font-mono text-[10px]" variant="outline">
            OSS
          </Badge>
        ) : null}
      </div>
    );
  }

  if (column.key === "model.capabilities") {
    return (
      <div className="flex min-w-0 flex-nowrap gap-1">
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
        barWidth={width}
        className="text-primary"
        value={formatContext(row.context)}
      />
    );
  }

  if (column.key === "model.cost.input") {
    return (
      <MetricCell
        barClassName="bg-chart-2"
        barWidth={row.inputPrice === null ? 0 : (row.inputPrice / INPUT_PRICE_SCALE) * 100}
        value={formatPrice(row.inputPrice)}
      />
    );
  }

  if (column.key === "model.cost.output") {
    return (
      <MetricCell
        barClassName="bg-chart-3"
        barWidth={row.outputPrice === null ? 0 : (row.outputPrice / OUTPUT_PRICE_SCALE) * 100}
        value={formatPrice(row.outputPrice)}
      />
    );
  }

  if (column.key.includes(".cost.")) {
    const rawValue = row.rawValues[column.key];
    const value = typeof rawValue === "number" ? rawValue : null;
    return <span className={value === null ? "text-muted-foreground" : ""}>{formatPrice(value)}</span>;
  }

  if (column.key.includes(".limit.")) {
    const rawValue = row.rawValues[column.key];
    const value = typeof rawValue === "number" ? rawValue : null;
    return <span className={value === null ? "text-muted-foreground" : ""}>{formatContext(value)}</span>;
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
      className="absolute left-0 right-0 top-0 grid min-h-[62px] items-center border-b text-xs text-muted-foreground transition-colors hover:bg-muted/50"
      style={{ gridTemplateColumns: gridTemplate, transform: `translateY(${start}px)` }}
    >
      {columns.map((column) => (
        <div
          className={cn(
            "min-w-0 truncate px-2",
            column.align === "right" && "text-right tabular-nums",
            column.key === "model.family" && "text-muted-foreground",
          )}
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
  const [costFreeFilters, setCostFreeFilters] = useState<Record<string, CostFreeMode>>({});
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
  const [minContext, setMinContext] = useState<number | null>(null);
  const [maxContextLimit, setMaxContextLimit] = useState<number | null>(null);
  const [minInputPrice, setMinInputPrice] = useState<number | null>(null);
  const [maxInputPrice, setMaxInputPrice] = useState<number | null>(null);
  const [minOutputPrice, setMinOutputPrice] = useState<number | null>(null);
  const [maxOutputPrice, setMaxOutputPrice] = useState<number | null>(null);
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
      costFreeFilters,
      selectedCapabilities: [...selectedCapabilities],
      selectedInputModalities: [...selectedInputModalities],
      selectedOutputModalities: [...selectedOutputModalities],
      selectedProviders: [...selectedProviders],
      selectedFamilies: [...selectedFamilies],
      selectedStatuses: [...selectedStatuses],
      openOnly,
      minInputPrice: minInputPrice ?? undefined,
      maxInputPrice: maxInputPrice ?? undefined,
      minOutputPrice: minOutputPrice ?? undefined,
      maxOutputPrice: maxOutputPrice ?? undefined,
      minContext: minContext ?? undefined,
      maxContext: maxContextLimit ?? undefined,
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
    costFreeFilters,
    maxContextLimit,
    maxInputPrice,
    maxOutputPrice,
    minInputPrice,
    minContext,
    minOutputPrice,
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
    setCostFreeFilters(state.costFreeFilters ?? {});
    setSelectedCapabilities(new Set(state.selectedCapabilities ?? []));
    setSelectedInputModalities(new Set(state.selectedInputModalities ?? []));
    setSelectedOutputModalities(new Set(state.selectedOutputModalities ?? []));
    setSelectedProviders(new Set(state.selectedProviders ?? []));
    setSelectedFamilies(new Set(state.selectedFamilies ?? []));
    setSelectedStatuses(new Set(state.selectedStatuses ?? []));
    setOpenOnly(Boolean(state.openOnly));
    setMinInputPrice(typeof state.minInputPrice === "number" ? state.minInputPrice : null);
    setMaxInputPrice(typeof state.maxInputPrice === "number" ? state.maxInputPrice : null);
    setMinOutputPrice(typeof state.minOutputPrice === "number" ? state.minOutputPrice : null);
    setMaxOutputPrice(
      typeof state.maxOutputPrice === "number"
        ? state.maxOutputPrice
        : typeof state.maxPrice === "number"
          ? state.maxPrice
          : null,
    );
    setMinContext(typeof state.minContext === "number" ? state.minContext : null);
    setMaxContextLimit(typeof state.maxContext === "number" ? state.maxContext : null);
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
    minInputPrice,
    maxInputPrice,
    minOutputPrice,
    maxOutputPrice,
    minContext,
    maxContextLimit,
    releaseAfter,
    releaseBefore,
    providerApiFilter,
    selectedProviders,
    columnFilters,
    columnEmptyFilters,
    columnBooleanFilters,
    costFreeFilters,
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
    const activeCostFreeFilters = Object.entries(costFreeFilters).filter(
      ([, value]) => value !== "include",
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
        if (minOutputPrice !== null && (row.outputPrice === null || row.outputPrice < minOutputPrice)) {
          return false;
        }
        if (maxOutputPrice !== null && (row.outputPrice === null || row.outputPrice > maxOutputPrice)) {
          return false;
        }
        if (minInputPrice !== null && (row.inputPrice === null || row.inputPrice < minInputPrice)) {
          return false;
        }
        if (maxInputPrice !== null && (row.inputPrice === null || row.inputPrice > maxInputPrice)) {
          return false;
        }
        if (minContext !== null && (row.context === null || row.context < minContext)) {
          return false;
        }
        if (maxContextLimit !== null && (row.context === null || row.context > maxContextLimit)) {
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
        if (
          !activeBooleanFilters.every(([key, value]) => {
            if (value === "empty") {
              return cellIsEmpty(row, key);
            }
            return row.rawValues[key] === (value === "true");
          })
        ) {
          return false;
        }
        return activeCostFreeFilters.every(([key, value]) => {
          const rawValue = row.rawValues[key];
          const isFree = typeof rawValue === "number" && rawValue === 0;
          return value === "only" ? isFree : !isFree;
        });
      })
      .sort((a, b) => compareRows(a, b, sort));
  }, [
    columnBooleanFilters,
    columnEmptyFilters,
    columnFilters,
    costFreeFilters,
    maxContextLimit,
    maxInputPrice,
    maxOutputPrice,
    minInputPrice,
    minContext,
    minOutputPrice,
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

  function clearPersistedFilters() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(FILTER_STORAGE_KEY);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("filters");
    window.history.replaceState(null, "", nextUrl);
  }

  function clearFilters() {
    setQ("");
    setColumnSearch("");
    setColumnFilters({});
    setColumnEmptyFilters({});
    setColumnBooleanFilters({});
    setCostFreeFilters({});
    setSelectedCapabilities(new Set());
    setSelectedInputModalities(new Set());
    setSelectedOutputModalities(new Set());
    setSelectedProviders(new Set());
    setSelectedFamilies(new Set());
    setSelectedStatuses(new Set());
    setOpenOnly(false);
    setMinContext(null);
    setMaxContextLimit(null);
    setMinInputPrice(null);
    setMaxInputPrice(null);
    setMinOutputPrice(null);
    setMaxOutputPrice(null);
    setReleaseAfter("");
    setReleaseBefore("");
    setProviderApiFilter("");
    setSort({ key: "model.release_date", direction: "desc" });
    setVisibleColumnKeys(new Set(defaultColumnKeys.filter((key) => columnMap.has(key))));
    setSidebarOpen(true);
    clearPersistedFilters();
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
    <SidebarProvider
      className="h-svh overflow-hidden bg-background text-foreground"
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={
        {
          "--sidebar-width": "17rem",
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="offcanvas" className="border-sidebar-border">
        <SidebarHeader className="gap-3 border-b border-sidebar-border p-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary font-mono text-sm font-semibold text-primary-foreground">
              md
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-sm font-semibold">models.dev</div>
              <div className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                catalog explorer
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger render={<SidebarTrigger aria-label="Collapse sidebar" />}>
                <PanelLeftIcon />
              </TooltipTrigger>
              <TooltipContent>Toggle sidebar</TooltipContent>
            </Tooltip>
          </div>
          <Field className="gap-1">
            <FieldLabel className="sr-only">Search models</FieldLabel>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                className="pl-8 font-mono text-xs"
                onChange={(event) => setQ(event.target.value)}
                placeholder="filter..."
                type="search"
                value={q}
              />
            </div>
          </Field>
          <Button onClick={clearFilters} size="sm" type="button" variant="outline">
            <SlidersHorizontalIcon data-icon="inline-start" />
            {activeFilterCount > 0
              ? `Clean all filters (${activeFilterCount})`
              : "Clean all filters"}
          </Button>
        </SidebarHeader>

        <SidebarContent>
          <FacetSection title="capabilities">
            <FieldGroup className="gap-2">
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
            </FieldGroup>
          </FacetSection>

          <FacetSection title="modality">
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              input
            </div>
            <FieldGroup className="gap-2">
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
            </FieldGroup>
            <Separator />
            <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              output
            </div>
            <FieldGroup className="gap-2">
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
            </FieldGroup>
          </FacetSection>

          <FacetSection title="identity">
            <Field orientation="horizontal">
              <Switch
                checked={openOnly}
                onCheckedChange={() => setOpenOnly((current) => !current)}
                size="sm"
              />
              <FieldContent>
                <FieldLabel className="font-mono text-xs">open weights only</FieldLabel>
              </FieldContent>
            </Field>
            <MiniTextFilter
              label="provider api"
              onChange={setProviderApiFilter}
              placeholder="api contains..."
              value={providerApiFilter}
            />
          </FacetSection>

          <FacetSection title="limits and price">
            <MiniNumberRangeFilter
              label="context"
              max={maxContext}
              maxValue={maxContextLimit}
              minValue={minContext}
              onMaxChange={setMaxContextLimit}
              onMinChange={setMinContext}
              step={1000}
              suffix="tokens"
            />
            <MiniNumberRangeFilter
              label="input price"
              maxValue={maxInputPrice}
              minValue={minInputPrice}
              onMaxChange={setMaxInputPrice}
              onMinChange={setMinInputPrice}
              step={0.01}
              suffix="$/M"
            />
            <MiniNumberRangeFilter
              label="output price"
              maxValue={maxOutputPrice}
              minValue={minOutputPrice}
              onMaxChange={setMaxOutputPrice}
              onMinChange={setMinOutputPrice}
              step={0.01}
              suffix="$/M"
            />
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
            <div className="flex max-h-44 flex-col gap-1 overflow-auto pr-1">
              {families.slice(0, 80).map((family) => {
                const selected = selectedFamilies.has(family);

                return (
                  <Button
                    className={cn("h-7 justify-start px-2 font-mono text-xs", selected && "bg-sidebar-accent text-sidebar-accent-foreground")}
                    key={family}
                    onClick={() => setSelectedFamilies((current) => toggleSetValue(current, family))}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <span className="block size-2 rounded-sm bg-muted-foreground/50" />
                    <span className="min-w-0 flex-1 truncate text-left">{family}</span>
                  </Button>
                );
              })}
            </div>
          </FacetSection>

          {statuses.length > 0 ? (
            <FacetSection title="status">
              <FieldGroup className="gap-2">
                {statuses.map((status) => (
                  <FacetCheckbox
                    checked={selectedStatuses.has(status)}
                    key={status}
                    label={status}
                    onChange={() =>
                      setSelectedStatuses((current) => toggleSetValue(current, status))
                    }
                  />
                ))}
              </FieldGroup>
            </FacetSection>
          ) : null}

          <FacetSection title="providers">
            <div className="flex max-h-52 flex-col gap-1 overflow-auto pr-1">
              {providers.map((provider) => {
                const selected = selectedProviders.has(provider.id);
                const color = providerColor(provider.id, provider.name);

                return (
                  <Button
                    className={cn("h-7 justify-start px-2 font-mono text-xs", selected && "bg-sidebar-accent text-sidebar-accent-foreground")}
                    key={provider.id}
                    onClick={() =>
                      setSelectedProviders((current) => toggleSetValue(current, provider.id))
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <span className="block size-2 rounded-sm" style={{ background: color }} />
                    <span className="min-w-0 flex-1 truncate text-left">{provider.name}</span>
                    <Badge className="h-5 rounded-md px-1.5 font-mono" variant="secondary">
                      {provider.count}
                    </Badge>
                  </Button>
                );
              })}
            </div>
          </FacetSection>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex min-h-20 flex-col gap-3 border-b bg-background/95 p-3 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger />
            <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-sm text-muted-foreground">
              <Badge className="font-mono" variant="default">
                {filteredRows.length}
              </Badge>
              <span>models</span>
              <span>/</span>
              <span>{rows.length}</span>
              <Separator className="h-4" orientation="vertical" />
              <span>{activeFilterCount} active filters</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ColumnPicker
              columnSearch={columnSearch}
              columns={columns}
              visibleColumnKeys={new Set(visibleColumns.map((column) => column.key))}
              onColumnSearchChange={setColumnSearch}
              onDefault={showDefaultColumns}
              onShowAll={showAllColumns}
              onToggle={toggleColumn}
            />
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={SOURCE_URL}
              rel="noreferrer"
              target="_blank"
            >
              <DatabaseIcon data-icon="inline-start" />
              Source JSON
            </a>
            <Button disabled={isLoading} onClick={loadData} size="sm" type="button" variant="outline">
              {isLoading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              {isLoading ? "Refreshing" : "Refresh"}
            </Button>
            <ModeToggle />
          </div>
        </header>

        {error ? (
          <div className="border-b border-destructive/30 bg-destructive/10 px-5 py-2 font-mono text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-x-auto overflow-y-hidden">
          <div className="sticky top-0 z-10 border-b bg-background" style={{ minWidth: `${gridWidth}px` }}>
            <div className="grid min-h-16 items-center px-3" style={{ gridTemplateColumns: gridTemplate }}>
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
            <div
              className="grid min-h-20 items-start border-t bg-muted/10 px-3 py-3"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {visibleColumns.map((column) => (
                <ColumnFilterControl
                  booleanMode={columnBooleanFilters[column.key] ?? "any"}
                  column={column}
                  costFreeMode={costFreeFilters[column.key] ?? "include"}
                  emptyMode={columnEmptyFilters[column.key] ?? "any"}
                  key={column.key}
                  textValue={columnFilters[column.key] ?? ""}
                  onBooleanModeChange={(value) =>
                    setColumnBooleanFilters((current) => ({
                      ...current,
                      [column.key]: value,
                    }))
                  }
                  onCostFreeModeChange={(value) =>
                    setCostFreeFilters((current) => ({
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

          <div
            className="min-h-0 overflow-x-hidden overflow-y-auto"
            ref={tableScrollRef}
            style={{ minWidth: `${gridWidth}px` }}
          >
            {filteredRows.length === 0 ? (
              <Empty className="h-full min-h-72 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchIcon />
                  </EmptyMedia>
                  <EmptyTitle>No models match</EmptyTitle>
                  <EmptyDescription>Clear or loosen the active filters.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div
                className="relative min-w-0"
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

        <footer className="flex min-h-10 items-center gap-4 overflow-x-auto whitespace-nowrap border-t bg-background px-5 py-2 font-mono text-[11px] text-muted-foreground">
          <Badge className="font-mono" variant="secondary">
            READY
          </Badge>
          <span>rows {filteredRows.length}</span>
          <span>
            sort {sort.key} {sort.direction}
          </span>
          <span>columns {visibleColumns.length}</span>
          <span className="min-w-0 truncate">{updatedAt ? `fetched ${updatedAt}` : ""}</span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
