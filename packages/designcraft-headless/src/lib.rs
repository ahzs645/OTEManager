//! A headless DesignCraft session for OTEManager.
//!
//! This is the same engine the `designcraft-cli script` command drives, exposed
//! to JavaScript without a window, file system or control port. Documents,
//! images and exports travel as bytes (`file.openBytes`, `file.place {base64}`,
//! `file.exportPdf` / `file.exportIdml` / `file.serialize` without a path).

use designcraft_engine::{Session, script};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    session: Session,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Engine {
    /// A session with no document; the first `file.new` / `file.openBytes` creates one.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine { session: Session::new() }
    }

    /// The upstream DesignCraft release this module was built from.
    pub fn version() -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    /// Register a font (TTF/OTF/TTC) for every document in this module; returns faces added.
    #[wasm_bindgen(js_name = addFont)]
    pub fn add_font(bytes: Vec<u8>) -> usize {
        designcraft_fonts::FontDb::global().add_font(bytes)
    }

    /// Run one engine command; `params` and the result are JSON text.
    pub fn execute(&mut self, command: &str, params: &str) -> Result<String, JsError> {
        let params: Value = if params.trim().is_empty() { json!({}) } else { serde_json::from_str(params)? };
        let result = self.exec(command, &params).map_err(|e| JsError::new(&e))?;
        Ok(result.to_string())
    }

    /// Run a command script exactly as `designcraft-cli script` does and return its report:
    /// `{completed, results, failedIndex?, failedCommand?, error?}`.
    #[wasm_bindgen(js_name = runScript)]
    pub fn run_script(&mut self, text: &str, keep_going: bool) -> Result<String, JsError> {
        let steps = script::parse(text).map_err(|e| JsError::new(&e))?;
        let report = if keep_going {
            let mut results: Vec<Value> = Vec::new();
            for step in &steps {
                let r = script::resolve(&step.params, &results).and_then(|p| self.exec(&step.command, &p));
                results.push(r.unwrap_or_else(|e| json!({"error": e, "command": step.command})));
            }
            script::Report { results, failed: None }
        } else {
            script::run(&steps, |id, p| self.exec(id, &p))
        };
        Ok(report.to_json().to_string())
    }

    /// The active document's page `page` (0-based absolute index) as PNG, `scale` pixels per point.
    #[wasm_bindgen(js_name = renderPagePng)]
    pub fn render_page_png(&mut self, page: usize, scale: f64) -> Result<Vec<u8>, JsError> {
        let st = self.session.doc().map_err(|e| JsError::new(&e.to_string()))?;
        let mut renderer = designcraft_render::Renderer::new();
        let options = designcraft_render::RenderOptions { printing_only: true, ..Default::default() };
        let image = renderer
            .render_page(&st.doc, &self.session.cache, page, scale, true, &options)
            .ok_or_else(|| JsError::new("no such page"))?;
        Ok(image.to_png())
    }

    fn exec(&mut self, command: &str, params: &Value) -> Result<Value, String> {
        let result = self.session.execute(command, params).map_err(|e| e.to_string());
        // Requests for a UI (file pickers, dialogs) have nobody to serve them here.
        self.session.ui_requests.clear();
        result
    }
}
