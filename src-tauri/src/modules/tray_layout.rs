//! Agy Shift 仅支持 Antigravity，保留兼容查询函数供后台调度器调用。
pub const PLATFORM_ANTIGRAVITY: &str = "antigravity";

pub fn is_platform_enabled(platform: &str) -> bool {
    matches!(platform, "antigravity" | "antigravity_ide")
}
