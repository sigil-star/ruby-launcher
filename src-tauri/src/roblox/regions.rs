//! Where a public server is, before you join it.
//!
//! Roblox's join service tells a client which address to connect to. Ruby asks it as the Roblox
//! client does (falling back to the website's request shapes), reads the server's IP from the
//! answer, and names the city: Roblox's own 128.116.x.x blocks map straight to a data centre,
//! anything else is looked up on ipinfo.io (only that server's IP is sent). Asking doesn't join
//! the server; the client never connects, so no slot is used.

use crate::state::AppState;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Roblox data centres by the third octet of 128.116.x.x (community-maintained mapping).
const DATA_CENTRES: &[(u8, &str, &str)] = &[
    (115, "Seattle", "US"), (116, "Los Angeles", "US"), (1, "Los Angeles", "US"), (63, "Los Angeles", "US"),
    (117, "San Jose", "US"), (95, "Dallas", "US"), (101, "Chicago", "US"), (48, "Chicago", "US"),
    (22, "Atlanta", "US"), (99, "Atlanta", "US"), (45, "Miami", "US"), (127, "Miami", "US"),
    (102, "Ashburn", "US"), (53, "Ashburn", "US"), (32, "New York", "US"),
    (33, "London", "GB"), (119, "London", "GB"), (21, "Amsterdam", "NL"), (4, "Paris", "FR"), (122, "Paris", "FR"),
    (5, "Frankfurt", "DE"), (44, "Frankfurt", "DE"), (123, "Frankfurt", "DE"), (31, "Warsaw", "PL"), (124, "Warsaw", "PL"),
    (104, "Mumbai", "IN"), (55, "Tokyo", "JP"), (120, "Tokyo", "JP"), (50, "Singapore", "SG"), (97, "Singapore", "SG"),
    (51, "Sydney", "AU"), (30, "Hong Kong", "HK"), (118, "Hong Kong", "HK"),
];

/// Which request shape Roblox last answered with an address (0 web, 1 JoinGame id, 2 client).
static PREFERRED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(2);
static TOKENS: once_cell::sync::Lazy<Mutex<HashMap<u64, (Instant, String)>>> = once_cell::sync::Lazy::new(Default::default);
static FOUND: once_cell::sync::Lazy<Mutex<HashMap<String, Value>>> = once_cell::sync::Lazy::new(Default::default);
static GEO: once_cell::sync::Lazy<Mutex<HashMap<String, Value>>> = once_cell::sync::Lazy::new(Default::default);

/// roblox.com's game page hands out a bound auth token in a response header; the join service
/// wants it back. Kept for a few minutes per place.
async fn bound_token(state: &Arc<AppState>, place_id: u64) -> Option<String> {
    if let Some((t, tok)) = TOKENS.lock().get(&place_id) {
        if t.elapsed() < Duration::from_secs(240) {
            return Some(tok.clone());
        }
    }
    let page = format!("https://www.roblox.com/games/{place_id}/");
    let res = crate::roblox::fetch_roblox_api(state, &page, Some(json!({ "method": "GET", "headers": { "Accept": "text/html,application/xhtml+xml" } }))).await.ok()?;
    let tok = res["headers"]["x-bound-auth-token"].as_str()?.to_string();
    TOKENS.lock().insert(place_id, (Instant::now(), tok.clone()));
    Some(tok)
}

fn public_ipv4(s: &str) -> Option<std::net::Ipv4Addr> {
    s.parse::<std::net::Ipv4Addr>().ok().filter(|ip| !ip.is_private() && !ip.is_loopback() && !ip.is_unspecified())
}

/// The server's public IP from a join answer (Roblox puts it in UdmuxEndpoints or MachineAddress).
fn server_ip(join: &Value) -> Option<std::net::Ipv4Addr> {
    let js = &join["joinScript"];
    js["UdmuxEndpoints"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|e| e["Address"].as_str())
        .chain(js["MachineAddress"].as_str())
        .find_map(public_ipv4)
}

