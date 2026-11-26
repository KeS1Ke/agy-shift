use super::{Failure, Platform};
use crate::{commands, models};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct QuotaSnapshot {
    status: &'static str,
    updated_at: Option<i64>,
    data: Value,
}

impl QuotaSnapshot {
    fn new(updated_at: Option<i64>, failed: bool, mut data: Value) -> Self {
        discard_empty_fields(&mut data);
        let status = match (data.is_null(), failed) {
            (true, false) => "unavailable",
            (true, true) => "failed",
            (false, false) => "available",
            (false, true) => "stale",
        };
        Self {
            status,
            updated_at,
            data,
        }
    }

    pub(super) fn refresh_failed(&self) -> bool {
        matches!(self.status, "failed" | "stale")
    }
}

fn discard_empty_fields(value: &mut Value) {
    let empty = match value {
        Value::Object(fields) => {
            fields.retain(|_, field| {
                discard_empty_fields(field);
                !field.is_null()
            });
            fields.is_empty()
        }
        Value::Array(fields) => {
            for field in fields.iter_mut() {
                discard_empty_fields(field);
            }
            fields.retain(|field| !field.is_null());
            fields.is_empty()
        }
        _ => false,
    };
    if empty {
        *value = Value::Null;
    }
}

pub(super) fn snapshot(account: models::Account) -> QuotaSnapshot {
    let quota = account.quota.as_ref();
    let data = quota
        .map(|q| {
            json!({
                "models": q.models,
                "credits": q.credits,
                "summaryStale": q.quota_summary_stale.then_some(true),
                "forbidden": q.is_forbidden.then_some(true),
            })
        })
        .unwrap_or(Value::Null);
    QuotaSnapshot::new(
        account
            .usage_updated_at
            .or_else(|| quota.map(|q| q.last_updated)),
        account.quota_error.is_some()
            || quota.is_some_and(|q| q.quota_summary_stale || q.is_forbidden),
        data,
    )
}

pub(super) async fn refresh(_platform: Platform, id: String) -> Result<(), Failure> {
    commands::account::fetch_account_quota(id)
        .await
        .map(|_| ())
        .map_err(|error| Failure::host(error.to_string()))
}
