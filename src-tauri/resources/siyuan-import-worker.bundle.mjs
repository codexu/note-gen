// scripts/siyuan-import-worker.mjs
import readline from "node:readline";

// src/lib/import/siyuan/budgets.ts
var MAX_IMPORT_DOCUMENTS = 5e4;
var MAX_IMPORT_TOTAL_NODES = 5e6;
var MAX_IMPORT_TOTAL_DOCUMENT_BYTES = 2 * 1024 * 1024 * 1024;
var MAX_AV_TABLE_ROWS = 5e3;
var MAX_AV_TABLE_COLUMNS = 100;
var MAX_AV_MARKDOWN_BYTES = 512 * 1024;
var SyImportAbortedError = class extends Error {
  constructor() {
    super("Import cancelled");
    this.name = "SyImportAbortedError";
  }
};
var SyImportBudgetExceededError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SyImportBudgetExceededError";
  }
};
function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new SyImportAbortedError();
  }
}
function countNodes(nodes) {
  if (!nodes?.length) {
    return 0;
  }
  let count = 0;
  for (const node of nodes) {
    count += 1;
    count += countNodes(node.Children);
  }
  return count;
}
function countDocumentNodes(document) {
  return 1 + countNodes(document.Children);
}
var ImportBudgetTracker = class {
  constructor() {
    this.documentCount = 0;
    this.totalNodes = 0;
    this.totalDocumentBytes = 0;
  }
  trackDocument(document, byteSize) {
    this.documentCount += 1;
    this.totalNodes += countDocumentNodes(document);
    this.totalDocumentBytes += byteSize;
    if (this.documentCount > MAX_IMPORT_DOCUMENTS) {
      throw new SyImportBudgetExceededError(
        `SiYuan import exceeds the document limit (${MAX_IMPORT_DOCUMENTS}).`
      );
    }
    if (this.totalNodes > MAX_IMPORT_TOTAL_NODES) {
      throw new SyImportBudgetExceededError(
        `SiYuan import exceeds the block limit (${MAX_IMPORT_TOTAL_NODES}).`
      );
    }
    if (this.totalDocumentBytes > MAX_IMPORT_TOTAL_DOCUMENT_BYTES) {
      throw new SyImportBudgetExceededError(
        `SiYuan import exceeds the in-memory document budget (${MAX_IMPORT_TOTAL_DOCUMENT_BYTES} bytes).`
      );
    }
  }
};

// scripts/tauri-fs-shim.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { open as fsOpen } from "node:fs/promises";
async function toDirEntry(entryPath, name) {
  const stats = await fs.lstat(entryPath);
  return {
    name,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    isSymlink: stats.isSymbolicLink()
  };
}
function createReadWriteHandle(fileHandle) {
  return {
    async read(buffer) {
      const result = await fileHandle.read(buffer, 0, buffer.length);
      if (result.bytesRead === 0) {
        return null;
      }
      return result.bytesRead;
    },
    async write(data) {
      const result = await fileHandle.write(data);
      return result.bytesWritten;
    },
    async close() {
      await fileHandle.close();
    }
  };
}
async function exists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}
async function lstat(targetPath) {
  const stats = await fs.lstat(targetPath);
  return {
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    isSymlink: stats.isSymbolicLink(),
    size: stats.size
  };
}
async function stat(targetPath) {
  return lstat(targetPath);
}
async function mkdir(targetPath, options = {}) {
  await fs.mkdir(targetPath, { recursive: Boolean(options.recursive) });
}
async function readDir(targetPath) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  return Promise.all(entries.map((entry) => toDirEntry(path.join(targetPath, entry.name), entry.name)));
}
async function readTextFile(targetPath) {
  return fs.readFile(targetPath, "utf8");
}
async function remove(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}
async function open(targetPath, options = {}) {
  const flag = options.createNew ? "wx" : options.write ? "w" : "r";
  const fileHandle = await fsOpen(targetPath, flag);
  return createReadWriteHandle(fileHandle);
}

// scripts/tauri-path-shim.mjs
import path2 from "node:path";
function join(...segments) {
  return path2.join(...segments);
}
function dirname(filePath) {
  return path2.dirname(filePath);
}
function basename(filePath) {
  return path2.basename(filePath);
}

