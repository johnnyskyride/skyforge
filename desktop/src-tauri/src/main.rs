#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const PATCH_URL: &str = "https://raw.githubusercontent.com/johnnyskyride/skyforge/main/SkyForge.html";

fn looks_like_skyforge(html: &str) -> bool {
    html.len() > 4000 && html.contains("SkyForge") && html.contains("<!DOCTYPE html>")
}

fn patched_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    Some(dir.join("SkyForge.html"))
}

fn apply_patch(app: &tauri::AppHandle) {
    let Some(dest) = patched_path(app) else { return };
    let Ok(resp) = ureq::get(PATCH_URL)
        .timeout(Duration::from_secs(8))
        .call()
    else {
        return;
    };
    let Ok(html) = resp.into_string() else { return };
    if !looks_like_skyforge(&html) {
        return;
    }
    if let Some(parent) = dest.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(dest, html);
}

fn load_url(app: &tauri::AppHandle) -> WebviewUrl {
    if let Some(path) = patched_path(app) {
        if path.exists() {
            if let Ok(url) = url::Url::from_file_path(&path) {
                return WebviewUrl::External(url);
            }
        }
    }
    WebviewUrl::App("index.html".into())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            apply_patch(app.handle());
            let url = load_url(app.handle());
            WebviewWindowBuilder::new(app, "main", url)
                .title("SkyForge")
                .inner_size(1100.0, 648.0)
                .min_inner_size(720.0, 520.0)
                .resizable(true)
                .center()
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("SkyForge failed to start");
}
