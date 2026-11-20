use std::{fs, path::Path};

use oxc_allocator::Allocator;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_transformer::{TransformOptions, Transformer};

fn compile(source_path: &Path, out_dir: &Path) {
    let source = fs::read_to_string(source_path).expect("read ts source");
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(source_path).expect("source type");
    let parsed = Parser::new(&allocator, &source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        panic!("{}: {:?}", source_path.display(), parsed.diagnostics);
    }
    let mut program = parsed.program;
    let scoping = SemanticBuilder::new()
        .build(&program)
        .semantic
        .into_scoping();
    let result = Transformer::new(&allocator, source_path, &TransformOptions::default())
        .build_with_scoping(scoping, &mut program);
    if !result.diagnostics.is_empty() {
        panic!("{}: {:?}", source_path.display(), result.diagnostics);
    }
    let code = Codegen::new().build(&program).code;
    let name = source_path.file_stem().unwrap().to_string_lossy();
    fs::write(out_dir.join(format!("{name}.js")), code).expect("write js");
}

fn main() {
    let src = Path::new("src/composables");
    println!("cargo:rerun-if-changed={}", src.display());
    let out = Path::new("public/js");
    fs::create_dir_all(out).expect("create public/js");
    for entry in fs::read_dir(src).expect("read composables") {
        let path = entry.expect("dir entry").path();
        if path.extension().is_some_and(|e| e == "ts") {
            println!("cargo:rerun-if-changed={}", path.display());
            compile(&path, out);
        }
    }
}
