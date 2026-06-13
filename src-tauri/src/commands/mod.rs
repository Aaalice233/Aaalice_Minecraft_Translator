// Command handlers for Tauri — split by domain.
// Each submodule mirrors a section of the old commands.rs.
// Re-exports ensure lib.rs continues to see `commands::function_name`.

pub mod dictionary;
pub mod fonts;
pub mod game;
pub mod i18n_dict;
pub mod jobs;
pub mod llm;
pub mod logs;
pub mod pack;
pub mod scan;
pub mod settings;
pub mod translate;
pub mod validate;
pub mod warmup;

pub use dictionary::*;
pub use fonts::*;
pub use game::*;
pub use i18n_dict::*;
pub use jobs::*;
pub use llm::*;
pub use logs::*;
pub use pack::*;
pub use scan::*;
pub use settings::*;
pub use translate::*;
pub use validate::*;
pub use warmup::*;
