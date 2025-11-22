import path from "path";
import { UserAgentInfo } from "./types";

const editorCapitalization: Record<string, string> = {
  cursor: "Cursor",
  "visual studio code": "Visual Studio Code",
  vscode: "Visual Studio Code",
  "vs code": "Visual Studio Code",
  "sublime text": "Sublime Text",
  atom: "Atom",
  vim: "Vim",
  neovim: "NeoVim",
  nvim: "NeoVim",
  emacs: "Emacs",
  "zed dev": "Zed Preview",
  pearai: "PearAI",
  "intellij idea": "IntelliJ IDEA",
  "intellij community edition": "IntelliJ IDEA",
  "intellij ultimate edition": "IntelliJ IDEA",
  intellijidea: "IntelliJ IDEA",
  pycharm: "PyCharm",
  webstorm: "WebStorm",
  phpstorm: "PhpStorm",
  "android studio": "Android Studio",
  xcode: "Xcode",
};

export function parseUserAgent(userAgent: string): UserAgentInfo {
  const userAgentPattern = /\(([^)]+)\).*?go[\d.]+\s([A-Za-z ]+)\/[\d.]+/i;

  if (!userAgent) {
    return { os: "", editor: "" };
  }

  const match = userAgent.match(userAgentPattern);

  if (match && match.length >= 3) {
    let os: string = match[1];
    let editor: string = match[2];

    const editorLower = editor.toLowerCase();
    editor =
      editorCapitalization[editorLower] ||
      editor.replace(/\b\w/g, (l) => l.toUpperCase());

    if (os.includes("darwin")) {
      os = "macOS";
    } else if (os.includes("linux")) {
      os = "Linux";
    } else if (os.includes("windows") || os.includes("win")) {
      os = "Windows";
    } else {
      os = "Linux";
    }

    return { os, editor };
  }

  const browserMatch = userAgent.match(
    /(Firefox|Chrome|Edge|Safari|Opera)\/([\d.]+)/i
  );
  const osMatch = userAgent.match(/\(([^)]+)\)/);

  if (browserMatch && browserMatch[1]) {
    let os = "Unknown";
    let editor = browserMatch[1];

    const editorLower = editor.toLowerCase();
    editor =
      editorCapitalization[editorLower] ||
      editor.replace(/\b\w/g, (l) => l.toUpperCase());

    if (osMatch && osMatch[1]) {
      const osInfo = osMatch[1].split(";")[0].trim();
      if (osInfo.startsWith("Windows")) {
        os = "Windows";
      } else if (osInfo.startsWith("Macintosh")) {
        os = "macOS";
      } else if (osInfo.startsWith("X11") || osInfo.startsWith("Linux")) {
        os = "Linux";
      } else {
        os = osInfo;
      }
    } else if (/windows/i.test(userAgent)) {
      os = "Windows";
    }

    return { os, editor };
  }

  return { os: "", editor: "" };
}

export function extractFileName(entity: string | undefined | null): string | null {
  return entity ? path.basename(entity) : null;
}

export function convertTimestamp(time: number): Date {
  return new Date(Math.round(time * 1000));
}
