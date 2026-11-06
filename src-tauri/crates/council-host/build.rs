use std::{env, fs, path::Path};

fn main() {
    let root = Path::new("../../../web-dist");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut entries = Vec::new();
    fn collect(root: &Path, dir: &Path, entries: &mut Vec<String>) {
        let Ok(files) = fs::read_dir(dir) else {
            return;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.is_dir() {
                collect(root, &path, entries);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                if relative.starts_with("assets/") || relative.starts_with("companion/") {
                    let full = path.canonicalize().unwrap().to_string_lossy().into_owned();
                    entries.push(format!(
                        "({relative:?}, include_bytes!({full:?}) as &'static [u8])"
                    ));
                }
            }
        }
    }
    collect(root, root, &mut entries);
    let notices = Path::new("../../../docs/QRCODE_LICENSE.txt");
    println!("cargo:rerun-if-changed={}", notices.display());
    if let Ok(full) = notices.canonicalize() {
        entries.push(format!(
            "(\"companion/third-party-notices.txt\", include_bytes!({:?}) as &'static [u8])",
            full.to_string_lossy()
        ));
    }
    entries.sort();
    let output = format!(
        "pub static ASSETS: &[(&str, &[u8])] = &[{}];",
        entries.join(",\n")
    );
    fs::write(
        Path::new(&env::var("OUT_DIR").unwrap()).join("companion_assets.rs"),
        output,
    )
    .unwrap();
}
