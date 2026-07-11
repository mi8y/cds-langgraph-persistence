@protocol: 'rest'
service AgentService {
    action invoke(threadId: String, content: String) returns String;
}
