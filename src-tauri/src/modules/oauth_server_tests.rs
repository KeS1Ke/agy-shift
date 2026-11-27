use super::*;

#[test]
fn callback_redirect_matches_bound_address_families() {
    assert_eq!(
        callback_redirect_uri(12345, true, true),
        "http://localhost:12345/oauth-callback"
    );
    assert_eq!(
        callback_redirect_uri(12345, true, false),
        "http://127.0.0.1:12345/oauth-callback"
    );
    assert_eq!(
        callback_redirect_uri(12345, false, true),
        "http://[::1]:12345/oauth-callback"
    );
}

#[tokio::test]
async fn callback_accepts_validated_codes_on_every_bound_loopback_family() {
    tokio::time::timeout(Duration::from_secs(3), async {
        let listeners = bind_callback_listeners().await.unwrap();
        assert!(listeners.ipv4.is_some() || listeners.ipv6.is_some());
        exercise_callback_listeners(listeners).await;
    })
    .await
    .expect("dual-stack callback timed out");
}

#[tokio::test]
async fn callback_accepts_codes_with_only_one_listener() {
    tokio::time::timeout(Duration::from_secs(3), async {
        let ipv4 = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = ipv4.local_addr().unwrap().port();
        exercise_callback_listeners(OAuthCallbackListeners {
            ipv4: Some(ipv4),
            ipv6: None,
            port,
        })
        .await;
        // IPv6 may be unavailable on the host. IPv4-only coverage is mandatory.
        if let Ok(ipv6) = TcpListener::bind("[::1]:0").await {
            let port = ipv6.local_addr().unwrap().port();
            exercise_callback_listeners(OAuthCallbackListeners {
                ipv4: None,
                ipv6: Some(ipv6),
                port,
            })
            .await;
        }
    })
    .await
    .expect("single-stack callback timed out");
}

async fn exercise_callback_listeners(listeners: OAuthCallbackListeners) {
    let mut addresses = Vec::new();
    for listener in [&listeners.ipv4, &listeners.ipv6].into_iter().flatten() {
        let address = listener.local_addr().unwrap();
        assert!(address.ip().is_loopback());
        assert_eq!(address.port(), listeners.port);
        addresses.push(address);
    }
    for address in addresses {
        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        let (mut stream, _) = tokio::select! {
            result = accept_callback(&listeners.ipv4) => result.unwrap(),
            result = accept_callback(&listeners.ipv6) => result.unwrap(),
        };
        client.write_all(b"GET /oauth-callback?code=test-code&state=test-state HTTP/1.1\r\nHost: localhost\r\n\r\n").await.unwrap();
        assert_eq!(
            process_callback_request(&mut stream, listeners.port, "test-state").await,
            Some(Ok("test-code".to_string()))
        );
        let mut response = [0; 1024];
        let count = client.read(&mut response).await.unwrap();
        assert!(String::from_utf8_lossy(&response[..count]).starts_with("HTTP/1.1 200 OK"));
    }
}

#[test]
fn callback_rejects_missing_or_mismatched_state() {
    for query in ["code=test-code", "code=test-code&state=wrong"] {
        let url = Url::parse(&format!("http://127.0.0.1:12345/oauth-callback?{query}")).unwrap();
        assert!(callback_result(&url, "test-state").is_none());
    }
}

#[test]
fn denied_callback_completes_only_with_the_matching_state() {
    let url =
        Url::parse("http://127.0.0.1:12345/oauth-callback?error=access_denied&state=test-state")
            .unwrap();
    assert!(matches!(callback_result(&url, "test-state"), Some(Err(_))));
    assert!(callback_result(&url, "different-state").is_none());
}

#[tokio::test]
async fn cancelling_an_old_flow_leaves_the_new_flow_waiting() {
    let mut ids = Vec::new();
    for _ in 0..2 {
        let id = uuid::Uuid::new_v4();
        let (cancel_tx, _) = watch::channel(false);
        let (code_tx, code_rx) = oneshot::channel();
        oauth_flows().lock().unwrap().insert(
            id,
            OAuthFlowState {
                redirect_uri: String::new(),
                expected_state: String::new(),
                code_verifier: String::new(),
                client: Arc::new(oauth::OAuthClientConfig::new(
                    "fixture".into(),
                    "test-value".into(),
                )),
                cancel_tx,
                code_tx: Arc::new(tokio::sync::Mutex::new(Some(code_tx))),
                code_rx: Some(code_rx),
            },
        );
        ids.push(id);
    }
    let (old, new) = (ids[0], ids[1]);
    let completing_old = complete_oauth_flow(old);
    tokio::pin!(completing_old);
    assert!(futures::poll!(&mut completing_old).is_pending());
    cancel_oauth_flow(old);
    assert!(completing_old.await.is_err());

    let completing_new = complete_oauth_flow(new);
    tokio::pin!(completing_new);
    assert!(futures::poll!(&mut completing_new).is_pending());
    cancel_oauth_flow(new);
    assert!(completing_new.await.is_err());
}

#[tokio::test]
async fn unrelated_requests_do_not_consume_the_oauth_callback() {
    tokio::time::timeout(Duration::from_secs(3), async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        for request in [
            "GET /favicon.ico HTTP/1.1\r\nHost: localhost\r\n\r\n",
            "OPTIONS /oauth-callback HTTP/1.1\r\nHost: localhost\r\n\r\n",
            "GET /oauth-callback?code=test-code&state=wrong HTTP/1.1\r\nHost: localhost\r\n\r\n",
        ] {
            let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
            let (mut stream, _) = listener.accept().await.unwrap();
            client.write_all(request.as_bytes()).await.unwrap();
            assert!(
                process_callback_request(&mut stream, address.port(), "test-state")
                    .await
                    .is_none()
            );
        }
    })
    .await
    .expect("unrelated callback request timed out");
}
