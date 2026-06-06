import { describe, expect, it } from "vitest";
import { parseRelevantNetworkRequestIds } from "../../../src/shared/networkContext";

describe("Network 相关性筛选回归", () => {
  it("兼容模型把 Chrome HAR 裸编号 ID 返回为 req-N 格式", () => {
    const ids = parseRelevantNetworkRequestIds(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: '{"requestIds":["req-284","req-285","req-306"]}',
              reasoning_content: "模型可能把 Chrome HAR 的请求编号当成 req-N 返回。",
              role: "assistant",
            },
          },
        ],
      }),
      ["284", "285", "306"],
    );

    expect(ids).toEqual(["284", "285", "306"]);
  });
});