// src/lib/import/siyuan/utils.ts
var INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
var WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
var SIYUAN_ASSET_ROOTS = /* @__PURE__ */ new Set(["assets", "emojis", "public"]);
var MAX_FILENAME_CODE_POINTS = 120;
var MAX_FILENAME_UTF8_BYTES = 255;
function decodeBase64(value) {
  if (!value) {
    return "";
  }
  try {
    return atob(value);
  } catch {
    return value;
  }
}
function truncateFileNameComponent(value, maxUtf8Bytes = MAX_FILENAME_UTF8_BYTES) {
  const codePoints = [...value];
  let result = "";
  for (const codePoint of codePoints) {
    if (result.length >= MAX_FILENAME_CODE_POINTS) {
      break;
    }
    const next = `${result}${codePoint}`;
    if (new TextEncoder().encode(next).length > maxUtf8Bytes) {
      break;
    }
    result = next;
  }
  return result.replace(/[. ]+$/, "");
}
function sanitizeFileNameCore(name, fallback) {
  const sanitized = name.normalize("NFC").trim().replace(INVALID_FILENAME_CHARS, "_").replace(/[. ]+$/, "");
  const candidate = sanitized || fallback.replace(INVALID_FILENAME_CHARS, "_").replace(/[. ]+$/, "");
  if (!candidate) {
    return "untitled";
  }
  const normalized = WINDOWS_RESERVED_FILENAME.test(candidate) ? `_${candidate}` : candidate;
  return normalized.startsWith(".") ? `_${normalized.slice(1)}` : normalized;
}
function sanitizeFileName(name, fallback) {
  return truncateFileNameComponent(sanitizeFileNameCore(name, fallback)) || "untitled";
}
function buildFileNameBase(name, fallback, reservedSuffixBytes) {
  const maxBaseBytes = Math.max(1, MAX_FILENAME_UTF8_BYTES - reservedSuffixBytes);
  return truncateFileNameComponent(
    sanitizeFileNameCore(name, fallback),
    maxBaseBytes
  ) || "untitled";
}
async function hasSiYuanNotebookMarker(notebookDir) {
  const confPath = await join(notebookDir, ".siyuan", "conf.json");
  if (!await exists(confPath)) {
    return false;
  }
  const confInfo = await lstat(confPath);
  if (!confInfo.isFile || confInfo.isSymlink) {
    return false;
  }
  try {
    const conf = JSON.parse(await readTextFile(confPath));
    return typeof conf.name === "string" && conf.name.trim().length > 0;
  } catch {
    return false;
  }
}
function isDocumentId(name) {
  return /^\d{14}-[a-z0-9]{6,8}$/.test(name.replace(/\.sy$/, ""));
}
var SIYUAN_BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{6,8}$/i;
function isSafeSiYuanBlockId(value) {
  return typeof value === "string" && SIYUAN_BLOCK_ID_PATTERN.test(value);
}
function resolveSafeBlockAnchor(node) {
  if (isSafeSiYuanBlockId(node.ID)) {
    return node.ID;
  }
  if (isSafeSiYuanBlockId(node.Properties?.id)) {
    return node.Properties.id;
  }
  return null;
}
function escapeMarkdownTableCell(value) {
  return escapeMarkdownText(value.replace(/\n/g, " ")).trim();
}
var SIYUAN_INVISIBLE_CHAR_RE = /[\u200B-\u200D\uFEFF]/g;
function stripSiYuanInvisibleChars(value) {
  return value.replace(SIYUAN_INVISIBLE_CHAR_RE, "");
}
function escapeMarkdownText(value) {
  return stripSiYuanInvisibleChars(value).replace(/([\\`*_[\]{}<>#>+\-|])/g, "\\$1");
}
function escapeMarkdownLinkText(value) {
  return escapeMarkdownText(value);
}
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (next < 56320 || next > 57343) {
        return false;
      }
      index += 1;
      continue;
    }
    if (code >= 56320 && code <= 57343) {
      return false;
    }
  }
  return true;
}
function encodeMarkdownLinkDestination(value) {
  if (!isWellFormedUnicode(value)) {
    return null;
  }
  try {
    return encodeURI(value).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/</g, "%3C").replace(/>/g, "%3E");
  } catch {
    return null;
  }
}
function encodeMarkdownPath(value) {
  if (!isWellFormedUnicode(value)) {
    return null;
  }
  try {
    return value.replace(/\\/g, "/").split("/").map((segment) => {
      if (segment === "." || segment === ".." || segment === "") {
        return segment;
      }
      return encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29");
    }).join("/");
  } catch {
    return null;
  }
}
function toRelativeWorkspacePath(fromFilePath, toPath) {
  const fromSegments = fromFilePath.replace(/\\/g, "/").split("/");
  fromSegments.pop();
  const toSegments = toPath.replace(/\\/g, "/").split("/");
  let commonPrefixLength = 0;
  while (commonPrefixLength < fromSegments.length && commonPrefixLength < toSegments.length && fromSegments[commonPrefixLength] === toSegments[commonPrefixLength]) {
    commonPrefixLength += 1;
  }
  const upwardSegments = new Array(fromSegments.length - commonPrefixLength).fill("..");
  const downwardSegments = toSegments.slice(commonPrefixLength);
  return [...upwardSegments, ...downwardSegments].join("/") || ".";
}
function decodePathComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
function getSiYuanAssetRootFromPath(pathPart) {
  const normalized = pathPart.replace(/\\/g, "/").replace(/^\.\//, "");
  const firstSegment = normalized.split("/")[0];
  if (!firstSegment) {
    return null;
  }
  const decodedRoot = decodePathComponent(firstSegment) ?? firstSegment;
  const root = decodedRoot.toLowerCase();
  return SIYUAN_ASSET_ROOTS.has(root) ? root : null;
}
function isSiYuanAssetReferenceCandidate(value) {
  const pathPart = value.trim().split(/[?#]/, 1)[0];
  return getSiYuanAssetRootFromPath(pathPart) !== null;
}
function parseSiYuanAssetReference(value) {
  const trimmed = value.trim();
  const suffixIndex = trimmed.search(/[?#]/);
  const encodedPathPart = suffixIndex >= 0 ? trimmed.slice(0, suffixIndex) : trimmed;
  const decodedPathPart = decodePathComponent(encodedPathPart);
  if (decodedPathPart === null) {
    return null;
  }
  const pathPart = decodedPathPart.replace(/\\/g, "/").replace(/^\.\//, "");
  const suffix = suffixIndex >= 0 ? trimmed.slice(suffixIndex) : "";
  if (!pathPart || pathPart.startsWith("/") || /^[a-z]:/i.test(pathPart) || pathPart.includes("\0")) {
    return null;
  }
  const segments = pathPart.split("/");
  if (segments.length < 2 || !SIYUAN_ASSET_ROOTS.has(segments[0]) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return {
    sourcePath: segments.join("/"),
    suffix
  };
}
function isSafeRelativeLinkReference(value) {
  const trimmed = value.trim();
  const pathPart = trimmed.split(/[?#]/, 1)[0];
  if (!pathPart) {
    return true;
  }
  const decodedPath = decodePathComponent(pathPart);
  if (decodedPath === null) {
    return false;
  }
  const normalized = decodedPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.includes("\0")) {
    return false;
  }
  return normalized.split("/").every((segment) => segment !== "..");
}
function getNoteGenAssetOutputDir(mdRelativePath, assetsDirName = "assets") {
  const normalized = mdRelativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  const markdownDir = segments.join("/");
  const dirName = assetsDirName.trim() || "assets";
  return markdownDir ? `${markdownDir}/${dirName}` : dirName;
}
function getImportedAssetRelativePath(sourcePath, assetOutputDir) {
  const normalizedSource = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const base = assetOutputDir.replace(/\\/g, "/").replace(/\/$/, "");
  const assetReference = parseSiYuanAssetReference(normalizedSource);
  const resolvedSource = assetReference?.sourcePath ?? normalizedSource;
  if (resolvedSource.startsWith("assets/")) {
    return `${base}/${resolvedSource.slice("assets/".length)}`;
  }
  if (resolvedSource.startsWith("emojis/")) {
    return `${base}/${resolvedSource}`;
  }
  if (resolvedSource.startsWith("public/")) {
    return `${base}/${resolvedSource.slice("public/".length)}`;
  }
  return `${base}/${resolvedSource}`;
}
var SIYUAN_DATA_SUBDIRS = /* @__PURE__ */ new Set([
  "assets",
  "storage",
  "templates",
  "widgets",
  "plugins",
  "emojis",
  "snippets",
  "public"
]);
var ImportPathAllocator = class {
  constructor(targetDir) {
    this.usedRelativePaths = /* @__PURE__ */ new Set();
    this.targetDir = targetDir;
  }
  pathKey(relativePath) {
    return relativePath.replace(/\\/g, "/").replace(/^\/|\/$/g, "").normalize("NFC").toLocaleLowerCase("en-US");
  }
  reserveRelativePath(relativePath) {
    const normalized = this.pathKey(relativePath);
    if (normalized) {
      this.usedRelativePaths.add(normalized);
    }
  }
  allocateRelativeDir(parentRelativePath, desiredName) {
    const parent = parentRelativePath.replace(/\\/g, "/").replace(/\/$/, "");
    let suffix = 0;
    while (true) {
      const suffixPart = suffix === 0 ? "" : `-${suffix}`;
      const candidate = `${buildFileNameBase(
        desiredName,
        desiredName,
        new TextEncoder().encode(suffixPart).length
      )}${suffixPart}`;
      const relativePath = parent ? `${parent}/${candidate}` : candidate;
      if (!this.usedRelativePaths.has(this.pathKey(relativePath))) {
        this.usedRelativePaths.add(this.pathKey(relativePath));
        return relativePath;
      }
      suffix += 1;
    }
  }
  allocateRelativeFile(parentRelativePath, desiredName) {
    const parent = parentRelativePath.replace(/\\/g, "/").replace(/\/$/, "");
    const cleanedName = desiredName.replace(/\.md$/i, "");
    let suffix = 0;
    while (true) {
      const suffixPart = suffix === 0 ? ".md" : `-${suffix}.md`;
      const candidate = `${buildFileNameBase(
        cleanedName,
        desiredName,
        new TextEncoder().encode(suffixPart).length
      )}${suffixPart}`;
      const relativePath = parent ? `${parent}/${candidate}` : candidate;
      if (!this.usedRelativePaths.has(this.pathKey(relativePath))) {
        this.usedRelativePaths.add(this.pathKey(relativePath));
        return relativePath;
      }
      suffix += 1;
    }
  }
  toAbsolutePath(relativePath) {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\//, "");
    return `${this.targetDir.replace(/\\/g, "/").replace(/\/$/, "")}/${normalized}`;
  }
  getTargetDir() {
    return this.targetDir;
  }
};

// src/lib/import/siyuan/av-renderer.ts
function getActiveView(attributeView) {
  if (!attributeView.views?.length) {
    return void 0;
  }
  return attributeView.views.find((view) => view.id === attributeView.viewID) ?? attributeView.views[0];
}
function getColumnKeys(attributeView, view) {
  const keyMap = new Map((attributeView.keyValues ?? []).map((item) => [item.key.id, item.key]));
  const columnIds = view?.table?.columns?.filter((column) => !column.hidden).map((column) => column.id);
  let columns = [];
  if (columnIds?.length) {
    columns = columnIds.map((id) => keyMap.get(id)).filter((key) => Boolean(key));
  } else if (attributeView.keyIDs?.length) {
    columns = attributeView.keyIDs.map((id) => keyMap.get(id)).filter((key) => Boolean(key));
  } else {
    columns = (attributeView.keyValues ?? []).map((item) => item.key).filter((key) => key.type !== "template" && key.type !== "rollup");
  }
  const totalColumns = columns.length;
  return {
    columns: columns.slice(0, MAX_AV_TABLE_COLUMNS),
    totalColumns
  };
}
function getRowIds(attributeView, view) {
  let rowIds = [];
  if (view?.table?.rowIds?.length) {
    rowIds = view.table.rowIds;
  } else if (view?.itemIds?.length) {
    rowIds = view.itemIds;
  } else {
    const collected = /* @__PURE__ */ new Set();
    for (const keyValue of attributeView.keyValues ?? []) {
      for (const value of keyValue.values ?? []) {
        if (value.blockID) {
          collected.add(value.blockID);
        }
      }
    }
    rowIds = [...collected];
  }
  const totalRows = rowIds.length;
  return {
    rowIds: rowIds.slice(0, MAX_AV_TABLE_ROWS),
    totalRows
  };
}
function buildCellIndex(keyValues) {
  const index = /* @__PURE__ */ new Map();
  for (const keyValue of keyValues ?? []) {
    for (const value of keyValue.values ?? []) {
      if (value.blockID) {
        index.set(`${keyValue.key.id}:${value.blockID}`, value);
      }
    }
  }
  return index;
}
function findCellValue(cellIndex, keyId, rowId) {
  return cellIndex.get(`${keyId}:${rowId}`);
}
function resolveRelationValue(value, blockIndex) {
  if (!value?.relation) {
    return "";
  }
  if (value.relation.contents?.length) {
    return value.relation.contents.map((item) => item.block?.content ?? item.text?.content ?? "").filter(Boolean).join(", ");
  }
  if (value.relation.blockIDs?.length) {
    return value.relation.blockIDs.map((blockId) => blockIndex.get(blockId)?.preview ?? blockId).join(", ");
  }
  return "";
}
function resolveRollupValue(value) {
  if (!value?.rollup?.contents?.length) {
    return "";
  }
  return value.rollup.contents.map((item) => {
    if (item.block?.content) {
      return item.block.content;
    }
    if (item.text?.content) {
      return item.text.content;
    }
    if (item.number?.formattedContent) {
      return item.number.formattedContent;
    }
    if (typeof item.number?.content === "number") {
      return String(item.number.content);
    }
    return "";
  }).filter(Boolean).join(", ");
}
function formatAvCellValue(key, value, blockIndex) {
  if (!value) {
    return "";
  }
  switch (key.type) {
    case "block":
      return value.block?.content?.trim() ?? blockIndex.get(value.blockID ?? "")?.preview ?? "";
    case "text":
      return value.text?.content?.trim() ?? "";
    case "number":
      if (value.number?.formattedContent) {
        return value.number.formattedContent;
      }
      return typeof value.number?.content === "number" ? String(value.number.content) : "";
    case "date":
      return value.date?.formattedContent ?? (value.date?.content ? String(value.date.content) : "");
    case "select":
    case "mSelect":
      return (value.mSelect ?? []).map((item) => item.content ?? "").filter(Boolean).join(", ");
    case "url":
      return value.url?.content?.trim() ?? "";
    case "email":
      return value.email?.content?.trim() ?? "";
    case "phone":
      return value.phone?.content?.trim() ?? "";
    case "mAsset":
      return (value.mAsset ?? []).map((item) => `${item.name ?? ""} ${item.content ?? ""}`.trim()).filter(Boolean).join(", ");
    case "checkbox":
      return value.checkbox?.checked ? "Yes" : "No";
    case "created":
      return value.created?.formattedContent ?? "";
    case "updated":
      return value.updated?.formattedContent ?? "";
    case "template":
      return value.template?.content?.trim() ?? "";
    case "relation":
      return resolveRelationValue(value, blockIndex);
    case "rollup":
      return resolveRollupValue(value);
    default:
      return value.block?.content?.trim() ?? value.text?.content?.trim() ?? "";
  }
}
function formatAvAssetCell(value, options) {
  return (value?.mAsset ?? []).map((item) => {
    const path3 = item.content?.trim() ?? "";
    const label = item.name?.trim() || path3;
    if (!path3) {
      return escapeMarkdownTableCell(label);
    }
    return options.renderAsset?.(path3, label) ?? escapeMarkdownTableCell(label);
  }).filter(Boolean).join(", ");
}
function truncateAvMarkdown(markdown) {
  const bytes = new TextEncoder().encode(markdown);
  if (bytes.length <= MAX_AV_MARKDOWN_BYTES) {
    return { markdown, truncated: false };
  }
  const truncated = new TextDecoder().decode(bytes.slice(0, MAX_AV_MARKDOWN_BYTES));
  return {
    markdown: `${truncated.trimEnd()}

> SiYuan database output truncated (${MAX_AV_MARKDOWN_BYTES} bytes).`,
    truncated: true
  };
}
function buildAvTruncationIssues(truncations) {
  const issues = [];
  for (const truncation of truncations) {
    const omittedRows = truncation.omittedRows;
    const omittedColumns = truncation.omittedColumns;
    if (omittedRows <= 0 && omittedColumns <= 0 && !truncation.markdownBytesTruncated) {
      continue;
    }
    issues.push({
      level: "degraded",
      code: "av_truncated",
      count: 1,
      omittedRows: omittedRows > 0 ? omittedRows : void 0,
      omittedColumns: omittedColumns > 0 ? omittedColumns : void 0,
      markdownBytesTruncated: truncation.markdownBytesTruncated || void 0
    });
  }
  return issues;
}
function renderAttributeViewMarkdown(attributeView, blockIndex, options = {}) {
  const view = getActiveView(attributeView);
  const { columns, totalColumns } = getColumnKeys(attributeView, view);
  const { rowIds, totalRows } = getRowIds(attributeView, view);
  const omittedRows = Math.max(0, totalRows - rowIds.length);
  const omittedColumns = Math.max(0, totalColumns - columns.length);
  if (!columns.length || !rowIds.length) {
    return {
      markdown: `> SiYuan database: ${attributeView.name ?? attributeView.id}`,
      truncation: {
        omittedRows,
        omittedColumns,
        markdownBytesTruncated: false
      }
    };
  }
  const cellIndex = buildCellIndex(attributeView.keyValues);
  const header = columns.map((column) => escapeMarkdownTableCell(column.name));
  const rows = rowIds.map(
    (rowId) => columns.map((column) => {
      const value = findCellValue(cellIndex, column.id, rowId);
      if (column.type === "mAsset") {
        return formatAvAssetCell(value, options);
      }
      const cell = formatAvCellValue(
        column,
        value,
        blockIndex
      );
      return escapeMarkdownTableCell(cell);
    })
  );
  const title = escapeMarkdownText(attributeView.name?.trim() || "Database");
  const table = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`)
  ].join("\n");
  const truncatedMarkdown = truncateAvMarkdown(`### ${title}

${table}`);
  const truncationNote = omittedRows > 0 || omittedColumns > 0 ? `

> SiYuan database truncated: omitted ${omittedRows} row(s) and ${omittedColumns} column(s).` : "";
  return {
    markdown: `${truncatedMarkdown.markdown}${truncationNote}`,
    truncation: {
      omittedRows,
      omittedColumns,
      markdownBytesTruncated: truncatedMarkdown.truncated
    }
  };
}

// src/lib/import/siyuan/block-index.ts
var BLOCK_TYPES_WITH_ANCHOR = /* @__PURE__ */ new Set([
  "NodeParagraph",
  "NodeHeading",
  "NodeThematicBreak",
  "NodeCodeBlock",
  "NodeMathBlock"
]);
function extractInlineText(nodes) {
  if (!nodes?.length) {
    return "";
  }
  return nodes.map((node) => {
    if (node.Type === "NodeText") {
      return node.Data ?? "";
    }
    if (node.Type === "NodeTextMark") {
      return node.TextMarkTextContent ?? node.TextMarkInlineMathContent ?? "";
    }
    if (node.Children?.length) {
      return extractInlineText(node.Children);
    }
    return node.Data ?? "";
  }).join("");
}
function extractBlockPreview(node) {
  switch (node.Type) {
    case "NodeHeading":
    case "NodeParagraph":
      return extractInlineText(node.Children).trim();
    case "NodeCodeBlock": {
      for (const child of node.Children ?? []) {
        if (child.Type === "NodeCodeBlockCode") {
          return (child.Data ?? "").split("\n")[0]?.trim() ?? "";
        }
      }
      return "";
    }
    case "NodeList":
      return extractInlineText(node.Children?.[0]?.Children?.find((child) => child.Type === "NodeParagraph")?.Children).trim();
    default:
      return extractInlineText(node.Children).trim() || node.Data?.trim() || "";
  }
}
function registerBlock(blockId, target, index) {
  if (!isSafeSiYuanBlockId(blockId)) {
    return;
  }
  index.set(blockId, target);
}
function indexNodeBlocks(node, mdRelativePath, index) {
  const anchor = BLOCK_TYPES_WITH_ANCHOR.has(node.Type) ? resolveSafeBlockAnchor(node) ?? void 0 : void 0;
  if (anchor) {
    const target = {
      mdPath: mdRelativePath,
      preview: extractBlockPreview(node),
      anchor
    };
    registerBlock(node.ID, target, index);
    registerBlock(node.Properties?.id, target, index);
  }
  for (const child of node.Children ?? []) {
    indexNodeBlocks(child, mdRelativePath, index);
  }
}
function buildBlockIndex(plans) {
  const index = /* @__PURE__ */ new Map();
  for (const plan of plans) {
    const documentTarget = {
      mdPath: plan.mdRelativePath,
      preview: plan.document.Properties?.title ?? plan.document.ID
    };
    registerBlock(plan.document.ID, documentTarget, index);
    registerBlock(plan.document.Properties?.id, documentTarget, index);
    for (const child of plan.document.Children ?? []) {
      indexNodeBlocks(child, plan.mdRelativePath, index);
    }
  }
  return index;
}
function buildBlockRefDestination(target, currentMdPath) {
  const fragment = target.anchor ? `#${encodeURIComponent(target.anchor)}` : null;
  if (currentMdPath === target.mdPath) {
    return fragment;
  }
  const encodedPath = encodeMarkdownPath(toRelativeWorkspacePath(currentMdPath, target.mdPath));
  if (encodedPath === null) {
    return null;
  }
  return fragment ? `${encodedPath}${fragment}` : encodedPath;
}
function resolveBlockRefLink(refId, displayText, currentMdPath, blockIndex) {
  const target = blockIndex.get(refId);
  const text = displayText.trim() || target?.preview || refId;
  const escapedText = escapeMarkdownLinkText(text);
  if (!target) {
    return escapedText;
  }
  const destination = buildBlockRefDestination(target, currentMdPath);
  if (destination === null) {
    return escapedText;
  }
  return `[${escapedText}](${destination})`;
}
function resolveSiyuanBlockHref(href, displayText, currentMdPath, blockIndex) {
  if (!href.startsWith("siyuan://blocks/")) {
    return href;
  }
  const refId = href.slice("siyuan://blocks/".length);
  return resolveBlockRefLink(refId, displayText, currentMdPath, blockIndex);
}

// src/lib/import/siyuan/embed-query.ts
function extractBlockQueryEmbedScript(node) {
  for (const child of node.Children ?? []) {
    if (child.Type === "NodeBlockQueryEmbedScript") {
      return (child.Data ?? "").trim();
    }
  }
  return "";
}
function parseBlockQueryEmbedBlockId(script) {
  const match = script.trim().match(/\bid\s*=\s*['"]([^'"]+)['"]/i);
  if (!match) {
    return null;
  }
  const blockId = match[1];
  return isSafeSiYuanBlockId(blockId) ? blockId : null;
}

// src/lib/import/siyuan/known-node-types.ts
var MAX_SUPPORTED_SIYuan_SPEC = 1;
var KNOWN_SIYuan_NODE_TYPES = /* @__PURE__ */ new Set([
  "NodeDocument",
  "NodeParagraph",
  "NodeHeading",
  "NodeThematicBreak",
  "NodeCodeBlock",
  "NodeCodeBlockCode",
  "NodeCodeBlockFenceOpenMarker",
  "NodeCodeBlockFenceInfoMarker",
  "NodeCodeBlockFenceCloseMarker",
  "NodeMathBlock",
  "NodeMathBlockContent",
  "NodeHTMLBlock",
  "NodeIFrame",
  "NodeVideo",
  "NodeAudio",
  "NodeTable",
  "NodeTableHead",
  "NodeTableRow",
  "NodeTableCell",
  "NodeList",
  "NodeListItem",
  "NodeTaskListItemMarker",
  "NodeBlockquote",
  "NodeBlockquoteMarker",
  "NodeCallout",
  "NodeSuperBlock",
  "NodeSuperBlockLayoutMarker",
  "NodeBlockQueryEmbed",
  "NodeBlockQueryEmbedScript",
  "NodeAttributeView",
  "NodeWidget",
  "NodeCustomBlock",
  "NodeGitConflict",
  "NodeText",
  "NodeTextMark",
  "NodeImage",
  "NodeLinkText",
  "NodeLinkDest",
  "NodeLinkTitle",
  "NodeLinkSpace",
  "NodeBang",
  "NodeOpenParen",
  "NodeCloseParen",
  "NodeOpenBracket",
  "NodeCloseBracket",
  "NodeOpenBrace",
  "NodeCloseBrace",
  "NodeHardBreak",
  "NodeBr",
  "NodeBackslash",
  "NodeKramdownSpanIAL",
  "NodeKramdownBlockIAL",
  "NodeFootnoteDef",
  "NodeFootnoteRef",
  "NodeFootnotesDefBlock",
  "NodeYamlFrontMatter",
  "NodeToC",
  "NodeTitle",
  "NodeTag",
  "NodeSpin",
  "NodeLottie",
  "NodeBreadcrumb",
  "NodeEmoji",
  "NodeEmojiAvatar"
]);
var KNOWN_SIYuan_NODE_TYPE_PATTERNS = [
  /^NodeHeadingC\d+hMarker$/
];
function isKnownSiYuanNodeType(type) {
  if (KNOWN_SIYuan_NODE_TYPES.has(type)) {
    return true;
  }
  return KNOWN_SIYuan_NODE_TYPE_PATTERNS.some((pattern) => pattern.test(type));
}
function shouldReportUnknownNodeType(type) {
  if (isKnownSiYuanNodeType(type)) {
    return false;
  }
  if (!type.startsWith("Node")) {
    return false;
  }
  if (/^Node(?:Open|Close)(?:Paren|Bracket|Brace)$/.test(type)) {
    return false;
  }
  if (/^NodeLink(?:Text|Dest|Title|Space)$/.test(type)) {
    return false;
  }
  if (/^NodeCodeBlockFence/.test(type)) {
    return false;
  }
  if (/^NodeKramdown(?:Block|Span)IAL$/.test(type)) {
    return false;
  }
  if (/^NodeHeadingC\d+hMarker$/.test(type)) {
    return false;
  }
  if (type === "NodeBang" || type === "NodeBr" || type === "NodeBackslash") {
    return false;
  }
  return true;
}
function parseSiYuanSpecVersion(spec) {
  const trimmed = spec.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const version = Number.parseInt(trimmed, 10);
  return Number.isFinite(version) ? version : null;
}

// src/lib/import/siyuan/validation.ts
var MAX_SY_DOCUMENT_NODES = 5e5;
var MAX_SY_DOCUMENT_DEPTH = 256;
var OPTIONAL_STRING_FIELDS = [
  "Spec",
  "Data",
  "TextMarkType",
  "TextMarkTextContent",
  "TextMarkAHref",
  "TextMarkATitle",
  "TextMarkBlockRefID",
  "TextMarkBlockRefSubtype",
  "TextMarkInlineMathContent",
  "TextMarkInlineMemoContent",
  "TextMarkFileAnnotationRefID",
  "CodeBlockInfo",
  "CalloutType",
  "CalloutTitle",
  "CalloutIcon",
  "AttributeViewID",
  "AttributeViewType"
];
function validateSiYuanDocument(value, source = "SiYuan document") {
  if (!value || typeof value !== "object" || !("Type" in value) || value.Type !== "NodeDocument" || !("ID" in value) || typeof value.ID !== "string" || !isDocumentId(value.ID) || !("Properties" in value) || !value.Properties || typeof value.Properties !== "object" || Array.isArray(value.Properties)) {
    throw new Error(`Invalid SiYuan document: ${source}`);
  }
  const document = value;
  const stack = [{ node: document, depth: 0 }];
  let nodeCount = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      break;
    }
    const { node, depth } = current;
    nodeCount += 1;
    if (nodeCount > MAX_SY_DOCUMENT_NODES || depth > MAX_SY_DOCUMENT_DEPTH) {
      throw new Error(`SiYuan document is too complex: ${source}`);
    }
    if (!node || typeof node !== "object" || typeof node.Type !== "string") {
      throw new Error(`Invalid SiYuan node: ${source}`);
    }
    if (node.Spec !== void 0 && parseSiYuanSpecVersion(node.Spec) === null) {
      throw new Error(`Invalid SiYuan spec: ${source}`);
    }
    if (node.ID !== void 0 && (typeof node.ID !== "string" || !isDocumentId(node.ID))) {
      throw new Error(`Invalid SiYuan block ID: ${source}`);
    }
    if (OPTIONAL_STRING_FIELDS.some(
      (field) => node[field] !== void 0 && typeof node[field] !== "string"
    )) {
      throw new Error(`Invalid SiYuan node text: ${source}`);
    }
    if (node.Properties !== void 0 && (!node.Properties || typeof node.Properties !== "object" || Array.isArray(node.Properties) || Object.values(node.Properties).some(
      (property) => property !== void 0 && typeof property !== "string"
    ))) {
      throw new Error(`Invalid SiYuan node properties: ${source}`);
    }
    if (node.Children !== void 0 && !Array.isArray(node.Children)) {
      throw new Error(`Invalid SiYuan child nodes: ${source}`);
    }
    for (const child of node.Children ?? []) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return document;
}
function parseAndValidateSiYuanDocument(content, source) {
  return validateSiYuanDocument(JSON.parse(content), source);
}

