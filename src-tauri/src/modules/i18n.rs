//! 精简版内置文案映射（Agy Shift 主界面固定为简体中文，无外部 locale JSON 依赖）。

pub fn translate(locale: &str, key: &str, replacements: &[(&str, &str)]) -> String {
    let norm = locale.trim().replace('_', "-").to_ascii_lowercase();
    let is_en = norm == "en" || norm.starts_with("en-");

    let template = match (is_en, key) {
        (true, "quotaAlert.modal.title") => "Quota Alert",
        (false, "quotaAlert.modal.title") => "配额预警",
        (true, "quotaAlert.modal.unknownModel") => "Unknown model",
        (false, "quotaAlert.modal.unknownModel") => "未知模型",
        (true, "quotaAlert.modal.recommended") => "Recommended",
        (false, "quotaAlert.modal.recommended") => "推荐切换",
        (true, "quotaAlert.bannerText") => {
            "Quota alert for {{email}} (threshold {{threshold}}%, lowest {{lowest}}%, models: {{models}})"
        }
        (false, "quotaAlert.bannerText") => {
            "账号 {{email}} 当前配额已低于阈值 {{threshold}}%（最低 {{lowest}}%，受影响模型：{{models}}）"
        }
        (true, "common.dataQueryBusy") => "Background maintenance is busy, please try again later",
        (false, "common.dataQueryBusy") => "后台数据正在维护，请稍后再试",
        _ => key,
    };

    let mut output = template.to_string();
    for (name, value) in replacements {
        output = output.replace(&format!("{{{{{}}}}}", name), value);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::translate;

    #[test]
    fn uses_selected_locale() {
        assert_eq!(translate("zh-cn", "quotaAlert.modal.title", &[]), "配额预警");
        assert_eq!(translate("en-us", "quotaAlert.modal.title", &[]), "Quota Alert");
    }

    #[test]
    fn falls_back_to_base_locale() {
        assert_eq!(translate("en-gb", "quotaAlert.modal.title", &[]), "Quota Alert");
    }

    #[test]
    fn interpolates_placeholders() {
        let text = translate(
            "en-us",
            "quotaAlert.bannerText",
            &[
                ("email", "demo@example.com"),
                ("threshold", "20"),
                ("lowest", "12"),
                ("models", "claude-sonnet-4"),
            ],
        );

        assert_eq!(
            text,
            "Quota alert for demo@example.com (threshold 20%, lowest 12%, models: claude-sonnet-4)"
        );
    }
}
