import { useState } from "react";
import type { McpServerConfig } from "../../../shared/types";
import { useAppStore } from "../../state/appStore";
import { useComposedTextInput } from "../useComposedTextInput";

interface McpServerDraft {
  id?: string;
  name: string;
  endpointUrl: string;
  bearerToken: string;
  enabled: boolean;
}

const EMPTY_DRAFT: McpServerDraft = {
  name: "",
  endpointUrl: "",
  bearerToken: "",
  enabled: true,
};

export function McpToolSettings() {
  const mcpSettings = useAppStore((state) => state.mcpSettings);
  const mcpBearerTokens = useAppStore((state) => state.mcpBearerTokens);
  const updateMcpServer = useAppStore((state) => state.updateMcpServer);
  const deleteMcpServer = useAppStore((state) => state.deleteMcpServer);
  const refreshMcpServerTools = useAppStore((state) => state.refreshMcpServerTools);
  const [draft, setDraft] = useState<McpServerDraft>(EMPTY_DRAFT);
  const [message, setMessage] = useState("");
  const [expandedToolServerIds, setExpandedToolServerIds] = useState<string[]>([]);
  const nameInput = useComposedTextInput(draft.name, (name) => setDraft((current) => ({ ...current, name })));
  const endpointInput = useComposedTextInput(draft.endpointUrl, (endpointUrl) => setDraft((current) => ({ ...current, endpointUrl })));
  const tokenInput = useComposedTextInput(draft.bearerToken, (bearerToken) => setDraft((current) => ({ ...current, bearerToken })));

  const editServer = (server: McpServerConfig) => {
    setDraft({
      id: server.id,
      name: server.name,
      endpointUrl: server.endpointUrl,
      bearerToken: mcpBearerTokens[server.id] ?? "",
      enabled: server.enabled,
    });
    setMessage("");
  };
  const saveDraft = async () => {
    const result = await updateMcpServer(draft.id, draft);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }

    setDraft(EMPTY_DRAFT);
    setMessage("MCP Server 已保存");
  };
  const handleDeleteServer = async (serverId: string) => {
    if (!window.confirm("确认删除这个 MCP Server 吗？")) {
      return;
    }

    await deleteMcpServer(serverId);
    setMessage("");
  };
  const toggleToolList = (serverId: string) => {
    setExpandedToolServerIds((current) =>
      current.includes(serverId) ? current.filter((id) => id !== serverId) : [...current, serverId],
    );
  };

  return (
    <section className="grid w-full gap-4" aria-label="MCP 工具">
      <h3 className="text-base font-semibold">MCP 工具</h3>
      <p className="ui-muted text-xs">MVP 仅支持 HTTP/Streamable HTTP MCP Tools。启用 Server 和具体工具后，模型可直接调用。</p>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          名称
          <input className="ui-input" aria-label="MCP Server 名称" {...nameInput} />
        </label>
        <label className="grid gap-1 text-sm">
          Endpoint URL
          <input className="ui-input" aria-label="MCP Server 地址" placeholder="http://127.0.0.1:3000/mcp" {...endpointInput} />
        </label>
        <label className="grid gap-1 text-sm">
          Bearer Token
          <input className="ui-input" aria-label="MCP Bearer Token" type="password" {...tokenInput} />
        </label>
        <label className="chat-preference-switch">
          <input
            className="chat-preference-switch-input"
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span className="chat-preference-switch-control" aria-hidden="true">
            <span className="chat-preference-switch-thumb" />
          </span>
          <span className="chat-preference-switch-label">启用 MCP Server</span>
        </label>
        <div className="chat-preference-tool-bulk-actions">
          <button className="ui-button-primary" type="button" onClick={() => void saveDraft()}>
            {draft.id ? "保存 MCP Server" : "新增 MCP Server"}
          </button>
          {draft.id ? (
            <button className="ui-button-secondary" type="button" onClick={() => setDraft(EMPTY_DRAFT)}>
              取消编辑
            </button>
          ) : null}
        </div>
        {message ? <p className="text-sm text-[var(--color-warning)]">{message}</p> : null}
      </div>
      <div className="chat-preference-tool-group-list">
        {mcpSettings.servers.length === 0 ? <p className="ui-muted text-xs">暂无 MCP Server</p> : null}
        {mcpSettings.servers.map((server) => {
          const toolListExpanded = expandedToolServerIds.includes(server.id);
          return (
            <article key={server.id} className="mcp-server-card">
              <div className="mcp-server-card-header">
                <div className="mcp-server-card-title-block">
                  <div className="chat-preference-tool-group-title">{server.name}</div>
                  <p className="ui-muted text-xs">{server.endpointUrl}</p>
                  {server.lastRefreshError ? <p className="text-xs text-[var(--color-error)]">{server.lastRefreshError}</p> : null}
                  <p className="ui-muted text-xs">已发现工具：{server.tools.length}</p>
                </div>
                <div className="chat-preference-tool-bulk-actions">
                  <button className="ui-button-secondary" type="button" onClick={() => editServer(server)}>编辑</button>
                  <button className="ui-button-secondary" type="button" onClick={() => void refreshMcpServerTools(server.id)}>刷新工具</button>
                  <button className="ui-button-secondary" type="button" onClick={() => void handleDeleteServer(server.id)}>删除</button>
                  <button
                    className="ui-button-secondary"
                    type="button"
                    aria-expanded={toolListExpanded}
                    aria-controls={`mcp-tool-list-${server.id}`}
                    onClick={() => toggleToolList(server.id)}
                  >
                    {toolListExpanded ? "收起工具列表" : "工具列表"}
                  </button>
                </div>
              </div>
              {toolListExpanded ? (
                <section id={`mcp-tool-list-${server.id}`} className="mcp-server-tool-list" aria-label={`${server.name} 工具列表`}>
                  {server.tools.length > 0 ? (
                    server.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="mcp-server-tool-item"
                        title={tool.description ? `${tool.name} · ${tool.description}` : tool.name}
                      >
                        <span className="mcp-server-tool-item-title">{tool.name}</span>
                        {tool.description ? <span className="mcp-server-tool-item-description">{tool.description}</span> : null}
                      </div>
                    ))
                  ) : (
                    <p className="ui-muted text-xs">暂无已发现工具</p>
                  )}
                </section>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
