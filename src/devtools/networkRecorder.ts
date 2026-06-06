import type { NetworkHeader, NetworkRequestDetail, NetworkRequestMeta } from "../shared/types";
import { truncateText } from "../shared/utils/text";

type DevtoolsHeader = { name?: string; value?: string };
type DevtoolsHarEntry = {
  _requestId?: string;
  _resourceType?: string;
  startedDateTime?: string;
  time?: number;
  request?: {
    url?: string;
    method?: string;
    headers?: DevtoolsHeader[];
    postData?: { text?: string };
  };
  response?: {
    status?: number;
    statusText?: string;
    headers?: DevtoolsHeader[];
    content?: { mimeType?: string };
  };
};
type DevtoolsNetworkRequest = DevtoolsHarEntry & {
  getContent?: (callback: (content: string, encoding: string) => void) => void;
};

type BrokerMessage = {
  type: "networkContext.getDetails";
  rpcId: string;
  requestIds: string[];
};

interface CachedRequest {
  meta: NetworkRequestMeta;
  request?: DevtoolsNetworkRequest;
}

const MAX_FIELD_LENGTH = 12000;
const RECONNECT_DELAY_MS = 1000;
const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
const requestsById = new Map<string, CachedRequest>();
let port: chrome.runtime.Port | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let requestSequence = 0;

connectBroker();

function connectBroker(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  const nextPort = chrome.runtime.connect({ name: "network.devtools" });
  port = nextPort;

  nextPort.onMessage.addListener((message: BrokerMessage) => {
    if (message.type !== "networkContext.getDetails") {
      return;
    }

    void collectDetails(message.requestIds).then((details) => {
      postToBroker({
        type: "networkContext.detailsResponse",
        rpcId: message.rpcId,
        response: {
          ok: true,
          details,
        },
      });
    });
  });

  nextPort.onDisconnect.addListener(() => {
    if (port !== nextPort) {
      return;
    }

    port = undefined;
    scheduleReconnect();
  });

  refreshCurrentHar();
}

function scheduleReconnect(): void {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(connectBroker, RECONNECT_DELAY_MS);
}

chrome.devtools.network.onRequestFinished.addListener((request) => {
  cacheRequest(request as DevtoolsNetworkRequest, request as DevtoolsNetworkRequest);
  notifySnapshotUpdated();
});

chrome.devtools.network.onNavigated.addListener(() => {
  requestsById.clear();
  refreshCurrentHar();
});

function refreshCurrentHar(): void {
  chrome.devtools.network.getHAR((harLog) => {
    refreshFromHar(harLog.entries as DevtoolsHarEntry[]);
  });
}

function refreshFromHar(entries: DevtoolsHarEntry[]): void {
  for (const entry of entries) {
    cacheRequest(entry);
  }
  notifyConnected();
}

function cacheRequest(entry: DevtoolsHarEntry, request?: DevtoolsNetworkRequest): void {
  const id = createRequestId(entry);
  requestsById.set(id, {
    meta: createMeta(id, entry),
    request,
  });
}

function createRequestId(entry: DevtoolsHarEntry): string {
  return entry._requestId || `req-${requestSequence++}-${entry.startedDateTime ?? Date.now()}-${entry.request?.method ?? "GET"}-${entry.request?.url ?? ""}`;
}

function createMeta(id: string, entry: DevtoolsHarEntry): NetworkRequestMeta {
  return {
    id,
    url: entry.request?.url ?? "",
    method: entry.request?.method ?? "GET",
    status: entry.response?.status,
    statusText: entry.response?.statusText,
    mimeType: entry.response?.content?.mimeType,
    resourceType: entry._resourceType,
    startedAt: entry.startedDateTime,
    durationMs: typeof entry.time === "number" ? Math.round(entry.time) : undefined,
    requestHeaders: normalizeHeaders(entry.request?.headers),
    responseHeaders: normalizeHeaders(entry.response?.headers),
    requestBody: truncateOptional(entry.request?.postData?.text),
    failed: entry.response?.status === 0,
  };
}

async function collectDetails(requestIds: string[]): Promise<NetworkRequestDetail[]> {
  const details: NetworkRequestDetail[] = [];
  for (const requestId of requestIds) {
    const cached = requestsById.get(requestId);
    if (!cached) {
      continue;
    }

    const content = await readResponseContent(cached.request);
    details.push({
      ...cached.meta,
      responseBody: truncateOptional(content?.content),
      responseBodyEncoding: content?.encoding,
      truncated: Boolean(cached.meta.requestBody && cached.meta.requestBody.length >= MAX_FIELD_LENGTH) || Boolean(content?.truncated),
      redacted: false,
    });
  }
  return details;
}

function readResponseContent(request: DevtoolsNetworkRequest | undefined): Promise<{ content: string; encoding: string; truncated: boolean } | undefined> {
  const getContent = request?.getContent;
  if (!getContent) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    getContent((content, encoding) => {
      const truncated = truncateText(content ?? "", MAX_FIELD_LENGTH);
      resolve({ content: truncated.text, encoding, truncated: truncated.truncated });
    });
  });
}

function normalizeHeaders(headers: DevtoolsHeader[] | undefined): NetworkHeader[] | undefined {
  if (!headers?.length) {
    return undefined;
  }

  return headers
    .filter((header): header is { name: string; value: string } => typeof header.name === "string" && typeof header.value === "string")
    .map((header) => ({ name: header.name, value: truncateText(header.value, MAX_FIELD_LENGTH).text }));
}

function truncateOptional(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return truncateText(value, MAX_FIELD_LENGTH).text;
}

function getSnapshot(): NetworkRequestMeta[] {
  return Array.from(requestsById.values()).map((cached) => cached.meta);
}

function notifyConnected(): void {
  postToBroker({
    type: "networkContext.devtoolsConnected",
    tabId: inspectedTabId,
    requests: getSnapshot(),
  });
}

function notifySnapshotUpdated(): void {
  postToBroker({
    type: "networkContext.snapshotUpdated",
    tabId: inspectedTabId,
    requests: getSnapshot(),
  });
}

function postToBroker(message: unknown): void {
  if (!port) {
    scheduleReconnect();
    return;
  }

  try {
    port.postMessage(message);
  } catch {
    port = undefined;
    scheduleReconnect();
  }
}
