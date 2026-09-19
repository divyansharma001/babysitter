import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import process from "node:process";

const IMAGE_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

export function imageMediaType(path) {
  return IMAGE_TYPES.get(extname(path).toLowerCase()) || "";
}

export function resolveImagePath(value, cwd = process.cwd()) {
  const unquoted = value.trim().replace(/^['"]|['"]$/g, "");
  const path = isAbsolute(unquoted) ? unquoted : resolve(cwd, unquoted);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Image not found: ${unquoted}`);
  if (!imageMediaType(path)) throw new Error("Supported image formats are PNG, JPEG, GIF, and WebP.");
  return path;
}

export function captureClipboardImage(cwd = process.cwd()) {
  if (process.platform !== "darwin") {
    throw new Error("Clipboard image capture currently requires macOS. Use /image <path> on this platform.");
  }
  const directory = resolve(cwd, ".babysitter", "attachments");
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `clipboard-${Date.now()}-${process.pid}.png`);
  const script = [
    'ObjC.import("AppKit");',
    'function run(argv) {',
    '  const pasteboard = $.NSPasteboard.generalPasteboard;',
    '  const image = $.NSImage.alloc.initWithPasteboard(pasteboard);',
    '  if (!ObjC.unwrap(image)) throw new Error("The clipboard does not contain an image.");',
    '  const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);',
    '  const data = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));',
    '  if (!data.writeToFileAtomically($(argv[0]), true)) throw new Error("Could not save the clipboard image.");',
    '}',
  ].join("\n");
  try {
    execFileSync("osascript", ["-l", "JavaScript", "-e", script, path], { stdio: ["ignore", "ignore", "pipe"], timeout: 5000 });
    return path;
  } catch (error) {
    try { unlinkSync(path); } catch {}
    const message = error.stderr?.toString().trim().split("\n").at(-1) || error.message;
    throw new Error(`Could not attach the clipboard image: ${message}`);
  }
}

export function claudePromptWithImages(prompt, paths) {
  if (!paths.length) return prompt;
  const content = paths.map((path) => ({
    type: "image",
    source: { type: "base64", media_type: imageMediaType(path), data: readFileSync(path).toString("base64") },
  }));
  content.push({ type: "text", text: prompt });
  return (async function* messages() {
    yield {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    };
  }());
}
