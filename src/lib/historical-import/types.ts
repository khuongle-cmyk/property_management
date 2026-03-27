export type ImportType = "revenue" | "costs" | "invoices" | "occupancy";
export type DuplicateMode = "skip" | "overwrite" | "merge";
export type DataSource = "manual" | "excel" | "accounting_software" | "procountor_tuloslaskelma";

export type ParsedRow = Record<string, unknown>;

export const IMPORT_TYPES: ImportType[] = ["revenue", "costs", "invoices", "occupancy"];

export const SOFTWARE_PRESETS = ["generic", "procountor", "netvisor", "visma"] as const;
export type SoftwarePreset = (typeof SOFTWARE_PRESETS)[number];
