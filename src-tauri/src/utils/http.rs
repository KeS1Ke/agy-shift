use reqwest::Client;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

static PROXY_EPOCH: AtomicU64 = AtomicU64::new(0);
static CLIENT_CACHE: LazyLock<Mutex<(u64, HashMap<u64, Client>)>> =
    LazyLock::new(|| Mutex::new((0, HashMap::new())));

/// 代理环境变化时调用，使已缓存的 HTTP 客户端在下一次请求时按新代理重建。
pub fn invalidate_client_cache() {
    let next_epoch = PROXY_EPOCH.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
    if let Ok(mut guard) = CLIENT_CACHE.lock() {
        guard.0 = next_epoch;
        guard.1.clear();
    }
}

/// 释放缓存的 HTTP 连接池与 TLS 根证书状态（例如最小化到托盘时）。
pub fn clear_cached_clients() {
    if let Ok(mut guard) = CLIENT_CACHE.lock() {
        guard.1.clear();
    }
}

/// 创建或复用统一配置的 HTTP 客户端，避免每次请求重复加载系统根证书表。
pub fn create_client(timeout_secs: u64) -> Client {
    let epoch = PROXY_EPOCH.load(Ordering::Acquire);
    if let Ok(guard) = CLIENT_CACHE.lock() {
        if guard.0 == epoch {
            if let Some(client) = guard.1.get(&timeout_secs) {
                return client.clone();
            }
        }
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .pool_idle_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(2)
        .build()
        .unwrap_or_else(|_| Client::new());

    if let Ok(mut guard) = CLIENT_CACHE.lock() {
        let current_epoch = PROXY_EPOCH.load(Ordering::Acquire);
        if current_epoch == epoch {
            if guard.0 != current_epoch {
                guard.0 = current_epoch;
                guard.1.clear();
            }
            // 上限保护，避免极端超时组合无界增长
            if guard.1.len() >= 8 {
                guard.1.clear();
            }
            guard.1.insert(timeout_secs, client.clone());
        }
    }

    client
}
