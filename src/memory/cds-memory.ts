import {
  GetOperation,
  IndexConfig,
  Item,
  ListNamespacesOperation,
  Operation,
  OperationResults,
  PutOperation,
  SearchItem,
  SearchOperation,
} from "@langchain/langgraph-checkpoint";
import { BaseStore } from "@langchain/langgraph-checkpoint";
import { StoreItems } from "#cds-models/plugin/langgraph/persistence";
import * as utils from "./utils";

export type CdsMemorySaverConfig = {
  index?: IndexConfig;
};

export class CdsMemoryStore extends BaseStore {
  protected params: CdsMemorySaverConfig;

  constructor(params?: CdsMemorySaverConfig) {
    super();
    this.params = params ?? {};
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async batch<Op extends readonly Operation[]>(
    operations: Op,
  ): Promise<OperationResults<Op>> {
    const results: unknown[] = [];

    for (const operation of operations) {
      if ("namespacePrefix" in operation) {
        results.push(await this.searchOperation(operation as SearchOperation));
      } else if ("key" in operation && !("value" in operation)) {
        results.push(await this.getOperation(operation as GetOperation));
      } else if ("value" in operation) {
        if (operation.value !== null) {
          results.push(await this.putOperation(operation as PutOperation));
        } else {
          await this.deleteOperation(operation as PutOperation);
        }
      } else if ("matchConditions" in operation) {
        results.push(
          await this.listNamespacesOperation(
            operation as ListNamespacesOperation,
          ),
        );
      } else {
        throw new Error(
          `Unsupported operation type: ${JSON.stringify(operation)}`,
        );
      }
    }

    return results as OperationResults<Op>;
  }

  private async getOperation({
    key,
    namespace,
  }: GetOperation): Promise<Item | null> {
    const namespaceKey = utils.mapNamespaceToCds(namespace);
    const storeItem = await SELECT.one
      .from(StoreItems)
      .columns((c) => {
        c.id;
        c.namespace;
        c.createdAt;
        c.modifiedAt;
        c.values((v) => {
          v.name;
          v.value;
        });
      })
      .where({
        namespace: namespaceKey,
        id: key,
      });
    return storeItem ? utils.mapStoreItemFromCds(storeItem) : null;
  }

  private async searchOperation({
    namespacePrefix,
    filter,
    limit,
    offset,
    query,
  }: SearchOperation): Promise<SearchItem[]> {
    const namespacePrefixKey = utils.mapNamespaceToCds(namespacePrefix);
    let cdsQuery = SELECT.from(StoreItems)
      .columns((c) => {
        c.id;
        c.namespace;
        c.createdAt;
        c.modifiedAt;
        c.values((v) => {
          v.name;
          v.value;
        });
      })
      .where({
        namespace: { like: `${namespacePrefixKey}%` },
      })
      .limit(limit ?? 10, offset ?? 0)
      .orderBy("createdAt desc");

    if (filter) {
      const cdsFilter = utils.mapFilterToCds(filter);
      cdsQuery = cdsQuery.where({
        ...cdsQuery.where,
        ...cdsFilter,
      });
    }

    if (query) {
      // @ts-expect-error: The cdsQuery.search method is not recognized by TypeScript, but it exists in the underlying implementation.
      cdsQuery = cdsQuery.search({
        "values.value": query,
      });
    }

    const items = await cdsQuery;

    return items.map(utils.mapStoreItemFromCds);
  }

  private async putOperation({
    key,
    namespace,
    value,
  }: PutOperation): Promise<void> {
    await UPSERT.into(StoreItems).entries(
      utils.mapStoreItemToCds({
        key: key,
        namespace: namespace,
        value: value ?? {},
      }),
    );
  }

  private async listNamespacesOperation({
    matchConditions,
    maxDepth,
    limit,
    offset,
  }: ListNamespacesOperation): Promise<string[][]> {
    let cdsQuery = SELECT.distinct
      .from(StoreItems)
      .columns((c) => {
        c.namespace;
      })
      .orderBy("namespace")
      .limit(limit ?? 100, offset ?? 0);

    // Add match conditions
    if (matchConditions && matchConditions.length > 0) {
      for (const condition of matchConditions) {
        if (condition.matchType === "prefix") {
          const prefixNamespaces = utils.mapNamespaceToCds(condition.path);
          cdsQuery = cdsQuery.where({
            ...cdsQuery.where,
            namespace: { like: `${prefixNamespaces}%` },
          });
        } else if (condition.matchType === "suffix") {
          const suffixNamespaces = utils.mapNamespaceToCds(condition.path);
          cdsQuery = cdsQuery.where({
            ...cdsQuery.where,
            namespace: { like: `%${suffixNamespaces}` },
          });
        }
      }
    }

    const items = await cdsQuery;

    // collect namespaces and filter by maxDepth if provided
    const namespaces = items
      .map((result) =>
        result.namespace ? utils.mapNamespaceFromCds(result.namespace) : null,
      )
      .filter((ns) => {
        if (!ns) return false;
        if (maxDepth) return ns.length <= maxDepth;
        return true;
      });

    return namespaces as string[][];
  }

  private async deleteOperation({
    key,
    namespace,
  }: GetOperation): Promise<void> {
    const namespaceKey = utils.mapNamespaceToCds(namespace);
    await DELETE.from(StoreItems).where({
      namespace: namespaceKey,
      id: key,
    });
  }
}