// src/lib/import/siyuan/converter.ts
function resolveSafeHref(path3, context) {
  const normalized = path3.trim().replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }
  if (isSiYuanAssetReferenceCandidate(normalized)) {
    const assetReference = parseSiYuanAssetReference(normalized);
    if (!assetReference) {
      context.invalidAssetPaths.add(normalized);
      return null;
    }
    context.assetPaths.add(assetReference.sourcePath);
    const targetPath = getImportedAssetRelativePath(
      assetReference.sourcePath,
      context.assetOutputDir
    );
    const relativePath = toRelativeWorkspacePath(context.currentMdPath, targetPath);
    const encodedPath = encodeMarkdownPath(relativePath);
    if (encodedPath === null) {
      context.invalidAssetPaths.add(normalized);
      return null;
    }
    return `${encodedPath}`;
  }
  const protocol = normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
  if (protocol && !["http", "https", "mailto", "tel"].includes(protocol)) {
    return null;
  }
  if (!protocol && !isSafeRelativeLinkReference(normalized)) {
    return null;
  }
  return encodeMarkdownLinkDestination(normalized) ?? null;
}
function isSiYuanInvisibleTextNode(node) {
  return node.Type === "NodeText" && stripSiYuanInvisibleChars(node.Data ?? "").length === 0;
}
function renderParagraph(node, context) {
  const children = node.Children ?? [];
  const meaningfulChildren = children.filter((child) => !isSiYuanInvisibleTextNode(child));
  if (meaningfulChildren.length === 1 && meaningfulChildren[0].Type === "NodeImage") {
    return withBlockAnchor(node, renderImage(meaningfulChildren[0], context));
  }
  return withBlockAnchor(node, renderInlineNodes(children, context));
}
function renderInlineNodes(nodes, context) {
  if (!nodes?.length) {
    return "";
  }
  return nodes.map((node) => renderInlineNode(node, context)).join("");
}
function renderInlineNode(node, context) {
  switch (node.Type) {
    case "NodeText":
      return escapeMarkdownText(node.Data ?? "");
    case "NodeTextMark":
      return renderTextMark(node, context);
    case "NodeImage":
      return renderImage(node, context);
    case "NodeHardBreak":
    case "NodeBr":
      return "\\\n";
    case "NodeBackslash":
      return "\\\\";
    default:
      if (node.Children?.length) {
        return renderInlineNodes(node.Children, context);
      }
      return escapeMarkdownText(node.Data ?? "");
  }
}
function renderTextMark(node, context) {
  const markTypes = (node.TextMarkType ?? "text").split(/\s+/).filter(Boolean);
  const rawContent = node.TextMarkTextContent ?? "";
  let content;
  if (markTypes.includes("inline-math")) {
    content = `$${sanitizeMathContent(node.TextMarkInlineMathContent ?? rawContent)}$`;
  } else if (markTypes.includes("a")) {
    const href = node.TextMarkAHref ?? "";
    const text = rawContent || href;
    if (href.startsWith("siyuan://blocks/")) {
      content = resolveSiyuanBlockHref(href, text, context.currentMdPath, context.blockIndex);
    } else {
      const safeHref = resolveSafeHref(href, context);
      content = safeHref === null ? escapeMarkdownLinkText(text) : `[${escapeMarkdownLinkText(text)}](${safeHref})`;
    }
  } else if (markTypes.includes("block-ref")) {
    const refId = node.TextMarkBlockRefID ?? "";
    const isDynamic = node.TextMarkBlockRefSubtype === "d";
    const target = context.blockIndex.get(refId);
    const text = isDynamic ? target?.preview ?? rawContent ?? refId : rawContent || target?.preview || refId;
    content = resolveBlockRefLink(refId, text, context.currentMdPath, context.blockIndex);
  } else if (markTypes.includes("tag")) {
    content = `#${escapeMarkdownText(rawContent)}#`;
  } else if (markTypes.includes("code")) {
    content = renderInlineCode(rawContent);
  } else if (markTypes.includes("inline-memo")) {
    const memo = escapeMarkdownText(node.TextMarkInlineMemoContent ?? "");
    const text = escapeMarkdownText(rawContent);
    content = memo ? `${text} (${memo})` : text;
  } else if (markTypes.includes("file-annotation-ref")) {
    content = escapeMarkdownText(rawContent) || escapeMarkdownText(node.TextMarkFileAnnotationRefID ?? "");
  } else {
    content = escapeMarkdownText(rawContent);
  }
  return applyTextMarkStyles(content, markTypes);
}
function applyTextMarkStyles(content, markTypes) {
  if (markTypes.includes("strong")) {
    content = `**${content}**`;
  }
  if (markTypes.includes("em")) {
    content = `*${content}*`;
  }
  if (markTypes.includes("s")) {
    content = `~~${content}~~`;
  }
  if (markTypes.includes("mark")) {
    content = `==${content}==`;
  }
  if (markTypes.includes("u")) {
    content = `<u>${content}</u>`;
  }
  if (markTypes.includes("sup")) {
    content = `<sup>${content}</sup>`;
  }
  if (markTypes.includes("sub")) {
    content = `<sub>${content}</sub>`;
  }
  if (markTypes.includes("kbd")) {
    content = `<kbd>${content}</kbd>`;
  }
  return content;
}
function renderImage(node, context) {
  let alt = "";
  let src = "";
  for (const child of node.Children ?? []) {
    if (child.Type === "NodeLinkText") {
      alt = child.Data ?? "";
    }
    if (child.Type === "NodeLinkDest") {
      src = child.Data ?? "";
    }
  }
  const safeSrc = resolveSafeHref(src, context);
  if (safeSrc === null || !safeSrc) {
    return escapeMarkdownLinkText(alt || "Unsupported image");
  }
  const label = alt.trim() || "image";
  return `![${escapeMarkdownLinkText(label)}](${safeSrc})`;
}
function renderBlockNodes(nodes, context, depth = 0) {
  if (!nodes?.length) {
    return "";
  }
  const parts = [];
  for (const node of nodes) {
    const rendered = renderBlockNode(node, context, depth);
    if (rendered) {
      parts.push(rendered);
    }
  }
  return parts.join("\n\n");
}
function withBlockAnchor(node, content) {
  const blockId = resolveSafeBlockAnchor(node);
  if (!blockId || !content) {
    return content;
  }
  return `<span id="${blockId}"></span>
${content}`;
}
function renderBlockNode(node, context, depth) {
  switch (node.Type) {
    case "NodeParagraph":
      return renderParagraph(node, context);
    case "NodeHeading": {
      const level = Math.min(Math.max(node.HeadingLevel ?? 2, 1), 6);
      const prefix = "#".repeat(level);
      return withBlockAnchor(
        node,
        `${prefix} ${renderInlineNodes(node.Children, context)}`.trim()
      );
    }
    case "NodeThematicBreak":
      return withBlockAnchor(node, "---");
    case "NodeCodeBlock":
      return withBlockAnchor(node, renderCodeBlock(node));
    case "NodeMathBlock":
      return withBlockAnchor(node, renderMathBlock(node));
    case "NodeHTMLBlock":
    case "NodeIFrame":
    case "NodeVideo":
    case "NodeAudio":
      return renderFencedCode(node.Data ?? "", "html");
    case "NodeTable":
      return renderTable(node, context);
    case "NodeList":
      return renderList(node, context, depth);
    case "NodeBlockquote":
      return renderBlockquote(node, context);
    case "NodeCallout":
      return renderCallout(node, context);
    case "NodeSuperBlock":
      return renderSuperBlock(node, context, depth);
    case "NodeBlockQueryEmbed":
      return renderEmbedBlock(node, context);
    case "NodeAttributeView":
      return renderAttributeView(node, context);
    case "NodeWidget":
      return renderDegradedSiYuanBlock(
        "SiYuan widget (imported with reduced fidelity):",
        node,
        context,
        depth,
        "json"
      );
    case "NodeCustomBlock":
      return renderDegradedSiYuanBlock(
        "SiYuan custom block (imported with reduced fidelity):",
        node,
        context,
        depth
      );
    case "NodeGitConflict":
      return renderDegradedSiYuanBlock(
        "SiYuan merge conflict (imported with reduced fidelity):",
        node,
        context,
        depth,
        "diff"
      );
    default:
      if (!isKnownSiYuanNodeType(node.Type)) {
        return renderDegradedSiYuanBlock(
          `SiYuan ${node.Type} (imported with reduced fidelity):`,
          node,
          context,
          depth
        );
      }
      if (node.Children?.length) {
        return renderBlockNodes(node.Children, context, depth);
      }
      return escapeMarkdownText(node.Data ?? "");
  }
}
function renderCodeBlock(node) {
  const language = decodeBase64(node.CodeBlockInfo);
  let code = "";
  for (const child of node.Children ?? []) {
    if (child.Type === "NodeCodeBlockCode") {
      code = child.Data ?? "";
      break;
    }
  }
  return renderFencedCode(code, language);
}
function renderInlineCode(content) {
  const longestFence = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(longestFence + 1);
  const needsPadding = content.startsWith("`") || content.endsWith("`");
  return needsPadding ? `${fence} ${content} ${fence}` : `${fence}${content}${fence}`;
}
function renderFencedCode(content, language) {
  const longestFence = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  const safeLanguage = language.trim().split(/\s+/)[0]?.replace(/[^\w+.-]/g, "") ?? "";
  return `${fence}${safeLanguage}
${content}
${fence}`.trimEnd();
}
function renderDegradedSiYuanBlock(label, node, context, depth, language = "text") {
  const parts = [`> ${label}`];
  const rawData = node.Data?.trim();
  if (rawData) {
    parts.push(renderFencedCode(rawData, language));
  }
  const childContent = renderBlockNodes(node.Children, context, depth);
  if (childContent.trim()) {
    parts.push(childContent);
  }
  if (parts.length === 1) {
    parts.push(`> Block type: ${node.Type}`);
  }
  return withBlockAnchor(node, parts.join("\n\n"));
}
function renderMathBlock(node) {
  for (const child of node.Children ?? []) {
    if (child.Type === "NodeMathBlockContent") {
      return `$$
${sanitizeMathContent(child.Data ?? "")}
$$`;
    }
  }
  return "$$";
}
function sanitizeMathContent(content) {
  return content.replace(/\$/g, "\\$").replace(/</g, "\\lt ").replace(/>/g, "\\gt ");
}
function renderTable(node, context) {
  const rows = [];
  function walkTableNodes(nodes) {
    for (const child of nodes ?? []) {
      if (child.Type === "NodeTableRow") {
        const cells = (child.Children ?? []).filter((item) => item.Type === "NodeTableCell").map((cell) => renderInlineNodes(cell.Children, context).replace(/\|/g, "\\|").replace(/\n/g, " "));
        if (cells.length) {
          rows.push(cells);
        }
      } else if (child.Children?.length) {
        walkTableNodes(child.Children);
      }
    }
  }
  walkTableNodes(node.Children);
  if (!rows.length) {
    return "";
  }
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const next = [...row];
    while (next.length < columnCount) {
      next.push("");
    }
    return next;
  });
  const header = normalizedRows[0];
  const separator = new Array(columnCount).fill("---");
  const body = normalizedRows.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}
