use std::{
    collections::HashMap,
    sync::{LazyLock, RwLock},
};

type Group = (&'static str, &'static [&'static str]);

const EDITORS: &[Group] = &[
    (
        "VS Code",
        &[
            "vscode",
            "visual studio code",
            "code",
            "code - visual studio code",
        ],
    ),
    (
        "VS Code Insiders",
        &[
            "vscode insiders",
            "visual studio code - insiders",
            "code - insiders",
        ],
    ),
    ("VSCodium", &[]),
    ("Code - OSS", &["code-oss"]),
    ("Cursor", &[]),
    ("Windsurf", &[]),
    ("Void", &[]),
    ("Trae", &[]),
    ("PearAI", &["pear ai"]),
    ("Zed", &[]),
    ("Zed Preview", &["zed dev"]),
    (
        "IntelliJ IDEA",
        &[
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
    ),
    (
        "PyCharm",
        &[
            "pycharm professional",
            "pycharm community",
            "pycharm community edition",
        ],
    ),
    ("GoLand", &[]),
    ("RustRover", &[]),
    ("CLion", &[]),
    ("Rider", &[]),
    ("DataGrip", &[]),
    ("RubyMine", &[]),
    ("WebStorm", &[]),
    ("PhpStorm", &[]),
    ("Android Studio", &[]),
    ("Xcode", &[]),
    ("Sublime Text", &[]),
    ("Atom", &[]),
    ("Vim", &[]),
    ("Neovim", &["nvim"]),
    ("Emacs", &[]),
    ("Unknown", &[]),
];

const OPERATING_SYSTEMS: &[Group] = &[
    (
        "macOS",
        &[
            "mac",
            "mac os",
            "mac os x",
            "macosx",
            "osx",
            "os x",
            "darwin",
            "macintosh",
        ],
    ),
    ("Windows", &["win", "win32", "windows nt", "windows_nt"]),
    ("Linux", &[]),
    ("Unknown", &[]),
];

const LANGUAGES: &[Group] = &[
    ("Rust", &[]),
    ("TypeScript", &[]),
    ("TSX", &["typescriptreact", "typescript jsx"]),
    ("JavaScript", &[]),
    ("JSX", &["javascriptreact", "jsx harmony"]),
    ("Vue", &["vue.js", "vuejs"]),
    ("TOML", &[]),
    ("SCSS", &[]),
    ("Sass", &[]),
    ("CSS", &[]),
    ("Less", &[]),
    ("JSON", &[]),
    ("JSONC", &["json with comments"]),
    ("JSONL", &[]),
    ("Text", &["plaintext", "plain_text", "plain text"]),
    ("MDC", &[]),
    ("YAML", &["yml"]),
    ("Python", &[]),
    ("Markdown", &["md"]),
    ("MDX", &[]),
    ("SQL", &[]),
    ("MySQL", &[]),
    ("Log", &[]),
    (
        "Shell",
        &["shellscript", "shell script", "bash", "sh", "zsh"],
    ),
    ("Dotenv", &["env"]),
    ("Env Spec", &["env-spec"]),
    ("Docker Compose", &["dockercompose"]),
    ("Docker", &["dockerfile"]),
    ("Java Properties", &["properties", "java-properties"]),
    ("Swift", &[]),
    ("Go", &[]),
    ("Kotlin", &[]),
    ("Java", &[]),
    ("Astro", &[]),
    ("Prisma", &[]),
    ("HTML", &[]),
    ("XML", &[]),
    ("XSL", &[]),
    ("Makefile", &[]),
    ("Lua", &[]),
    ("Ruby", &[]),
    ("C", &[]),
    ("C++", &["cpp"]),
    ("C#", &["csharp"]),
    ("PHP", &[]),
    ("R", &[]),
    ("Perl", &[]),
    ("Zig", &[]),
    ("Nix", &[]),
    ("Scheme", &[]),
    ("Prolog", &[]),
    ("Assembly", &[]),
    ("INI", &[]),
    ("Diff", &[]),
    ("Git", &["git-commit", "git-rebase"]),
    ("Gitignore", &["ignore", "gitignore file"]),
    ("Git Config", &["gitconfig"]),
    ("CSV", &["dynamic csv"]),
    ("TSV", &[]),
    ("SVG", &["image (svg)"]),
    ("Handlebars", &[]),
    ("SSH Config", &["ssh_config"]),
    ("Batchfile", &["batch", "bat"]),
    ("Objective-C", &[]),
    ("KDL", &[]),
    ("RON", &[]),
    ("GitHub Actions", &["github-actions-workflow"]),
    ("TextMate", &[]),
    ("Groovy", &[]),
    ("Gradle Kotlin DSL", &["gradle-kotlin-dsl"]),
    ("TSConfig", &[]),
    ("Gettext Catalog", &[]),
    ("Pip Requirements", &["pip-requirements"]),
    ("CocoaPods", &[]),
    ("Modelica", &[]),
    ("MiniScript", &[]),
    ("TeX", &[]),
    ("LaTeX", &[]),
    ("PowerShell", &[]),
    ("GraphQL", &[]),
    ("BibTeX", &[]),
    ("CoffeeScript", &[]),
    ("F#", &["fsharp"]),
    ("Objective-C++", &["objective-cpp"]),
    ("OCaml", &[]),
    ("HCL", &[]),
    ("Visual Basic", &["vb"]),
    ("Protobuf", &["proto", "proto3"]),
    ("GLSL", &[]),
    ("HLSL", &[]),
    ("WGSL", &[]),
    ("CUDA", &["cuda-cpp"]),
    ("ShaderLab", &[]),
    ("Dart", &[]),
    ("Scala", &[]),
    ("Elixir", &[]),
    ("Erlang", &[]),
    ("Haskell", &[]),
    ("Clojure", &[]),
    ("Julia", &[]),
    ("Svelte", &[]),
    ("Pug", &[]),
    ("Stylus", &[]),
    ("Razor", &[]),
    ("Terraform", &["terraform-vars"]),
    ("Jinja", &[]),
    ("Twig", &[]),
    ("Liquid", &[]),
    ("Gleam", &[]),
    ("Solidity", &[]),
    ("Rego", &[]),
];

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum NameKind {
    Editor,
    Language,
    Os,
}

fn build(groups: &[Group]) -> HashMap<String, &'static str> {
    let mut out = HashMap::new();
    for (canonical, aliases) in groups {
        let canonical: &'static str = Box::leak(canonical.to_string().into_boxed_str());
        out.insert(canonical.to_lowercase(), canonical);
        for alias in *aliases {
            out.insert(alias.to_lowercase(), canonical);
        }
    }
    out
}

static EDITOR_TABLE: LazyLock<HashMap<String, &'static str>> = LazyLock::new(|| build(EDITORS));
static OS_TABLE: LazyLock<HashMap<String, &'static str>> =
    LazyLock::new(|| build(OPERATING_SYSTEMS));
static LANGUAGE_TABLE: LazyLock<HashMap<String, &'static str>> = LazyLock::new(|| build(LANGUAGES));

static LEARNED: LazyLock<RwLock<HashMap<NameKind, HashMap<String, String>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn static_table(kind: NameKind) -> &'static HashMap<String, &'static str> {
    match kind {
        NameKind::Editor => &EDITOR_TABLE,
        NameKind::Language => &LANGUAGE_TABLE,
        NameKind::Os => &OS_TABLE,
    }
}

fn title_case(value: &str) -> String {
    if value != value.to_lowercase() {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len());
    let mut boundary = true;
    for ch in value.chars() {
        if boundary && ch.is_ascii_lowercase() {
            out.push(ch.to_ascii_uppercase());
        } else {
            out.push(ch);
        }
        boundary = ch.is_whitespace() || ch == '_' || ch == '-';
    }
    out
}

fn upper_count(value: &str) -> usize {
    value.chars().filter(|c| c.is_ascii_uppercase()).count()
}

pub fn learn_names(kind: NameKind, rows: &[(Option<String>, i64)]) {
    let table = static_table(kind);
    let mut groups: HashMap<String, HashMap<String, i64>> = HashMap::new();
    for (value, count) in rows {
        let Some(value) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) else {
            continue;
        };
        let key = value.to_lowercase();
        if table.contains_key(&key) {
            continue;
        }
        *groups
            .entry(key)
            .or_default()
            .entry(value.to_string())
            .or_insert(0) += count;
    }
    let mut next = HashMap::new();
    for (key, spellings) in groups {
        if spellings.len() < 2 {
            continue;
        }
        let mut entries: Vec<_> = spellings.into_iter().collect();
        entries.sort_by(|a, b| {
            upper_count(&b.0)
                .cmp(&upper_count(&a.0))
                .then(b.1.cmp(&a.1))
                .then(a.0.cmp(&b.0))
        });
        next.insert(key, entries.remove(0).0);
    }
    LEARNED.write().unwrap().insert(kind, next);
}

fn normalize(kind: NameKind, value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let key = trimmed.to_lowercase();
    if let Some(found) = static_table(kind).get(&key) {
        return Some((*found).to_string());
    }
    if let Some(found) = LEARNED.read().unwrap().get(&kind).and_then(|m| m.get(&key)) {
        return Some(found.clone());
    }
    Some(title_case(trimmed))
}

pub fn normalize_editor(value: Option<&str>) -> Option<String> {
    normalize(NameKind::Editor, value)
}

pub fn normalize_os(value: Option<&str>) -> Option<String> {
    normalize(NameKind::Os, value)
}

pub fn normalize_language(value: Option<&str>) -> Option<String> {
    normalize(NameKind::Language, value)
}

pub fn fingerprint() -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for (name, table) in [
        ("editor", &*EDITOR_TABLE),
        ("os", &*OS_TABLE),
        ("language", &*LANGUAGE_TABLE),
    ] {
        let mut entries: Vec<_> = table.iter().collect();
        entries.sort();
        hasher.update(name);
        for (alias, canonical) in entries {
            hasher.update(alias);
            hasher.update([0]);
            hasher.update(canonical);
            hasher.update([0]);
        }
    }
    let learned = LEARNED.read().unwrap();
    let mut kinds: Vec<_> = learned.iter().map(|(k, m)| (*k as u8, m)).collect();
    kinds.sort_by_key(|(k, _)| *k);
    for (kind, map) in kinds {
        let mut entries: Vec<_> = map.iter().collect();
        entries.sort();
        hasher.update([kind]);
        for (alias, canonical) in entries {
            hasher.update(alias);
            hasher.update([0]);
            hasher.update(canonical);
            hasher.update([0]);
        }
    }
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
