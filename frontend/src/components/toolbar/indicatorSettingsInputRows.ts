import type { PineInputDefinition } from "@/services/pineRuntimeTypes";

export interface IndicatorInputRow {
  key: string;
  inline: string | null;
  fields: PineInputDefinition[];
}

export interface IndicatorInputGroup {
  name: string | null;
  rows: IndicatorInputRow[];
}

export function groupIndicatorInputRows(
  fields: PineInputDefinition[],
): IndicatorInputGroup[] {
  const groups: IndicatorInputGroup[] = [];

  for (const field of fields) {
    const name = field.group ?? null;
    const currentGroup = groups[groups.length - 1];
    const group =
      currentGroup && currentGroup.name === name
        ? currentGroup
        : { name, rows: [] };

    if (group !== currentGroup) {
      groups.push(group);
    }

    const inline = field.inline?.trim() || null;
    const currentRow = group.rows[group.rows.length - 1];
    if (inline && currentRow?.inline === inline) {
      currentRow.fields.push(field);
      continue;
    }

    group.rows.push({
      key: inline ? `${name ?? "default"}:${inline}:${field.key}` : field.key,
      inline,
      fields: [field],
    });
  }

  return groups;
}
