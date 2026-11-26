mod build_frontend;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=AGY_SHIFT_GOOGLE_OAUTH_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=AGY_SHIFT_GOOGLE_OAUTH_CLIENT_SECRET");
    let target = std::env::var("TARGET").expect("TARGET is required");
    if target.ends_with("-windows-msvc") {
        println!("cargo:rustc-link-arg-bin=agy-shift=/STACK:8388608");
    }
    build_frontend::verify_production_frontend(&target);
    println!("cargo:rustc-env=AGY_SHIFT_RUST_TARGET={target}");
    tauri_build::build()
}
