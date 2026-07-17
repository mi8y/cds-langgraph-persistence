/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  StoreItem,
  StoreItemField,
} from "#cds-models/plugin/langgraph/persistence";
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
      if (field.name && field.value !== null && field.value !== undefined) {
        acc[field.name] = JSON.parse(field.value);
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
  item: Omit<Item, "createdAt" | "updatedAt" | "value">,
): StoreItem {
  return {
    id: item.key,
    namespace: mapNamespaceToCds(item.namespace),
  } as StoreItem;
}

export function mapStoreItemFieldsToCds(
  fields: Record<string, any>,
  namespaceKey: string,
  key: string,
): StoreItemField[] {
  return Object.entries(fields).map(
    ([name, value]) =>
      ({
        name,
        value: JSON.stringify(value),
        item_namespace: namespaceKey,
        item_id: key,
      }) as StoreItemField,
  );
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
