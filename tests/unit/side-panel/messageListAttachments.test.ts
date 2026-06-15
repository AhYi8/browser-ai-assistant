import { describe, expect, it } from "vitest";
import { aggregateDisplayAttachmentsByKind } from "../../../src/side-panel/components/MessageList";
import type { ChatJsSourceToolAttachment } from "../../../src/shared/types";

function createJsSourceAttachment(partial: Partial<ChatJsSourceToolAttachment>): ChatJsSourceToolAttachment {
  return {
    id: "attachment-js",
    kind: "js-source",
    title: "JS 源码片段",
    summary: "JS 资源 1 个",
    createdAt: 1,
    redacted: true,
    truncated: false,
    resources: [],
    jsMatches: [],
    contexts: [],
    failedFetches: [],
    ...partial,
  };
}

describe("MessageList 工具附件展示聚合", () => {
  it("同一气泡下多个 JS 源码附件聚合后仍保留结构化数据", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createJsSourceAttachment({
        id: "attachment-js-a",
        resources: [
          {
            id: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        jsMatches: [
          {
            resourceId: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            term: "sign",
            position: 10,
            line: 1,
            column: 11,
            snippet: "function sign(){}",
            redacted: true,
            truncated: false,
          },
        ],
      }),
      createJsSourceAttachment({
        id: "attachment-js-b",
        createdAt: 2,
        truncated: true,
        resources: [
          {
            id: "script-b",
            source: "same-origin-fetch",
            url: "https://example.com/b.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        contexts: [
          {
            resourceId: "script-b",
            source: "same-origin-fetch",
            url: "https://example.com/b.js",
            position: 20,
            line: 2,
            column: 5,
            snippet: "const token = \"[已脱敏]\"",
            redacted: true,
            truncated: true,
          },
        ],
        failedFetches: [{ url: "https://example.com/missing.js", message: "同源 JS 补位读取失败。" }],
      }),
    ]);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      kind: "js-source",
      id: "message-display-js-source-attachment-js-a-attachment-js-b",
      truncated: true,
      resources: [
        expect.objectContaining({ id: "script-a" }),
        expect.objectContaining({ id: "script-b" }),
      ],
      jsMatches: [expect.objectContaining({ resourceId: "script-a" })],
      contexts: [expect.objectContaining({ resourceId: "script-b" })],
      failedFetches: [expect.objectContaining({ message: "同源 JS 补位读取失败。" })],
    });
    expect(attachments[0]).not.toHaveProperty("details");
  });
  it("聚合 JS 源码附件时会基于去重后的结构重新生成摘要", () => {
    const attachments = aggregateDisplayAttachmentsByKind([
      createJsSourceAttachment({
        id: "attachment-js-a",
        summary: "旧摘要 A",
        resources: [
          {
            id: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        jsMatches: [
          {
            resourceId: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            term: "sign",
            position: 10,
            line: 1,
            column: 11,
            snippet: "function sign(){}",
            redacted: true,
            truncated: false,
          },
        ],
      }),
      createJsSourceAttachment({
        id: "attachment-js-b",
        summary: "旧摘要 B",
        resources: [
          {
            id: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            size: 1,
            searchable: true,
            redacted: true,
            truncated: false,
          },
        ],
        jsMatches: [
          {
            resourceId: "script-a",
            source: "network",
            url: "https://example.com/a.js",
            term: "sign",
            position: 10,
            line: 1,
            column: 11,
            snippet: "function sign(){}",
            redacted: true,
            truncated: false,
          },
        ],
      }),
    ]);

    expect(attachments[0]).toMatchObject({
      kind: "js-source",
      summary: "JS 资源 1 个，命中 1 个，上下文 0 个，补位失败 0 个。",
    });
  });
});
