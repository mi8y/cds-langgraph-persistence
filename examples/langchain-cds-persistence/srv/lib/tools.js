import { tool } from "langchain";
import cds from "@sap/cds";
import * as z from "zod";

export const getBooks = tool(
  async (input) => {
    const { author } = input;

    // construct a query against the InfoService to get the list of books and authors
    const InfoService = await cds.connect.to("InfoService");
    const { Books } = InfoService.entities;
    let query = SELECT.from(Books);
    if (author) {
      // if author is provided, filter by author
      query = query.where({ author });
    }

    const res = await query;
    return res;
  },
  {
    name: "get_books",
    description: "Gets the list of books and authors",
    schema: z.object({
      author: z.string().optional().describe("Author name"),
    }),
  },
);
