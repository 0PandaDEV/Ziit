use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::Duration,
};

use serde::de::DeserializeOwned;

use super::logging::fail;

fn blocked_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 100 && (64..=127).contains(&b))
        || (a == 198 && (18..=19).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || a >= 224
}

fn blocked_v6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    if let Some(v4) = ip.to_ipv4_mapped() {
        return blocked_v4(v4);
    }
    let segments = ip.segments();
    if segments[0] == 0x64 && segments[1] == 0xff9b && segments[2..6].iter().all(|s| *s == 0) {
        let [hi, lo] = [segments[6].to_be_bytes(), segments[7].to_be_bytes()];
        return blocked_v4(Ipv4Addr::new(hi[0], hi[1], lo[0], lo[1]));
    }
    let first = segments[0];
    (first & 0xffc0) == 0xfe80 || (first & 0xfe00) == 0xfc00 || (first & 0xff00) == 0xff00
}

fn blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => blocked_v4(v4),
        IpAddr::V6(v6) => blocked_v6(v6),
    }
}

pub async fn pinned_client(raw: &str, timeout: Duration) -> topcoat::Result<reqwest::Client> {
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
        return build_client(None, timeout);
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
    for addr in &addresses {
        if blocked_ip(addr.ip()) {
            return Err(denied(format!(
                "Blocked instance URL target: {host} -> {}",
                addr.ip()
            )));
        }
    }
    build_client(Some((&host, &addresses)), timeout)
}

fn build_client(
    pin: Option<(&str, &[SocketAddr])>,
    timeout: Duration,
) -> topcoat::Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(timeout);
    if let Some((host, addresses)) = pin {
        builder = builder.resolve_to_addrs(host, addresses);
    }
    builder
        .build()
        .map_err(|e| topcoat::Error::msg(e.to_string()))
}

pub async fn fetch_external_instance<T: DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    query: &[(&str, &str)],
    authorization: Option<&str>,
) -> topcoat::Result<T> {
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
    let bytes = read_limited(response, MAX_INSTANCE_RESPONSE).await?;
    serde_json::from_slice(&bytes).map_err(|e| topcoat::Error::msg(e.to_string()))
}

const MAX_INSTANCE_RESPONSE: usize = 32 * 1024 * 1024;

pub async fn read_limited(mut response: reqwest::Response, max: usize) -> topcoat::Result<Vec<u8>> {
    if response.content_length().is_some_and(|l| l > max as u64) {
        return Err(topcoat::Error::msg("Remote response is too large"));
    }
    let mut out = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| topcoat::Error::msg(e.to_string()))?
    {
        if out.len() + chunk.len() > max {
            return Err(topcoat::Error::msg("Remote response is too large"));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

pub async fn download_limited(
    raw: &str,
    max: usize,
    timeout: Duration,
) -> topcoat::Result<Vec<u8>> {
    let mut url = raw.to_string();
    for _ in 0..4 {
        let parsed =
            reqwest::Url::parse(&url).map_err(|_| topcoat::Error::msg("Invalid download URL"))?;
        if parsed.scheme() != "https" {
            return Err(topcoat::Error::msg("Download URL must use https"));
        }
        let client = pinned_client(&url, timeout).await?;
        let response = client
            .get(parsed.clone())
            .send()
            .await
            .map_err(|e| topcoat::Error::msg(e.to_string()))?;
        if response.status().is_redirection() {
            let next = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| topcoat::Error::msg("Redirect without location"))?;
            url = parsed
                .join(next)
                .map_err(|_| topcoat::Error::msg("Invalid redirect URL"))?
                .to_string();
            continue;
        }
        let response = response
            .error_for_status()
            .map_err(|e| topcoat::Error::msg(e.to_string()))?;
        return read_limited(response, max).await;
    }
    Err(topcoat::Error::msg("Too many redirects"))
}
