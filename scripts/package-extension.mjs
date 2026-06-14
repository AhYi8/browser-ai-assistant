// @ts-check
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const packageDir = path.join(rootDir, "artifacts", "chrome-extension");

const requiredDistPaths = [
  "manifest.json",
  "index.html",
  "devtools.html",
  "background/index.js",
  "content/index.js",
];

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
export function shouldExcludeFromPackage(relativePath) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  return /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(normalizedPath) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalizedPath);
}

/**
 * 当前项目本地安装直接加载 dist 目录；本地打包只复制 dist，不改写运行时入口。
 * @template {Record<string, unknown>} T
 * @param {T} manifest
 * @returns {T}
 */
export function createPackagedManifest(manifest) {
  return manifest;
}

/**
 * @param {string} html
 * @returns {string[]}
 */
export function collectHtmlAssetReferences(html) {
  const references = new Set();
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/g;

  for (const match of html.matchAll(attributePattern)) {
    const reference = match[1].split(/[?#]/)[0].replace(/^\/+/, "").replace(/^\.\//, "");
    if (isLocalPackagedReference(match[1], reference)) {
      references.add(reference);
    }
  }

  return [...references].sort();
}

/**
 * @param {string} packageRoot
 * @param {string} assetReference
 * @returns {string | undefined}
 */
function resolvePackagedReference(packageRoot, assetReference) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const resolvedReference = path.resolve(resolvedPackageRoot, assetReference);
  const relativeReference = path.relative(resolvedPackageRoot, resolvedReference);
  if (relativeReference.startsWith("..") || path.isAbsolute(relativeReference)) {
    return undefined;
  }
  return resolvedReference;
}

/**
 * @param {string} rawReference
 * @param {string} normalizedReference
 * @returns {boolean}
 */
function isLocalPackagedReference(rawReference, normalizedReference) {
  if (!normalizedReference) return false;
  if (rawReference.startsWith("#")) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(rawReference)) return false;
  if (/^(?:data|blob|mailto|tel|chrome|chrome-extension):/i.test(rawReference)) return false;
  return !normalizedReference.startsWith("../");
}

/**
 * @param {string} packageRoot
 * @param {string[]} htmlRelativePaths
 */
export async function ensureHtmlAssetReferences(packageRoot, htmlRelativePaths) {
  const missingReferences = [];

  for (const htmlRelativePath of htmlRelativePaths) {
    const html = await readFile(path.join(packageRoot, htmlRelativePath), "utf8");
    for (const assetReference of collectHtmlAssetReferences(html)) {
      const resolvedReference = resolvePackagedReference(packageRoot, assetReference);
      if (!resolvedReference) {
        missingReferences.push(`${htmlRelativePath} -> ${assetReference}`);
        continue;
      }
      try {
        await stat(resolvedReference);
      } catch {
        missingReferences.push(`${htmlRelativePath} -> ${assetReference}`);
      }
    }
  }

  if (missingReferences.length > 0) {
    throw new Error(["扩展打包产物缺少 HTML 引用资源：", ...missingReferences.map((item) => `- ${item}`)].join("\n"));
  }
}

/**
 * @param {{ name?: string, version?: string }} packageJson
 * @param {Date} [builtAt]
 */
export function createBuildInfo(packageJson, builtAt = new Date()) {
  return {
    name: packageJson.name ?? "browser-ai-assistant",
    version: packageJson.version ?? "0.0.0",
    builtAt: builtAt.toISOString(),
  };
}

/**
 * @param {string} relativePath
 */
async function ensureDistPathExists(relativePath) {
  try {
    await stat(path.join(rootDir, "dist", relativePath));
  } catch {
    throw new Error(`缺少扩展构建产物：dist/${relativePath}。请先运行 npm run build:extension。`);
  }
}

/**
 * @param {string} directory
 * @param {string} [baseDirectory]
 */
export async function removeJunkFiles(directory, baseDirectory = packageDir) {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeJunkFiles(entryPath, baseDirectory);
        if (shouldExcludeFromPackage(path.relative(baseDirectory, entryPath))) {
          await rm(entryPath, { recursive: true, force: true });
        }
        return;
      }
      if (entry.name === ".DS_Store" || shouldExcludeFromPackage(path.relative(baseDirectory, entryPath))) {
        await rm(entryPath, { force: true });
      }
    }),
  );
}

async function writePackagedManifest() {
  const manifest = JSON.parse(await readFile(path.join(rootDir, "dist", "manifest.json"), "utf8"));
  await writeFile(path.join(packageDir, "manifest.json"), `${JSON.stringify(createPackagedManifest(manifest), null, 2)}\n`, "utf8");
}

async function main() {
  for (const relativePath of requiredDistPaths) {
    await ensureDistPathExists(relativePath);
  }

  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });
  await cp(path.join(rootDir, "dist"), packageDir, {
    recursive: true,
    filter: (sourcePath) => !shouldExcludeFromPackage(path.relative(path.join(rootDir, "dist"), sourcePath)),
  });

  await writePackagedManifest();
  await removeJunkFiles(packageDir);
  await ensureHtmlAssetReferences(packageDir, ["index.html", "devtools.html"]);

  const packageJson = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  await writeFile(path.join(packageDir, "build-info.json"), `${JSON.stringify(createBuildInfo(packageJson), null, 2)}\n`, "utf8");
  console.log(`本地扩展打包产物已生成：${path.relative(rootDir, packageDir)}`);
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