function renderList(node, context, depth, indent = "    ".repeat(depth)) {
  const items = (node.Children ?? []).filter((child) => child.Type === "NodeListItem");
  const renderedItems = [];
  items.forEach((item, index) => {
    const listType = item.ListData?.Typ ?? node.ListData?.Typ;
    const marker = getListMarker(listType, item, index);
    const leadContinuationIndent = `${indent}${" ".repeat(marker.length + 1)}`;
    const continuationIndent = `${indent}${" ".repeat(Math.max(4, marker.length + 1))}`;
    let renderedItem = `${indent}${marker}`;
    let hasContent = false;
    for (const child of item.Children ?? []) {
      if (child.Type === "NodeTaskListItemMarker") {
        continue;
      }
      if (child.Type === "NodeParagraph") {
        const paragraph = renderInlineNodes(child.Children, context);
        if (!hasContent) {
          renderedItem = appendLeadListContent(
            renderedItem,
            paragraph,
            leadContinuationIndent
          );
        } else {
          renderedItem += `
${continuationIndent}
${indentBlock(
            paragraph,
            continuationIndent
          )}`;
        }
        hasContent = true;
      } else if (child.Type === "NodeList") {
        renderedItem += `
${renderList(child, context, depth + 1, continuationIndent)}`;
        hasContent = true;
      } else {
        const block = renderBlockNode(child, context, depth + 1);
        if (block) {
          renderedItem = hasContent ? `${renderedItem}
${continuationIndent}
${indentBlock(
            block,
            continuationIndent
          )}` : appendLeadListContent(renderedItem, block, leadContinuationIndent);
          hasContent = true;
        }
      }
    }
    renderedItems.push(renderedItem);
  });
  return renderedItems.join("\n");
}
function appendLeadListContent(markerLine, content, continuationIndent) {
  const [firstLine = "", ...remainingLines] = content.split("\n");
  let result = `${markerLine}${firstLine ? ` ${firstLine}` : ""}`;
  if (remainingLines.length > 0) {
    result += `
${remainingLines.map((line) => `${continuationIndent}${line}`).join("\n")}`;
  }
  return result;
}
function indentBlock(content, indent) {
  return content.split("\n").map((line) => `${indent}${line}`).join("\n");
}
function getTaskListItemChecked(item) {
  const marker = item.Children?.find((child) => child.Type === "NodeTaskListItemMarker");
  if (marker?.TaskListItemChecked !== void 0) {
    return marker.TaskListItemChecked;
  }
  if (marker?.ListData?.Checked !== void 0) {
    return marker.ListData.Checked;
  }
  return item.ListData?.Checked ?? item.TaskListItemChecked ?? false;
}
function getListMarker(listType, item, index) {
  if (listType === 3) {
    const checked = getTaskListItemChecked(item);
    return checked ? "- [x]" : "- [ ]";
  }
  if (listType === 1) {
    const start = item.ListData?.Start ?? 1;
    const number = item.ListData?.Num && item.ListData.Num > 0 ? item.ListData.Num : start + index;
    const delimiter = item.ListData?.Delimiter === 41 ? ")" : ".";
    return `${number}${delimiter}`;
  }
  return "-";
}
function renderBlockquote(node, context) {
  const content = renderBlockNodes(
    (node.Children ?? []).filter((child) => child.Type !== "NodeBlockquoteMarker"),
    context
  );
  return content.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
}
function renderCallout(node, context) {
  const type = (node.CalloutType ?? "NOTE").toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "NOTE";
  const title = escapeMarkdownText(node.CalloutTitle ?? type);
  const body = renderBlockNodes(node.Children, context);
  return `> [!${type}]
> **${title}**
>
${body.split("\n").map((line) => line ? `> ${line}` : ">").join("\n")}`;
}
function renderSuperBlock(node, context, depth) {
  const blocks = (node.Children ?? []).filter(
    (child) => !child.Type.endsWith("Marker") && child.Type !== "NodeSuperBlockLayoutMarker"
  );
  return blocks.map((block) => renderBlockNode(block, context, depth)).filter(Boolean).join("\n\n");
}
function renderEmbedBlock(node, context) {
  const script = extractBlockQueryEmbedScript(node);
  const refId = script ? parseBlockQueryEmbedBlockId(script) : null;
  const target = refId ? context.blockIndex.get(refId) : void 0;
  if (refId && target) {
    const link = resolveBlockRefLink(
      refId,
      target.preview || refId,
      context.currentMdPath,
      context.blockIndex
    );
    return `> Embedded block:

${link}`;
  }
  if (script) {
    return `> Embedded block query (content not in export):

${renderFencedCode(script, "sql")}`;
  }
  return "> Embedded block (content not in export)";
}
function renderAttributeView(node, context) {
  const avId = node.AttributeViewID;
  if (!avId) {
    return "> SiYuan database block";
  }
  const attributeView = context.attributeViews.get(avId);
  if (!attributeView) {
    const viewType = escapeMarkdownText(node.AttributeViewType ?? "table");
    return `> SiYuan database (${viewType}, definition not in export): ${escapeMarkdownText(avId)}`;
  }
  const rendered = renderAttributeViewMarkdown(attributeView, context.blockIndex, {
    renderAsset: (path3, label) => {
      const href = resolveSafeHref(path3, context);
      if (!href) {
        return null;
      }
      return `[${escapeMarkdownLinkText(label || path3)}](${href})`;
    }
  });
  context.avTruncations.push(rendered.truncation);
  return rendered.markdown;
}
function convertSyDocumentToMarkdown(document, context) {
  const runtimeContext = {
    ...context,
    assetPaths: /* @__PURE__ */ new Set(),
    invalidAssetPaths: /* @__PURE__ */ new Set(),
    avTruncations: []
  };
  const body = stripSiYuanInvisibleChars(renderBlockNodes(document.Children, runtimeContext).trim());
  const markdown = body ? `${body}
` : "";
  return {
    markdown,
    assetPaths: [...runtimeContext.assetPaths],
    invalidAssetPaths: [...runtimeContext.invalidAssetPaths],
    importIssues: buildAvTruncationIssues(runtimeContext.avTruncations)
  };
}

