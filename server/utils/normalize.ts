function table(groups: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(groups)) {
    out[canonical.toLowerCase()] = canonical;
    for (const alias of aliases) out[alias.toLowerCase()] = canonical;
  }
  return out;
}

const EDITORS = table({
  "VS Code": [
    "vscode",
    "visual studio code",
    "code",
    "code - visual studio code",
  ],
  "VS Code Insiders": [
    "vscode insiders",
    "visual studio code - insiders",
    "code - insiders",
  ],
  VSCodium: [],
  "Code - OSS": ["code-oss"],
  Cursor: [],
  Windsurf: [],
  Void: [],
  Trae: [],
  PearAI: ["pear ai"],
  Zed: [],
  "Zed Preview": ["zed dev"],
  "IntelliJ IDEA": [
    "intellijidea",
    "intellij community edition",
    "intellij ultimate edition",
    "intellij idea community edition",
    "intellij idea ultimate edition",
    "intellij idea community",
    "intellij idea ultimate",
    "intellij ultimate",
    "intellij community",
  ],
  PyCharm: ["pycharm professional", "pycharm community", "pycharm community edition"],
  GoLand: [],
  RustRover: [],
  CLion: [],
  Rider: [],
  DataGrip: [],
  RubyMine: [],
  WebStorm: [],
  PhpStorm: [],
  "Android Studio": [],
  Xcode: [],
  "Sublime Text": [],
  Atom: [],
  Vim: [],
  Neovim: ["nvim"],
  Emacs: [],
  Unknown: [],
});

const OPERATING_SYSTEMS = table({
  macOS: ["mac", "mac os", "mac os x", "macosx", "osx", "os x", "darwin", "macintosh"],
  Windows: ["win", "win32", "windows nt", "windows_nt"],
  Linux: [],
  Unknown: [],
});

const LANGUAGES = table({
  Rust: [],
  TypeScript: [],
  TSX: ["typescriptreact", "typescript jsx"],
  JavaScript: [],
  JSX: ["javascriptreact", "jsx harmony"],
  Vue: ["vue.js", "vuejs"],
  TOML: [],
  SCSS: [],
  Sass: [],
  CSS: [],
  Less: [],
  JSON: [],
  JSONC: ["json with comments"],
  JSONL: [],
  Text: ["plaintext", "plain_text", "plain text"],
  MDC: [],
  YAML: ["yml"],
  Python: [],
  Markdown: ["md"],
  MDX: [],
  SQL: [],
  MySQL: [],
  Log: [],
  Shell: ["shellscript", "shell script", "bash", "sh", "zsh"],
  Dotenv: ["env"],
  "Env Spec": ["env-spec"],
  "Docker Compose": ["dockercompose"],
  Docker: ["dockerfile"],
  "Java Properties": ["properties", "java-properties"],
  Swift: [],
  Go: [],
  Kotlin: [],
  Java: [],
  Astro: [],
  Prisma: [],
  HTML: [],
  XML: [],
  XSL: [],
  Makefile: [],
  Lua: [],
  Ruby: [],
  C: [],
  "C++": ["cpp"],
  "C#": ["csharp"],
  PHP: [],
  R: [],
  Perl: [],
  Zig: [],
  Nix: [],
  Scheme: [],
  Prolog: [],
  Assembly: [],
  INI: [],
  Diff: [],
  Git: ["git-commit", "git-rebase"],
  Gitignore: ["ignore", "gitignore file"],
  "Git Config": ["gitconfig"],
  CSV: ["dynamic csv"],
  TSV: [],
  SVG: ["image (svg)"],
  Handlebars: [],
  "SSH Config": ["ssh_config"],
  Batchfile: ["batch", "bat"],
  "Objective-C": [],
  KDL: [],
  RON: [],
  "GitHub Actions": ["github-actions-workflow"],
  TextMate: [],
  Groovy: [],
  "Gradle Kotlin DSL": ["gradle-kotlin-dsl"],
  TSConfig: [],
  "Gettext Catalog": [],
  "Pip Requirements": ["pip-requirements"],
  CocoaPods: [],
  Modelica: [],
  MiniScript: [],
  TeX: [],
  LaTeX: [],
  PowerShell: [],
  GraphQL: [],
  BibTeX: [],
  CoffeeScript: [],
  "F#": ["fsharp"],
  "Objective-C++": ["objective-cpp"],
  OCaml: [],
  HCL: [],
  "Visual Basic": ["vb"],
  Protobuf: ["proto", "proto3"],
  GLSL: [],
  HLSL: [],
  WGSL: [],
  CUDA: ["cuda-cpp"],
  ShaderLab: [],
  Dart: [],
  Scala: [],
  Elixir: [],
  Erlang: [],
  Haskell: [],
  Clojure: [],
  Julia: [],
  Svelte: [],
  Pug: [],
  Stylus: [],
  Razor: [],
  Terraform: ["terraform-vars"],
  Jinja: [],
  Twig: [],
  Liquid: [],
  Gleam: [],
  Solidity: [],
  Rego: [],
});

function titleCase(value: string): string {
  if (value !== value.toLowerCase()) return value;
  return value.replace(/(^|[\s_-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

type NameKind = "editor" | "language" | "os";

const learned: Record<NameKind, Map<string, string>> = {
  editor: new Map(),
  language: new Map(),
  os: new Map(),
};

const staticTables: Record<NameKind, Record<string, string>> = {
  editor: EDITORS,
  language: LANGUAGES,
  os: OPERATING_SYSTEMS,
};

function upperCount(value: string): number {
  return value.replace(/[^A-Z]/g, "").length;
}

export function learnNames(
  kind: NameKind,
  rows: Array<{ value: string | null; count: number }>
) {
  const groups = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const value = row.value?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (staticTables[kind][key]) continue;
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(value, (spellings.get(value) ?? 0) + Number(row.count));
    groups.set(key, spellings);
  }

  const next = new Map<string, string>();
  for (const [key, spellings] of groups) {
    if (spellings.size < 2) continue;
    const best = [...spellings.entries()].sort(
      (a, b) =>
        upperCount(b[0]) - upperCount(a[0]) ||
        b[1] - a[1] ||
        a[0].localeCompare(b[0])
    )[0]!;
    next.set(key, best[0]);
  }
  learned[kind] = next;
}

function normalize(
  kind: NameKind,
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  return (
    staticTables[kind][key] ?? learned[kind].get(key) ?? titleCase(trimmed)
  );
}

export function normalizeEditor(value: string | null | undefined) {
  return normalize("editor", value);
}

export function normalizeOs(value: string | null | undefined) {
  return normalize("os", value);
}

export function normalizeLanguage(value: string | null | undefined) {
  return normalize("language", value);
}

export function normalizeKeys(
  counts: unknown,
  fn: (value: string) => string | null
): { value: Record<string, number>; changed: boolean } {
  const source =
    counts && typeof counts === "object" && !Array.isArray(counts)
      ? (counts as Record<string, number>)
      : {};
  const value: Record<string, number> = {};
  let changed = false;
  for (const [key, seconds] of Object.entries(source)) {
    const target = fn(key);
    if (target !== key) changed = true;
    if (target === null) continue;
    value[target] = (value[target] ?? 0) + Number(seconds);
  }
  return { value, changed };
}
