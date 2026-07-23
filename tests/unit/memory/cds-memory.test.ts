/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  StoreItems,
  StoreItemFields,
} from "#cds-models/plugin/langgraph/persistence";
import { CdsMemoryStore } from "@/memory/cds-memory";
import { InvalidNamespaceError } from "@langchain/langgraph-checkpoint";
import cds from "@sap/cds";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("CdsMemoryStore", () => {
  let store: CdsMemoryStore;

  beforeAll(async () => {
    const csn = await cds.load("index.cds").then(cds.minify);
    cds.model = cds.compile.for.nodejs(csn);

    cds.requires.db = {
      kind: "sqlite",
      impl: "@cap-js/sqlite",
      credentials: { url: ":memory:" },
    };

    cds.db = await cds.connect.to("db");

    // @ts-ignore
    await cds.deploy("index.cds", {}).to(cds.db);
  });

  afterAll(async () => {
    // @ts-ignore
    await cds.db.disconnect?.();
  });

  beforeEach(async () => {
    store = new CdsMemoryStore();
    await DELETE.from(StoreItems);
    await DELETE.from(StoreItemFields);
  });

  it("should implement get method", async () => {
    await store.put(["test"], "123", { value: 1 });
    const result = await store.get(["test"], "123");
    expect(result).toEqual({
      value: { value: 1 },
      key: "123",
      namespace: ["test"],
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("should implement search method", async () => {
    await store.put(["test"], "123", { value: 1 });
    await store.put(["test"], "456", { value: 2 });
    const result = await store.search(["test"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      value: { value: 1 },
      key: "123",
      namespace: ["test"],
    });
    expect(result[1]).toMatchObject({
      value: { value: 2 },
      key: "456",
      namespace: ["test"],
    });
  });

  it("should implement put method", async () => {
    await store.put(["test"], "123", { value: 1 });
    const result = await store.get(["test"], "123");
    expect(result).toMatchObject({
      value: { value: 1 },
      key: "123",
      namespace: ["test"],
    });
  });

  it("should implement delete method", async () => {
    await store.put(["test"], "123", { value: 1 });
    await store.delete(["test"], "123");
    const result = await store.get(["test"], "123");
    expect(result).toBeNull();
  });

  it("should implement listNamespaces method", async () => {
    await store.put(["a", "b", "c"], "1", { value: 1 });
    await store.put(["a", "b", "d"], "2", { value: 2 });
    await store.put(["x", "y", "z"], "3", { value: 3 });

    const result = await store.listNamespaces({});
    expect(result).toEqual([
      ["a", "b", "c"],
      ["a", "b", "d"],
      ["x", "y", "z"],
    ]);
  });

  it("should filter namespaces by prefix", async () => {
    await store.put(["a", "b", "c"], "1", { value: 1 });
    await store.put(["a", "b", "d"], "2", { value: 2 });
    await store.put(["x", "y", "z"], "3", { value: 3 });

    const result = await store.listNamespaces({ prefix: ["a"] });
    expect(result).toEqual([
      ["a", "b", "c"],
      ["a", "b", "d"],
    ]);
  });

  it("should apply maxDepth to listNamespaces results", async () => {
    await store.put(["a", "b", "c"], "1", { value: 1 });
    await store.put(["a", "b", "d"], "2", { value: 2 });
    await store.put(["x", "y", "z"], "3", { value: 3 });

    const result = await store.listNamespaces({ maxDepth: 2 });
    expect(result).toEqual([
      ["a", "b"],
      ["x", "y"],
    ]);
  });

  it("Should block invalid namespaces in put", async () => {
    const doc = { foo: "bar" };

    // Test invalid namespaces
    await expect(store.put([], "foo", doc)).rejects.toThrow(
      InvalidNamespaceError,
    );
    await expect(store.put(["the", "thing.about"], "foo", doc)).rejects.toThrow(
      InvalidNamespaceError,
    );
    await expect(store.put(["some", "fun", ""], "foo", doc)).rejects.toThrow(
      InvalidNamespaceError,
    );
    await expect(store.put(["langgraph", "foo"], "bar", doc)).rejects.toThrow(
      InvalidNamespaceError,
    );

    await store.put(["foo", "langgraph", "foo"], "bar", doc);
    const result = await store.get(["foo", "langgraph", "foo"], "bar");
    expect(result?.value).toEqual(doc);

    const searchResult = await store.search(["foo", "langgraph", "foo"]);
    expect(searchResult[0].value).toEqual(doc);

    await store.delete(["foo", "langgraph", "foo"], "bar");
    const deletedResult = await store.get(["foo", "langgraph", "foo"], "bar");
    expect(deletedResult).toBeNull();

    await store.batch([
      { namespace: ["langgraph", "foo"], key: "bar", value: doc },
    ]);
    const batchResult = await store.get(["langgraph", "foo"], "bar");
    expect(batchResult?.value).toEqual(doc);

    const batchSearchResult = await store.search(["langgraph", "foo"]);
    expect(batchSearchResult[0].value).toEqual(doc);

    await store.delete(["langgraph", "foo"], "bar");
    const batchDeletedResult = await store.get(["langgraph", "foo"], "bar");
    expect(batchDeletedResult).toBeNull();
  });
});
