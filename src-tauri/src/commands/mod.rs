// Command handlers for Tauri — split by domain.
// Each submodule mirrors a section of the old commands.rs.
// Re-exports ensure lib.rs continues to see `commands::function_name`.

pub mod dictionary;
pub mod game;
pub mod logs;
pub mod jobs;
pub mod llm;
pub mod pack;
pub mod scan;
pub mod settings;
pub mod translate;
pub mod validate;

pub use dictionary::*;
pub use game::*;
pub use logs::*;
pub use jobs::*;
pub use llm::*;
pub use pack::*;
pub use scan::*;
pub use settings::*;
pub use translate::*;
pub use validate::*;
