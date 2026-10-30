import { Refrigerator, Snowflake, Warehouse, type LucideProps } from "lucide-react";
import type { StorageLocation } from "@/lib/types";

const ICONS = { fridge: Refrigerator, freezer: Snowflake, pantry: Warehouse } as const;

/** Line icon for a kind of storage spot (fridge, freezer, pantry). Decorative by default. */
export function LocationIcon({ kind, size = 16, ...props }: { kind: StorageLocation["kind"] } & LucideProps) {
  const Icon = ICONS[kind] ?? Warehouse;
  return <Icon size={size} aria-hidden {...props} />;
}
