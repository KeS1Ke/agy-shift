use super::{blocking, Failure, Platform};
use crate::{models, modules};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AccountSummary {
    id: String,
    email: Option<String>,
    name: Option<String>,
    plan: Option<String>,
    tags: Vec<String>,
}

fn summarize(account: &models::Account) -> AccountSummary {
    AccountSummary {
        id: account.id.clone(),
        email: Some(account.email.clone()),
        name: account.name.clone(),
        plan: account
            .quota
            .as_ref()
            .and_then(|quota| quota.subscription_tier.clone()),
        tags: account.tags.clone(),
    }
}

pub(super) async fn list(_platform: Platform) -> Result<Vec<AccountSummary>, Failure> {
    blocking(modules::list_accounts)
        .await
        .map(|accounts| accounts.iter().map(summarize).collect())
}

pub(super) async fn lookup<R: Send + 'static>(
    _platform: Platform,
    id: String,
    project: impl FnOnce(models::Account) -> R + Send + 'static,
) -> Result<R, Failure> {
    blocking(move || {
        let account = modules::account::load_account(&id)?;
        Ok(project(account))
    })
    .await
}
