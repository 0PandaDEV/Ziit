use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use serde::de::DeserializeOwned;

use super::logging::fail;

fn blocked_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 100 && (64..=127).contains(&b))
        || a >= 224
}

fn blocked_v6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    if let Some(v4) = ip.to_ipv4_mapped() {
        return blocked_v4(v4);
    }
    let first = ip.segments()[0];
    (first & 0xffc0) == 0xfe80 || (first & 0xfe00) == 0xfc00 || (first & 0xff00) == 0xff00
}

fn blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => blocked_v4(v4),
        IpAddr::V6(v6) => blocked_v6(v6),
    }
}

pub async fn assert_allowed_outbound_url(raw: &str) -> topcoat::Result<()> {
    let parsed = reqwest::Url::parse(raw).map_err(|_| {
        fail(
            400,
            format!("Invalid instance URL: {raw}"),
            Some("Invalid instance URL."),
        )
    })?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(fail(
            400,
            format!("Blocked instance URL protocol: {}:", parsed.scheme()),
            Some("Instance URL must use http or https."),
        ));
    }
    let host = parsed.host_str().unwrap_or_default().to_string();
    let denied = |detail: String| fail(400, detail, Some("This instance URL is not allowed."));
    if host.eq_ignore_ascii_case("localhost") {
        return Err(denied(format!("Blocked instance hostname: {host}")));
    }
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = bare.parse::<IpAddr>() {
        if blocked_ip(ip) {
            return Err(denied(format!("Blocked instance URL target: {host}")));
        }
        return Ok(());
    }
    let port = parsed.port_or_known_default().unwrap_or(80);
    let addresses: Vec<_> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| {
            fail(
                400,
                format!("Could not resolve instance hostname: {host}"),
                Some("Could not resolve instance URL."),
            )
        })?
        .collect();
    if addresses.is_empty() {
        return Err(fail(
            400,
            format!("Could not resolve instance hostname: {host}"),
            Some("Could not resolve instance URL."),
        ));
    }
    for addr in addresses {
        if blocked_ip(addr.ip()) {
            return Err(denied(format!(
                "Blocked instance URL target: {host} -> {}",
                addr.ip()
            )));
        }
    }
    Ok(())
}

pub async fn fetch_external_instance<T: DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    query: &[(&str, &str)],
    authorization: Option<&str>,
) -> topcoat::Result<T> {
    assert_allowed_outbound_url(url).await?;
    let mut request = client.get(url).query(query);
    if let Some(auth) = authorization {
        request = request.header("Authorization", auth);
    }
    let response = request
        .send()
        .await
        .map_err(|e| topcoat::Error::msg(e.to_string()))?
        .error_for_status()
        .map_err(|e| topcoat::Error::msg(e.to_string()))?;
    response
        .json()
        .await
        .map_err(|e| topcoat::Error::msg(e.to_string()))
}