// src/lib/import/siyuan/av-loader.ts
var MAX_ATTRIBUTE_VIEW_BYTES = 64 * 1024 * 1024;
var MAX_ATTRIBUTE_VIEW_FILES = 2e3;
var MAX_TOTAL_ATTRIBUTE_VIEW_BYTES = 256 * 1024 * 1024;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function hasOptionalType(value, key, type) {
  return value[key] === void 0 || typeof value[key] === type;
}
function isRecordWithOptionalStringContent(value) {
  return isRecord(value) && hasOptionalType(value, "content", "string");
}
function isValidAvContent(value) {
  return isRecord(value) && hasOptionalType(value, "id", "string") && hasOptionalType(value, "content", "string");
}
function isValidAvNumber(value) {
  return isRecord(value) && hasOptionalType(value, "content", "number") && hasOptionalType(value, "formattedContent", "string") && hasOptionalType(value, "isNotEmpty", "boolean");
}
function isValidAvDate(value) {
  return isRecord(value) && hasOptionalType(value, "content", "number") && hasOptionalType(value, "content2", "number") && hasOptionalType(value, "isNotTime", "boolean") && hasOptionalType(value, "hasEndDate", "boolean") && hasOptionalType(value, "formattedContent", "string");
}
function isValidAvAsset(value) {
  return isRecord(value) && hasOptionalType(value, "name", "string") && hasOptionalType(value, "content", "string");
}
function isValidAvRelationContent(value) {
  if (!isRecord(value)) {
    return false;
  }
  return (value.block === void 0 || isRecordWithOptionalStringContent(value.block)) && (value.text === void 0 || isRecordWithOptionalStringContent(value.text));
}
function isValidAvRollupContent(value) {
  if (!isValidAvRelationContent(value) || !isRecord(value)) {
    return false;
  }
  return value.number === void 0 || isValidAvNumber(value.number);
}
function isValidAvValue(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (!hasOptionalType(value, "id", "string") || !hasOptionalType(value, "keyID", "string") || !hasOptionalType(value, "blockID", "string") || !hasOptionalType(value, "type", "string")) {
    return false;
  }
  const optionalContentObjects = ["text", "url", "email", "phone", "template"];
  if (optionalContentObjects.some(
    (key) => value[key] !== void 0 && !isRecordWithOptionalStringContent(value[key])
  )) {
    return false;
  }
  if (value.block !== void 0 && !isValidAvContent(value.block) || value.number !== void 0 && !isValidAvNumber(value.number) || value.date !== void 0 && !isValidAvDate(value.date) || value.mSelect !== void 0 && (!Array.isArray(value.mSelect) || !value.mSelect.every(isRecordWithOptionalStringContent)) || value.mAsset !== void 0 && (!Array.isArray(value.mAsset) || !value.mAsset.every(isValidAvAsset))) {
    return false;
  }
  for (const key of ["created", "updated"]) {
    const item = value[key];
    if (item !== void 0 && (!isRecord(item) || !hasOptionalType(item, "formattedContent", "string"))) {
      return false;
    }
  }
  if (value.checkbox !== void 0 && (!isRecord(value.checkbox) || !hasOptionalType(value.checkbox, "checked", "boolean"))) {
    return false;
  }
  if (value.relation !== void 0) {
    if (!isRecord(value.relation)) {
      return false;
    }
    if (value.relation.blockIDs !== void 0 && value.relation.blockIDs !== null && (!Array.isArray(value.relation.blockIDs) || !value.relation.blockIDs.every((item) => typeof item === "string"))) {
      return false;
    }
    if (value.relation.contents !== void 0 && value.relation.contents !== null && (!Array.isArray(value.relation.contents) || !value.relation.contents.every(isValidAvRelationContent))) {
      return false;
    }
  }
  if (value.rollup !== void 0 && (!isRecord(value.rollup) || value.rollup.contents !== void 0 && value.rollup.contents !== null && (!Array.isArray(value.rollup.contents) || !value.rollup.contents.every(isValidAvRollupContent)))) {
    return false;
  }
  return true;
}
function isValidAvKey(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isNonEmptyString(value.id) && typeof value.name === "string" && typeof value.type === "string";
}
function isValidAvKeyValue(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (!isValidAvKey(value.key)) {
    return false;
  }
  if (value.values !== void 0) {
    if (!Array.isArray(value.values) || !value.values.every(isValidAvValue)) {
      return false;
    }
  }
  return true;
}
function isValidAvViewColumn(value) {
  if (!isRecord(value)) {
    return false;
  }
  return isNonEmptyString(value.id) && hasOptionalType(value, "hidden", "boolean");
}
function isValidAvViewTable(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (value.columns !== void 0) {
    if (!Array.isArray(value.columns) || !value.columns.every(isValidAvViewColumn)) {
      return false;
    }
  }
  if (value.rowIds !== void 0 && (!Array.isArray(value.rowIds) || !value.rowIds.every((item) => typeof item === "string"))) {
    return false;
  }
  return true;
}
function isValidAvView(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNonEmptyString(value.id)) {
    return false;
  }
  if (value.itemIds !== void 0 && (!Array.isArray(value.itemIds) || !value.itemIds.every((item) => typeof item === "string"))) {
    return false;
  }
  if (value.table !== void 0 && !isValidAvViewTable(value.table)) {
    return false;
  }
  return true;
}
function isValidAttributeView(value) {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNonEmptyString(value.id)) {
    return false;
  }
  if (!hasOptionalType(value, "spec", "number") || !hasOptionalType(value, "name", "string") || !hasOptionalType(value, "viewID", "string")) {
    return false;
  }
  if (value.keyValues !== void 0) {
    if (!Array.isArray(value.keyValues) || !value.keyValues.every(isValidAvKeyValue)) {
      return false;
    }
  }
  if (value.keyIDs !== void 0 && value.keyIDs !== null) {
    if (!Array.isArray(value.keyIDs) || !value.keyIDs.every((item) => typeof item === "string")) {
      return false;
    }
  }
  if (value.views !== void 0) {
    if (!Array.isArray(value.views) || !value.views.every(isValidAvView)) {
      return false;
    }
  }
  return true;
}
async function readJsonFiles(directory, signal, budget) {
  if (!await exists(directory)) {
    return [];
  }
  const entries = await readDir(directory);
  const results = [];
  for (const entry of entries) {
    throwIfAborted(signal);
    if (!entry.isFile || entry.isSymlink || !entry.name.endsWith(".json")) {
      continue;
    }
    if (budget) {
      budget.fileCount += 1;
      if (budget.fileCount > MAX_ATTRIBUTE_VIEW_FILES) {
        throw new SyImportBudgetExceededError(
          `SiYuan import exceeds the attribute-view file limit (${MAX_ATTRIBUTE_VIEW_FILES}).`
        );
      }
    }
    const id = entry.name.replace(/\.json$/, "");
    try {
      const filePath = await join(directory, entry.name);
      const fileInfo = await lstat(filePath);
      if (!fileInfo.isFile || fileInfo.isSymlink || fileInfo.size > MAX_ATTRIBUTE_VIEW_BYTES) {
        continue;
      }
      if (budget) {
        budget.totalBytes += fileInfo.size;
        if (budget.totalBytes > MAX_TOTAL_ATTRIBUTE_VIEW_BYTES) {
          throw new SyImportBudgetExceededError(
            `SiYuan import exceeds the attribute-view memory budget (${MAX_TOTAL_ATTRIBUTE_VIEW_BYTES} bytes).`
          );
        }
      }
      const content = await readTextFile(filePath);
      const parsed = JSON.parse(content);
      if (!isValidAttributeView(parsed)) {
        continue;
      }
      results.push({ id, data: parsed });
    } catch (error) {
      if (error instanceof SyImportBudgetExceededError) {
        throw error;
      }
      continue;
    }
  }
  return results;
}
async function mergeAttributeViewsFromDir(directory, attributeViews, signal, budget) {
  const files = await readJsonFiles(directory, signal, budget);
  for (const file of files) {
    throwIfAborted(signal);
    attributeViews.set(file.data.id ?? file.id, file.data);
  }
}
async function resolveDirectoryUnderRoot(root, segments) {
  let currentPath = root;
  for (const segment of segments) {
    currentPath = await join(currentPath, segment);
    if (!await exists(currentPath)) {
      return null;
    }
    const pathInfo = await lstat(currentPath);
    if (!pathInfo.isDirectory || pathInfo.isSymlink) {
      return null;
    }
  }
  return currentPath;
}
async function loadAttributeViews(dataRoot, signal) {
  const attributeViews = /* @__PURE__ */ new Map();
  const budget = { fileCount: 0, totalBytes: 0 };
  const rootAvDirectory = await resolveDirectoryUnderRoot(dataRoot, ["storage", "av"]);
  if (rootAvDirectory) {
    await mergeAttributeViewsFromDir(rootAvDirectory, attributeViews, signal, budget);
  }
  const entries = await readDir(dataRoot);
  for (const entry of entries) {
    throwIfAborted(signal);
    if (entry.name.startsWith(".") || !entry.isDirectory || entry.isSymlink) {
      continue;
    }
    const notebookAvDirectory = await resolveDirectoryUnderRoot(
      dataRoot,
      [entry.name, "storage", "av"]
    );
    if (notebookAvDirectory) {
      await mergeAttributeViewsFromDir(notebookAvDirectory, attributeViews, signal, budget);
    }
  }
  return attributeViews;
}

