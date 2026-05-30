import { compressHtmlForAutomation, runSandboxExtractionCode } from "./sandboxExtraction";

type SandboxRequest =
  | {
      type: "automation.sandbox.extract";
      requestId: string;
      html: string;
      code: string;
    }
  | {
      type: "automation.sandbox.compressHtml";
      requestId: string;
      html: string;
    };

window.addEventListener("message", (event: MessageEvent<SandboxRequest>) => {
  if (event.origin === "null" || !event.origin.startsWith("chrome-extension://")) {
    return;
  }

  const request = event.data;
  if (!request || typeof request !== "object" || typeof request.requestId !== "string") {
    return;
  }

  if (request.type === "automation.sandbox.extract") {
    event.source?.postMessage(
      {
        type: "automation.sandbox.result",
        requestId: request.requestId,
        ...runSandboxExtractionCode({ html: request.html, code: request.code }),
      },
      { targetOrigin: event.origin },
    );
    return;
  }

  if (request.type === "automation.sandbox.compressHtml") {
    event.source?.postMessage(
      {
        type: "automation.sandbox.result",
        requestId: request.requestId,
        ok: true,
        html: compressHtmlForAutomation(request.html),
      },
      { targetOrigin: event.origin },
    );
  }
});
