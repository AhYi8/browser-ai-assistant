import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectHtmlAssetReferences, createBuildInfo, createPackagedManifest, ensureHtmlAssetReferences, removeJunkFiles, shouldExcludeFromPackage } from "./package-extension.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

describe("本地扩展打包脚本", () => {
  it("保留当前 dist 加载路径，不改写为 Chrome Web Store 发布专用结构", () => {
    const manifest = createPackagedManifest({
      manifest_version: 3,
      side_panel: { default_path: "index.html" },
      content_scripts: [{ matches: ["<all_urls>"], js: ["content/index.js"] }],
    });

    expect(manifest.side_panel.default_path).toBe("index.html");
    expect(manifest.content_scripts).toEqual([{ matches: ["<all_urls>"], js: ["content/index.js"] }]);
  });

  it("打包时排除测试文件，避免发布产物混入开发验证代码", () => {
    expect(shouldExcludeFromPackage("src/background/index.test.ts")).toBe(true);
    expect(shouldExcludeFromPackage("tests/unit/background/index.test.ts")).toBe(true);
    expect(shouldExcludeFromPackage("tests")).toBe(true);
    expect(shouldExcludeFromPackage("src/__tests__")).toBe(true);
    expect(shouldExcludeFromPackage("src/background/index.ts")).toBe(false);
  });

  it("检查 HTML 中引用的相对资源是否存在", async () => {
    const packageRoot = await mkdir(join(tmpdir(), `browser-ai-package-${Date.now()}`), { recursive: true });
    if (!packageRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    await mkdir(join(packageRoot, "assets"), { recursive: true });
    await writeFile(join(packageRoot, "index.html"), '<script src="./sidePanel.js"></script><script src="./assets/index-abc.js"></script><link href="/assets/index-def.css"><img src="https://example.com/logo.png">', "utf8");
    await writeFile(join(packageRoot, "sidePanel.js"), "", "utf8");
    await writeFile(join(packageRoot, "assets", "index-abc.js"), "", "utf8");

    expect(collectHtmlAssetReferences(await readFile(join(packageRoot, "index.html"), "utf8"))).toEqual(["assets/index-abc.js", "assets/index-def.css", "sidePanel.js"]);
    await expect(ensureHtmlAssetReferences(packageRoot, ["index.html"])).rejects.toThrow("index.html -> assets/index-def.css");
  });

  it("拒绝跳出打包目录的 HTML 资源引用", async () => {
    const tempRoot = await mkdir(join(tmpdir(), `browser-ai-package-traversal-${Date.now()}`), { recursive: true });
    if (!tempRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    const packageRoot = join(tempRoot, "package");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(tempRoot, "outside.js"), "", "utf8");
    await writeFile(join(packageRoot, "index.html"), '<script src="assets/../../outside.js"></script>', "utf8");

    await expect(ensureHtmlAssetReferences(packageRoot, ["index.html"])).rejects.toThrow("index.html -> assets/../../outside.js");
  });

  it("清理复制后残留的测试文件和空测试目录", async () => {
    const packageRoot = await mkdir(join(tmpdir(), `browser-ai-package-clean-${Date.now()}`), { recursive: true });
    if (!packageRoot) {
      throw new Error("无法创建临时打包目录。");
    }

    await mkdir(join(packageRoot, "assets"), { recursive: true });
    await mkdir(join(packageRoot, "tests"), { recursive: true });
    await writeFile(join(packageRoot, "tests", "index.test.js"), "", "utf8");
    await writeFile(join(packageRoot, "assets", ".DS_Store"), "", "utf8");

    await removeJunkFiles(packageRoot, packageRoot);

    await expect(stat(join(packageRoot, "tests"))).rejects.toThrow();
    await expect(stat(join(packageRoot, "assets", ".DS_Store"))).rejects.toThrow();
    await expect(stat(join(packageRoot, "assets"))).resolves.toBeTruthy();
  });

  it("生成可追踪的构建信息", () => {
    const buildInfo = createBuildInfo({ name: "browser-ai-assistant", version: "0.1.0" }, new Date("2026-06-14T00:00:00.000Z"));

    expect(buildInfo).toEqual({
      name: "browser-ai-assistant",
      version: "0.1.0",
      builtAt: "2026-06-14T00:00:00.000Z",
    });
  });

  it("项目声明本地打包命令，但不声明 Chrome Web Store 发布命令", async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["package:extension"]).toBe("npm run build:extension && node scripts/package-extension.mjs");
    expect(packageJson.scripts["check:package"]).toBe("vitest run scripts/package-extension.test.ts && npm run package:extension");
    expect(packageJson.scripts.check).toContain("npm run check:package");
    expect(packageJson.scripts["publish:chrome-webstore"]).toBeUndefined();
    await expect(stat(join(projectRoot, ".env.chrome-webstore.example"))).rejects.toThrow();
  });
});
