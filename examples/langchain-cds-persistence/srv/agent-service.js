import cds from "@sap/cds";
import { createAgent, tool } from "langchain";
import { OrchestrationClient } from "@sap-ai-sdk/langchain";
import { CdsCheckpointSaver } from "@mi8y/cds-langgraph-persistence";
import * as z from "zod";

export class AgentService extends cds.ApplicationService {
  init() {
    // agent 'system prompt' configuration
    const systemPrompt = `
      You are a helpful assistant that can answer questions about books and authors.
      You must only use the tool - 'get_books' to answer questions.
    `;

    // agent 'tools' configuration
    const getBooks = tool(
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

    // agent 'model' configuration
    const model = new OrchestrationClient({
      promptTemplating: {
        model: {
          name: "anthropic--claude-4.6-sonnet",
        },
      },
    });

    // agent 'checkpointer' configuration
    const checkpointSaver = new CdsCheckpointSaver({ id: "agent" });

    // 'agent' configuration
    const agent = createAgent({
      systemPrompt: systemPrompt,
      model: model,
      tools: [getBooks],
      checkpointer: checkpointSaver,
    });

    this.on("invoke", async (req) => {
      const { threadId, content } = req.data;
      if (!threadId) {
        req.reject(400, "Missing threadId");
      }
      if (!content) {
        req.reject(400, "Missing content");
      }

      // invoke the agent
      const res = await agent.invoke(
        { messages: [{ role: "user", content }] },
        {
          configurable: {
            // use a unique threadId for each user to maintain separate conversation threads
            // this is what controls how checkpoints are managed
            thread_id: `${threadId}-${req.user.id}`,
          },
        },
      );

      return res.messages[res.messages.length - 1].content;
    });

    return super.init();
  }
}