// src/lib/import/siyuan/scan-import-issues.ts
function addIssue(issues, code, level) {
  const existing = issues.get(code);
  if (existing) {
    existing.count += 1;
    return;
  }
  issues.set(code, { level, code, count: 1 });
}
function scanTextMark(node, issues, context) {
  const markTypes = (node.TextMarkType ?? "").split(/\s+/).filter(Boolean);
  if (markTypes.includes("block-ref")) {
    const refId = node.TextMarkBlockRefID ?? "";
    if (refId && !context.blockIndex.has(refId)) {
      addIssue(issues, "unresolved_block_ref", "degraded");
    }
  }
  if (markTypes.includes("a") && node.TextMarkAHref?.startsWith("siyuan://blocks/")) {
    const refId = node.TextMarkAHref.slice("siyuan://blocks/".length);
    if (refId && !context.blockIndex.has(refId)) {
      addIssue(issues, "unresolved_block_ref", "degraded");
    }
  }
  if (markTypes.includes("inline-memo")) {
    addIssue(issues, "inline_memo", "degraded");
  }
  if (markTypes.includes("file-annotation-ref")) {
    addIssue(issues, "file_annotation_ref", "degraded");
  }
}
function scanBlockNode(node, issues, context) {
  if (node.Spec !== void 0) {
    const specVersion = parseSiYuanSpecVersion(node.Spec);
    if (specVersion !== null && specVersion > MAX_SUPPORTED_SIYuan_SPEC) {
      addIssue(issues, "unsupported_spec", "degraded");
    }
  }
  if (shouldReportUnknownNodeType(node.Type)) {
    addIssue(issues, "unknown_node_type", "degraded");
  }
  if (node.Type === "NodeTextMark") {
    scanTextMark(node, issues, context);
  }
  switch (node.Type) {
    case "NodeWidget":
      addIssue(issues, "widget", "degraded");
      break;
    case "NodeCustomBlock":
      addIssue(issues, "custom_block", "degraded");
      break;
    case "NodeBlockQueryEmbed": {
      const script = extractBlockQueryEmbedScript(node);
      const refId = script ? parseBlockQueryEmbedBlockId(script) : null;
      if (!refId || !context.blockIndex.has(refId)) {
        addIssue(issues, "embed_block", "degraded");
      }
      break;
    }
    case "NodeGitConflict":
      addIssue(issues, "git_conflict", "degraded");
      break;
    case "NodeAttributeView": {
      const avId = node.AttributeViewID;
      if (!avId || !context.attributeViews.has(avId)) {
        addIssue(issues, "missing_attribute_view", "degraded");
      } else {
        const view = context.attributeViews.get(avId);
        const activeView = view?.views?.find((item) => item.id === view.viewID) ?? view?.views?.[0];
        if (activeView?.type && activeView.type !== "table") {
          addIssue(issues, "non_table_attribute_view", "degraded");
        }
      }
      break;
    }
    case "NodeSuperBlock":
      addIssue(issues, "super_block", "degraded");
      break;
    case "NodeIFrame":
    case "NodeVideo":
    case "NodeAudio":
      addIssue(issues, "media_html_block", "degraded");
      break;
    case "NodeHTMLBlock":
      addIssue(issues, "html_block", "degraded");
      break;
  }
  for (const child of node.Children ?? []) {
    scanBlockNode(child, issues, context);
  }
}
function scanDocumentIssues(document, context) {
  const issues = /* @__PURE__ */ new Map();
  for (const child of document.Children ?? []) {
    scanBlockNode(child, issues, context);
  }
  return [...issues.values()];
}
function scanMarkdownIssues(markdown, missingAssets, invalidAssetPaths = []) {
  const issues = [];
  if (/\]\(siyuan:\/\/blocks\//.test(markdown)) {
    issues.push({ level: "degraded", code: "siyuan_protocol_link", count: 1 });
  }
  if (missingAssets.length > 0) {
    issues.push({ level: "degraded", code: "missing_asset", count: missingAssets.length });
  }
  if (invalidAssetPaths.length > 0) {
    issues.push({
      level: "degraded",
      code: "unsafe_asset_path",
      count: invalidAssetPaths.length
    });
  }
  return issues;
}
function mergeImportIssues(...groups) {
  const merged = /* @__PURE__ */ new Map();
  for (const group of groups) {
    for (const issue of group) {
      const existing = merged.get(issue.code);
      if (existing) {
        existing.count += issue.count;
        if (issue.code === "av_truncated") {
          existing.omittedRows = (existing.omittedRows ?? 0) + (issue.omittedRows ?? 0);
          existing.omittedColumns = (existing.omittedColumns ?? 0) + (issue.omittedColumns ?? 0);
          existing.markdownBytesTruncated = existing.markdownBytesTruncated || issue.markdownBytesTruncated;
        }
      } else {
        merged.set(issue.code, { ...issue });
      }
    }
  }
  return [...merged.values()];
}
function classifyDocumentStatus(issues, failed) {
  if (failed) {
    return "failed";
  }
  if (issues.some((issue) => issue.level === "unsupported")) {
    return "unsupported";
  }
  if (issues.some((issue) => issue.level === "degraded")) {
    return "degraded";
  }
  return "success";
}
function summarizeImportReports(reports) {
  let successCount = 0;
  let failedCount = 0;
  let degradedCount = 0;
  let unsupportedCount = 0;
  let degradedIssueCount = 0;
  let unsupportedIssueCount = 0;
  for (const report of reports) {
    switch (report.status) {
      case "success":
        successCount += 1;
        break;
      case "failed":
        failedCount += 1;
        break;
      case "degraded":
        degradedCount += 1;
        break;
      case "unsupported":
        unsupportedCount += 1;
        break;
    }
    for (const issue of report.issues) {
      if (issue.level === "degraded") {
        degradedIssueCount += issue.count;
      } else {
        unsupportedIssueCount += issue.count;
      }
    }
  }
  return {
    successCount,
    failedCount,
    degradedCount,
    unsupportedCount,
    degradedIssueCount,
    unsupportedIssueCount
  };
}
function summarizeDegradedIssuesByCode(reports) {
  const merged = /* @__PURE__ */ new Map();
  for (const report of reports) {
    for (const issue of report.issues) {
      if (issue.level !== "degraded") {
        continue;
      }
      const existing = merged.get(issue.code);
      if (existing) {
        existing.count += issue.count;
        if (issue.code === "av_truncated") {
          existing.omittedRows = (existing.omittedRows ?? 0) + (issue.omittedRows ?? 0);
          existing.omittedColumns = (existing.omittedColumns ?? 0) + (issue.omittedColumns ?? 0);
        }
      } else {
        merged.set(issue.code, {
          count: issue.count,
          omittedRows: issue.omittedRows,
          omittedColumns: issue.omittedColumns
        });
      }
    }
  }
  return [...merged.entries()].map(([code, summary]) => ({ code, ...summary })).sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

// src/lib/import/siyuan/import-result.ts
var MAX_RESULT_DOCUMENT_REPORTS = 500;
function buildImportResult(documentReports, assetCount, notebookCount, discoveredDocumentCount) {
  const summary = summarizeImportReports(documentReports);
  const issueDocuments = documentReports.filter((document) => document.status !== "success");
  const documentsTruncated = issueDocuments.length > MAX_RESULT_DOCUMENT_REPORTS;
  const totalDocuments = documentReports.length;
  const omittedDocumentCount = Math.max(0, discoveredDocumentCount - totalDocuments);
  return {
    totalDocuments,
    documentCount: totalDocuments,
    discoveredDocumentCount,
    omittedDocumentCount,
    assetCount,
    notebookCount,
    documents: issueDocuments.slice(0, MAX_RESULT_DOCUMENT_REPORTS),
    documentsTruncated,
    degradedIssuesSummary: summarizeDegradedIssuesByCode(documentReports),
    ...summary
  };
}

// src/lib/fs/exclusive-file.ts
var COPY_BUFFER_BYTES = 1024 * 1024;
var tauriFileSystem = { open, remove };
function shouldCleanupExclusiveTarget(createdTarget, completed) {
  return createdTarget && !completed;
}
function assertDistinctCopyPaths(sourcePath, targetPath) {
  if (sourcePath === targetPath) {
    throw new Error("Refusing to copy a file onto itself");
  }
}
async function writeAll(file, data) {
  let offset = 0;
  while (offset < data.length) {
    const bytesWritten = await file.write(data.subarray(offset));
    if (bytesWritten <= 0) {
      throw new Error("Failed to make progress while writing file");
    }
    offset += bytesWritten;
  }
}
async function copyFileExclusive(sourcePath, targetPath, fileSystem = tauriFileSystem) {
  assertDistinctCopyPaths(sourcePath, targetPath);
  const source = await fileSystem.open(sourcePath, { read: true });
  let target = null;
  let createdTarget = false;
  let completed = false;
  try {
    target = await fileSystem.open(targetPath, { write: true, createNew: true });
    createdTarget = true;
    const buffer = new Uint8Array(COPY_BUFFER_BYTES);
    while (true) {
      const bytesRead = await source.read(buffer);
      if (bytesRead === null) {
        break;
      }
      if (bytesRead > 0) {
        await writeAll(target, buffer.subarray(0, bytesRead));
      }
    }
    await target.close();
    target = null;
    completed = true;
  } finally {
    await source.close().catch(() => {
    });
    if (target) {
      await target.close().catch(() => {
      });
    }
    if (shouldCleanupExclusiveTarget(createdTarget, completed)) {
      await fileSystem.remove(targetPath).catch(() => {
      });
    }
  }
}
async function writeTextFileExclusive(path3, content, fileSystem = tauriFileSystem) {
  let file = null;
  let createdTarget = false;
  let completed = false;
  try {
    file = await fileSystem.open(path3, { write: true, createNew: true });
    createdTarget = true;
    await writeAll(file, new TextEncoder().encode(content));
    await file.close();
    file = null;
    completed = true;
  } finally {
    if (file) {
      await file.close().catch(() => {
      });
    }
    if (shouldCleanupExclusiveTarget(createdTarget, completed)) {
      await fileSystem.remove(path3).catch(() => {
      });
    }
  }
}

// src/lib/writing-assets-path.ts
function getWritingAssetsDirName(assetsPath) {
  const normalized = assetsPath?.trim();
  return normalized ? normalized : "assets";
}

// src/lib/import/siyuan/document-discovery.ts
async function discoverSyPathsInNotebookTree(dirPath, hooks) {
  hooks?.onDirectoryEnter?.(dirPath);
  const paths = [];
  const entries = await readDir(dirPath);
  const documentChildDirNames = new Set(
    entries.filter((entry) => entry.isFile && entry.name.endsWith(".sy")).map((entry) => entry.name.replace(/\.sy$/, "")).filter(isDocumentId)
  );
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SIYUAN_DATA_SUBDIRS.has(entry.name)) {
      continue;
    }
    const entryPath = await join(dirPath, entry.name);
    if (entry.isFile && entry.name.endsWith(".sy")) {
      paths.push(entryPath);
      const fileId = entry.name.replace(/\.sy$/, "");
      if (isDocumentId(fileId)) {
        const childDir = await join(dirPath, fileId);
        if (await exists(childDir)) {
          const childInfo = await lstat(childDir);
          if (childInfo.isDirectory && !childInfo.isSymlink) {
            paths.push(...await discoverSyPathsInNotebookTree(childDir, hooks));
          }
        }
      }
      continue;
    }
    if (entry.isDirectory) {
      if (isDocumentId(entry.name) && documentChildDirNames.has(entry.name)) {
        continue;
      }
      paths.push(...await discoverSyPathsInNotebookTree(entryPath, hooks));
    }
  }
  return paths;
}
async function discoverSyPathsAtDocumentRoot(dirPath) {
  const paths = [];
  const entries = await readDir(dirPath);
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SIYUAN_DATA_SUBDIRS.has(entry.name)) {
      continue;
    }
    const entryPath = await join(dirPath, entry.name);
    if (entry.isFile && entry.name.endsWith(".sy")) {
      paths.push(entryPath);
      const fileId = entry.name.replace(/\.sy$/, "");
      if (isDocumentId(fileId)) {
        const childDir = await join(dirPath, fileId);
        if (await exists(childDir)) {
          const childInfo = await lstat(childDir);
          if (childInfo.isDirectory && !childInfo.isSymlink) {
            paths.push(...await discoverSyPathsInNotebookTree(childDir));
          }
        }
      }
    }
  }
  return paths;
}
async function listVerifiedNotebookDirectories(dataRoot) {
  const entries = await readDir(dataRoot);
  const notebookDirs = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SIYUAN_DATA_SUBDIRS.has(entry.name) || !entry.isDirectory) {
      continue;
    }
    const entryPath = await join(dataRoot, entry.name);
    if (await hasSiYuanNotebookMarker(entryPath)) {
      notebookDirs.push(entryPath);
    }
  }
  return notebookDirs;
}
async function countRootLevelSyFiles(dataRoot) {
  const entries = await readDir(dataRoot);
  return entries.filter((entry) => entry.isFile && entry.name.endsWith(".sy")).length;
}
async function discoverImportableSyPaths(dataRoot) {
  const notebookDirs = await listVerifiedNotebookDirectories(dataRoot);
  const discovered = /* @__PURE__ */ new Set();
  for (const notebookDir of notebookDirs) {
    for (const syPath of await discoverSyPathsInNotebookTree(notebookDir)) {
      discovered.add(syPath);
    }
  }
  for (const syPath of await discoverSyPathsAtDocumentRoot(dataRoot)) {
    discovered.add(syPath);
  }
  return [...discovered];
}
async function countImportableSyDocuments(dataRoot) {
  return (await discoverImportableSyPaths(dataRoot)).length;
}
function assertDiscoveredDocumentsScheduled(discoveredCount, plannedCount, failedDuringPlanningCount) {
  const scheduledCount = plannedCount + failedDuringPlanningCount;
  if (discoveredCount !== scheduledCount) {
    throw new Error(
      `SiYuan import planning dropped ${discoveredCount - scheduledCount} document(s): discovered ${discoveredCount}, scheduled ${scheduledCount}`
    );
  }
}

