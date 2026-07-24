import { CdsCheckpointSaver } from "@mi8y/cds-langgraph-persistence";
import { OrchestrationClient } from "@sap-ai-sdk/langchain";
import cds from "@sap/cds";
import { createAgent, humanInTheLoopMiddleware } from "langchain";
import { getBooks } from "./lib/tools.js";

export class AgentService extends cds.ApplicationService {
  init() {
    const agentName = "my-book-agent";

    // agent 'checkpointer' configuration
    const checkpointSaver = new CdsCheckpointSaver({
      name: agentName,
      ttl: 30 * 1000, // 30 seconds - for production use higher value for retention policies (e.g. 30 days)
    });

    // 'agent' configuration
    const agent = createAgent({
      systemPrompt: `
        You are a helpful assistant that can answer questions about books and authors.
        You must only use the tool - 'get_books' to answer questions.
      `,
      model: new OrchestrationClient({
        promptTemplating: {
          model: {
            name: "anthropic--claude-4.6-sonnet",
          },
        },
      }),
      tools: [getBooks],
      middleware: [
        humanInTheLoopMiddleware({
          interruptOn: {
            // get_books: {
            //   allowedDecisions: ["approve", "reject"],
            //   description: "Approve or reject the get_books tool call",
            // },
          },
        }),
      ],
      checkpointer: checkpointSaver,
    });

    // handle the 'invoke' event to process user requests
    this.on("invoke", async (req) => {
      const { threadId, content } = req.data;
      if (!threadId || !content) {
        req.reject(400, "Missing threadId or content");
      }

      // langgraph graph configuration for the agent
      const config = {
        configurable: {
          // use a unique threadId for each user to maintain separate conversation threads
          // this is what controls how checkpoints are managed
          thread_id: `${req.user.id}-${threadId}`,
        },
      };

      // invoke the agent
      const res = await agent.invoke(
        { messages: [{ role: "user", content }] },
        config,
      );

      return res.messages[res.messages.length - 1].content;
    });

    return super.init();
  }
}