async fn geo(state: &Arc<AppState>, ip: std::net::Ipv4Addr) -> Value {
    let o = ip.octets();
    if o[0] == 128 && o[1] == 116 {
        if let Some((_, city, country)) = DATA_CENTRES.iter().find(|(n, _, _)| *n == o[2]) {
            return json!({ "city": city, "country": country });
        }
    }
    let key = ip.to_string();
    if let Some(v) = GEO.lock().get(&key).cloned() {
        return v;
    }
    let looked = async {
        let r = state.http.get(format!("https://ipinfo.io/{key}/json")).header("User-Agent", "RubyLauncher").timeout(Duration::from_secs(5)).send().await.ok()?;
        let v: Value = r.json().await.ok()?;
        Some(json!({ "city": v["city"], "country": v["country"] }))
    }
    .await
    .unwrap_or(Value::Null);
    if !looked.is_null() {
        GEO.lock().insert(key, looked.clone());
    }
    looked
}

pub async fn server_region(state: &Arc<AppState>, place_id: u64, job_id: &str) -> Value {
    let valid = job_id.len() == 36 && job_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if !valid || place_id == 0 {
        return json!({ "ok": false, "why": "bad server id" });
    }
    if let Some(v) = FOUND.lock().get(job_id).cloned() {
        return json!({ "ok": true, "location": v });
    }
    let token = bound_token(state, place_id).await;
    let mut tried = Vec::new();
    // The shapes roblox.com and the Roblox client use; the one that last worked goes first.
    let mut shapes = vec![("web", job_id.to_string(), false), ("joingame", format!("JoinGame={place_id};{job_id}"), false), ("client", job_id.to_string(), true)];
    let pref = PREFERRED.load(std::sync::atomic::Ordering::Relaxed).min(shapes.len() - 1);
    shapes.swap(0, pref);
    for (i, (shape, game_id, client)) in shapes.into_iter().enumerate() {
        let r = join_attempt(state, place_id, &game_id, token.as_deref(), client).await;
        match r {
            Ok(ip) => {
                let loc = geo(state, ip).await;
                if loc.is_null() {
                    return json!({ "ok": false, "why": "couldn't place that address" });
                }
                FOUND.lock().insert(job_id.to_string(), loc.clone());
                let idx = match shape { "web" => 0, "joingame" => 1, _ => 2 };
                if i > 0 {
                    PREFERRED.store(idx, std::sync::atomic::Ordering::Relaxed);
                }
                return json!({ "ok": true, "location": loc, "via": shape });
            }
            Err(e) if e == "busy" => return json!({ "ok": false, "busy": true, "why": "Roblox is rate limiting lookups" }),
            Err(e) => tried.push(format!("{shape}: {e}")),
        }
    }
    json!({ "ok": false, "why": format!("{}{}", tried.join(" · "), if token.is_none() { " (no bound token)" } else { "" }) })
}

async fn join_attempt(state: &Arc<AppState>, place_id: u64, game_id: &str, token: Option<&str>, client: bool) -> Result<std::net::Ipv4Addr, String> {
    let mut headers = if client {
        json!({ "User-Agent": "Roblox/WinInet", "Origin": "", "Referer": "" })
    } else {
        json!({ "Referer": format!("https://www.roblox.com/games/{place_id}/") })
    };
    if let Some(t) = token {
        headers["x-bound-auth-token"] = json!(t);
    }
    let body = json!({
        "placeId": place_id,
        "gameId": game_id,
        "isTeleport": false,
        "isPlayTogetherGame": false,
        "isImmersiveAdsTeleport": false,
        "isQueueAllowedOverride": false,
        "browserTrackerId": (uuid::Uuid::new_v4().as_u128() % 1_000_000_000_000) as u64,
        "gameJoinAttemptId": uuid::Uuid::new_v4().to_string(),
        "joinOrigin": "ServerList",
        "channelName": "",
        "cId": "",
        "gamerTag": "",
        "partyId": "",
    });
    let res = crate::roblox::fetch_roblox_api(state, "https://gamejoin.roblox.com/v1/join-game-instance", Some(json!({ "method": "POST", "body": body, "headers": headers }))).await?;
    if res["status"] == 429 {
        return Err("busy".into());
    }
    server_ip(&res["data"]).ok_or_else(|| {
        let d = &res["data"];
        format!("http {} status {} {}", res["status"], d["status"], d["message"].as_str().unwrap_or(""))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_server_ip() {
        let j = json!({ "joinScript": { "MachineAddress": "10.1.2.3", "UdmuxEndpoints": [{ "Address": "128.116.102.7", "Port": 55000 }] } });
        assert_eq!(server_ip(&j), Some("128.116.102.7".parse().unwrap()));
        assert_eq!(server_ip(&json!({ "joinScript": { "MachineAddress": "10.0.0.1" } })), None);
    }
}