// src/lib/import/siyuan/importer.ts
var MAX_SY_DOCUMENT_BYTES = 64 * 1024 * 1024;
function shouldAbortImportPlanning(error) {
  return error instanceof SyImportAbortedError || error instanceof SyImportBudgetExceededError;
}
async function yieldToUi(index) {
  if (index % 5 === 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}
function emitProgress(onProgress, progress) {
  onProgress?.(progress);
}
async function readNotebookName(notebookDir, notebookId) {
  const confPath = await join(notebookDir, ".siyuan", "conf.json");
  if (await exists(confPath)) {
    try {
      const fileInfo = await lstat(confPath);
      if (!fileInfo.isFile || fileInfo.isSymlink) {
        throw new Error("Invalid SiYuan notebook configuration");
      }
      const conf = JSON.parse(await readTextFile(confPath));
      if (conf.name?.trim()) {
        return sanitizeFileName(conf.name, notebookId);
      }
    } catch {
    }
  }
  return sanitizeFileName(notebookId, notebookId);
}
async function parseSyDocument(syPath) {
  const fileInfo = await stat(syPath);
  if (!fileInfo.isFile || fileInfo.size > MAX_SY_DOCUMENT_BYTES) {
    throw new Error(`Invalid or oversized SiYuan document: ${syPath}`);
  }
  const content = await readTextFile(syPath);
  return {
    document: parseAndValidateSiYuanDocument(content, syPath),
    byteSize: fileInfo.size
  };
}
async function planDirectoryDocuments(dirPath, parentRelativePath, assetsDirName, allocator, plans, failedReports, budget, signal, onProgress, progressState) {
  throwIfAborted(signal);
  const entries = await readDir(dirPath);
  for (const entry of entries) {
    throwIfAborted(signal);
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = await join(dirPath, entry.name);
    if (!entry.isFile || !entry.name.endsWith(".sy")) {
      continue;
    }
    const fileId = entry.name.replace(/\.sy$/, "");
    let currentTitle = fileId;
    let fileName = sanitizeFileName(fileId, "untitled");
    let childDirPath = null;
    let childDirRelativePath = null;
    try {
      if (!isDocumentId(fileId)) {
        throw new Error(`Invalid SiYuan document filename: ${entry.name}`);
      }
      const { document, byteSize } = await parseSyDocument(entryPath);
      budget.trackDocument(document, byteSize);
      if (document.ID !== fileId) {
        throw new Error(`SiYuan document ID does not match filename: ${entry.name}`);
      }
      currentTitle = document.Properties?.title ?? document.ID;
      fileName = sanitizeFileName(currentTitle, document.ID);
      const childDir = await join(dirPath, fileId);
      if (await exists(childDir)) {
        const childInfo = await lstat(childDir);
        if (childInfo.isDirectory && !childInfo.isSymlink) {
          childDirPath = childDir;
          childDirRelativePath = allocator.allocateRelativeDir(parentRelativePath, fileName);
        }
      }
      const mdParentRelativePath = childDirRelativePath ?? parentRelativePath;
      const mdRelativePath = allocator.allocateRelativeFile(mdParentRelativePath, `${fileName}.md`);
      const assetOutputDir = getNoteGenAssetOutputDir(mdRelativePath, assetsDirName);
      plans.push({
        syPath: entryPath,
        mdAbsolutePath: allocator.toAbsolutePath(mdRelativePath),
        mdRelativePath,
        title: currentTitle,
        documentId: document.ID,
        assetOutputDir
      });
    } catch (error) {
      if (shouldAbortImportPlanning(error)) {
        throw error;
      }
      failedReports.push({
        title: currentTitle,
        syPath: entryPath,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        issues: []
      });
    }
    if (progressState) {
      progressState.current += 1;
      emitProgress(onProgress, {
        phase: "planning",
        current: progressState.current,
        total: progressState.total,
        currentTitle
      });
      await yieldToUi(progressState.current);
    }
    if (!isDocumentId(fileId)) {
      continue;
    }
    if (childDirPath && childDirRelativePath) {
      await planDirectoryDocuments(
        childDirPath,
        childDirRelativePath,
        assetsDirName,
        allocator,
        plans,
        failedReports,
        budget,
        signal,
        onProgress,
        progressState
      );
    }
  }
}
async function planNotebook(notebookDir, assetsDirName, allocator, plans, failedReports, budget, signal, onProgress, progressState) {
  const notebookId = await basename(notebookDir);
  const notebookName = await readNotebookName(notebookDir, notebookId);
  const notebookRelativePath = allocator.allocateRelativeDir("", notebookName);
  await planDirectoryDocuments(
    notebookDir,
    notebookRelativePath,
    assetsDirName,
    allocator,
    plans,
    failedReports,
    budget,
    signal,
    onProgress,
    progressState
  );
}
async function resolveRegularFileUnderRoot(root, relativePath) {
  let currentPath = root;
  const segments = relativePath.replace(/\\/g, "/").split("/");
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = await join(currentPath, segments[index]);
    if (!await exists(currentPath)) {
      return null;
    }
    const pathInfo = await lstat(currentPath);
    if (pathInfo.isSymlink) {
      return null;
    }
    const isLastSegment = index === segments.length - 1;
    if (isLastSegment && !pathInfo.isFile || !isLastSegment && !pathInfo.isDirectory) {
      return null;
    }
  }
  return currentPath;
}
async function copyAssetIfNeeded(assetPath, dataRoot, targetDir, assetOutputDir, copiedAssets) {
  const copyKey = `${assetOutputDir}::${assetPath}`;
  if (copiedAssets.has(copyKey)) {
    return "already_copied";
  }
  const assetReference = parseSiYuanAssetReference(assetPath);
  if (!assetReference || assetReference.sourcePath !== assetPath) {
    throw new Error(`Unsafe SiYuan asset path rejected: ${assetPath}`);
  }
  const sourcePath = await resolveRegularFileUnderRoot(dataRoot, assetReference.sourcePath);
  if (!sourcePath) {
    return "missing";
  }
  const targetRelativePath = getImportedAssetRelativePath(
    assetReference.sourcePath,
    assetOutputDir
  );
  const targetPath = await join(targetDir, targetRelativePath);
  const targetParent = await dirname(targetPath);
  if (!await exists(targetParent)) {
    await mkdir(targetParent, { recursive: true });
  }
  try {
    await copyFileExclusive(sourcePath, targetPath);
  } catch (error) {
    throw new Error(
      `Failed to create imported asset without overwriting ${targetRelativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  copiedAssets.add(copyKey);
  return "copied";
}
async function rollbackWrittenMarkdown(paths) {
  for (const filePath of [...paths].reverse()) {
    try {
      await remove(filePath);
    } catch {
    }
  }
}
async function rollbackCopiedAssets(assetCopyKeys, targetDir, copiedAssets) {
  const cleanupErrors = [];
  let removedCount = 0;
  for (const copyKey of [...assetCopyKeys].reverse()) {
    const separatorIndex = copyKey.indexOf("::");
    if (separatorIndex <= 0) {
      continue;
    }
    const assetOutputDir = copyKey.slice(0, separatorIndex);
    const assetPath = copyKey.slice(separatorIndex + 2);
    const targetRelativePath = getImportedAssetRelativePath(assetPath, assetOutputDir);
    const targetPath = await join(targetDir, targetRelativePath);
    try {
      await remove(targetPath);
      copiedAssets.delete(copyKey);
      removedCount += 1;
    } catch (error) {
      cleanupErrors.push(
        `${targetRelativePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { removedCount, errors: cleanupErrors };
}
async function createImportPathAllocator(targetDir) {
  const allocator = new ImportPathAllocator(targetDir);
  if (!await exists(targetDir)) {
    return allocator;
  }
  for (const entry of await readDir(targetDir)) {
    allocator.reserveRelativePath(entry.name);
  }
  return allocator;
}
async function collectImportPlans(dataRoot, targetDir, assetsDirName, signal, onProgress) {
  throwIfAborted(signal);
  const allocator = await createImportPathAllocator(targetDir);
  const plans = [];
  const failedReports = [];
  const budget = new ImportBudgetTracker();
  const notebookDirs = await listVerifiedNotebookDirectories(dataRoot);
  const rootSyFileCount = await countRootLevelSyFiles(dataRoot);
  const discoveredDocumentCount = await countImportableSyDocuments(dataRoot);
  const estimatedTotal = Math.max(discoveredDocumentCount, 1);
  emitProgress(onProgress, { phase: "planning", current: 0, total: estimatedTotal });
  const progressState = { current: 0, total: estimatedTotal };
  for (const notebookDir of notebookDirs) {
    throwIfAborted(signal);
    await planNotebook(
      notebookDir,
      assetsDirName,
      allocator,
      plans,
      failedReports,
      budget,
      signal,
      onProgress,
      progressState
    );
  }
  if (rootSyFileCount > 0) {
    throwIfAborted(signal);
    const archiveName = sanitizeFileName(await basename(dataRoot), "SiYuan Import");
    const importRelativePath = allocator.allocateRelativeDir("", archiveName);
    await planDirectoryDocuments(
      dataRoot,
      importRelativePath,
      assetsDirName,
      allocator,
      plans,
      failedReports,
      budget,
      signal,
      onProgress,
      progressState
    );
  }
  if (notebookDirs.length === 0 && rootSyFileCount === 0) {
    throw new Error("No SiYuan notebooks found in the selected directory.");
  }
  assertDiscoveredDocumentsScheduled(discoveredDocumentCount, plans.length, failedReports.length);
  const notebookCount = notebookDirs.length > 0 ? notebookDirs.length : rootSyFileCount > 0 ? 1 : 0;
  return {
    plans,
    failedReports,
    notebookCount,
    discoveredDocumentCount
  };
}
async function importSiYuanData(options) {
  const writtenMarkdownPaths = [];
  const copiedAssets = /* @__PURE__ */ new Set();
  const assetsDirName = getWritingAssetsDirName(options.assetsDirName);
  let targetDir = options.targetDir;
  try {
    const {
      plans,
      failedReports,
      notebookCount,
      discoveredDocumentCount
    } = await collectImportPlans(
      options.dataRoot,
      options.targetDir,
      assetsDirName,
      options.signal,
      options.onProgress
    );
    targetDir = options.targetDir;
    throwIfAborted(options.signal);
    emitProgress(options.onProgress, {
      phase: "loading_av",
      current: 0,
      total: plans.length
    });
    const attributeViews = await loadAttributeViews(options.dataRoot, options.signal);
    throwIfAborted(options.signal);
    emitProgress(options.onProgress, {
      phase: "indexing",
      current: 0,
      total: plans.length
    });
    const blockIndex = /* @__PURE__ */ new Map();
    for (let index = 0; index < plans.length; index += 1) {
      throwIfAborted(options.signal);
      const plan = plans[index];
      const { document } = await parseSyDocument(plan.syPath);
      const partialIndex = buildBlockIndex([{
        document,
        mdRelativePath: plan.mdRelativePath
      }]);
      for (const [blockId, target] of partialIndex) {
        blockIndex.set(blockId, target);
      }
      emitProgress(options.onProgress, {
        phase: "indexing",
        current: index + 1,
        total: plans.length,
        currentTitle: plan.title
      });
      await yieldToUi(index);
    }
    let assetCount = 0;
    const documentReports = [...failedReports];
    for (let index = 0; index < plans.length; index += 1) {
      throwIfAborted(options.signal);
      const plan = plans[index];
      const title = plan.title;
      const newlyCopiedAssetKeys = [];
      emitProgress(options.onProgress, {
        phase: "importing",
        current: index + 1,
        total: plans.length,
        currentTitle: title
      });
      try {
        const { document } = await parseSyDocument(plan.syPath);
        const parentDir = await dirname(plan.mdAbsolutePath);
        if (!await exists(parentDir)) {
          await mkdir(parentDir, { recursive: true });
        }
        const converted = convertSyDocumentToMarkdown(document, {
          blockIndex,
          attributeViews,
          currentMdPath: plan.mdRelativePath,
          assetOutputDir: plan.assetOutputDir
        });
        const missingAssets = [];
        for (const assetPath of converted.assetPaths) {
          const copyKey = `${plan.assetOutputDir}::${assetPath}`;
          const copyResult = await copyAssetIfNeeded(
            assetPath,
            options.dataRoot,
            options.targetDir,
            plan.assetOutputDir,
            copiedAssets
          );
          if (copyResult === "copied") {
            assetCount += 1;
            newlyCopiedAssetKeys.push(copyKey);
          } else if (copyResult === "missing") {
            missingAssets.push(assetPath);
          }
        }
        const issues = mergeImportIssues(
          scanDocumentIssues(document, { blockIndex, attributeViews }),
          scanMarkdownIssues(
            converted.markdown,
            missingAssets,
            converted.invalidAssetPaths
          ),
          converted.importIssues
        );
        const status = classifyDocumentStatus(issues, false);
        try {
          await writeTextFileExclusive(plan.mdAbsolutePath, converted.markdown);
          writtenMarkdownPaths.push(plan.mdAbsolutePath);
        } catch (error) {
          throw new Error(
            `Failed to create imported note without overwriting ${plan.mdRelativePath}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
        documentReports.push({
          title,
          syPath: plan.syPath,
          mdRelativePath: plan.mdRelativePath,
          status,
          issues
        });
      } catch (error) {
        const rollback = await rollbackCopiedAssets(
          newlyCopiedAssetKeys,
          options.targetDir,
          copiedAssets
        );
        assetCount -= rollback.removedCount;
        const errorMessage = error instanceof Error ? error.message : String(error);
        documentReports.push({
          title,
          syPath: plan.syPath,
          mdRelativePath: plan.mdRelativePath,
          status: "failed",
          errorMessage: rollback.errors.length > 0 ? `${errorMessage}; asset cleanup failed: ${rollback.errors.join(", ")}` : errorMessage,
          issues: []
        });
      }
      await yieldToUi(index);
    }
    emitProgress(options.onProgress, {
      phase: "done",
      current: documentReports.length,
      total: documentReports.length
    });
    const result = buildImportResult(
      documentReports,
      assetCount,
      notebookCount,
      discoveredDocumentCount
    );
    if (result.omittedDocumentCount > 0) {
      throw new Error(
        `SiYuan import omitted ${result.omittedDocumentCount} document(s) from the result report`
      );
    }
    if (result.totalDocuments !== discoveredDocumentCount) {
      throw new Error(
        `SiYuan import document accounting mismatch: discovered ${discoveredDocumentCount}, reported ${result.totalDocuments}`
      );
    }
    return result;
  } catch (error) {
    if (error instanceof SyImportAbortedError) {
      await rollbackWrittenMarkdown(writtenMarkdownPaths);
      if (copiedAssets.size > 0) {
        await rollbackCopiedAssets([...copiedAssets], targetDir, copiedAssets);
      }
    }
    throw error;
  }
}

// scripts/siyuan-import-worker.mjs
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-root") {
      options.dataRoot = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--target-dir") {
      options.targetDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--assets-dir-name") {
      options.assetsDirName = argv[index + 1];
      index += 1;
    }
  }
  return options;
}
function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}
`);
}
function emitProgress2(progress) {
  emit({ type: "progress", payload: progress });
}
function emitError(error) {
  const message = error instanceof Error ? error.message : String(error);
  emit({ type: "error", message });
}
function listenForCancel(abortController) {
  if (process.stdin.isTTY) {
    return () => {
    };
  }
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });
  rl.on("line", (line) => {
    if (line.trim() === "cancel") {
      abortController.abort();
    }
  });
  return () => rl.close();
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dataRoot || !options.targetDir) {
    throw new Error("Missing required --data-root or --target-dir");
  }
  const abortController = new AbortController();
  const stopListening = listenForCancel(abortController);
  try {
    const result = await importSiYuanData({
      dataRoot: options.dataRoot,
      targetDir: options.targetDir,
      assetsDirName: options.assetsDirName,
      signal: abortController.signal,
      onProgress: emitProgress2
    });
    emit({ type: "result", payload: result });
  } catch (error) {
    if (error instanceof SyImportAbortedError) {
      emit({ type: "cancelled", payload: { rolledBack: true } });
      return;
    }
    throw error;
  } finally {
    stopListening();
  }
}
main().catch((error) => {
  emitError(error);
  process.exitCode = 1;
});
