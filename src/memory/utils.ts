/* eslint-disable @typescript-eslint/no-explicit-any */
import { StoreItem } from "#cds-models/plugin/langgraph/persistence";
import { Item } from "@langchain/langgraph-checkpoint";

export function mapNamespaceToCds(namespace: string[]): string {
  return namespace.join(":");
}

export function mapNamespaceFromCds(namespace: string): string[] {
  return namespace.split(":");
}

export function mapStoreItemFromCds(storeItem: StoreItem): Item {
  const values: Record<string, any> =
    storeItem.values?.reduce((acc: Record<string, any>, field) => {
      if (field.name) {
        acc[field.name] = field.value;
      }
      return acc;
    }, {}) ?? {};
  return {
    createdAt: new Date(storeItem.createdAt!),
    updatedAt: new Date(storeItem.modifiedAt!),
    namespace: mapNamespaceFromCds(storeItem.namespace!),
    key: storeItem.id!,
    value: values,
  } as Item;
}

export function mapStoreItemToCds(
  item: Omit<Item, "createdAt" | "updatedAt">,
): StoreItem {
  const values = Object.entries(item.value ?? {}).map(([name, value]) => ({
    name,
    value,
  }));
  return {
    id: item.key,
    namespace: mapNamespaceToCds(item.namespace),
    values,
  } as StoreItem;
}

export function mapFilterToCds(
  filter: Record<string, any>,
): Record<string, any> {
  const cdsFilter: Record<string, any> = {};

  for (const [key, value] of Object.entries(filter)) {
    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      if (keys.length === 1) {
        const operator = keys[0];
        const operatorValue = value[operator];
        switch (operator) {
          case "$eq":
            cdsFilter[key] = operatorValue;
            break;
          case "$ne":
            cdsFilter[key] = { "<>": operatorValue };
            break;
          case "$gt":
            cdsFilter[key] = { ">": operatorValue };
            break;
          case "$gte":
            cdsFilter[key] = { ">=": operatorValue };
            break;
          case "$lt":
            cdsFilter[key] = { "<": operatorValue };
            break;
          case "$lte":
            cdsFilter[key] = { "<=": operatorValue };
            break;
          default:
            throw new Error(`Unsupported operator: ${operator}`);
        }
      }
    } else {
      cdsFilter[key] = value;
    }
  }

  return cdsFilter;
}
