//! Wallpaper search for Ruby's background picker.
//!
//! Pictures come from Wallhaven's public API (safe-for-work only), live wallpapers from
//! MoeWalls. Nothing about you is sent: only the search words. A picked wallpaper is downloaded
//! once (from those sites' own file hosts only) and handed to the page, which keeps it on this
//! PC with its credit.

use base64::Engine;
use serde_json::{json, Value};
use std::time::Duration;

const MAX_BYTES: usize = 40 * 1024 * 1024;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("RubyLauncher").timeout(Duration::from_secs(60)).build().map_err(|e| e.to_string())
}

/// Files may only come from these hosts.
fn allowed(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| {
                ["w.wallhaven.cc", "th.wallhaven.cc"].contains(&h)
                    || (h == "moewalls.com" && u.path().starts_with("/wp-content/uploads/"))
            })
    })
}

async fn get_json(url: reqwest::Url) -> Result<Value, String> {
    let r = client()?.get(url).send().await.map_err(|e| e.to_string())?;
    if r.status() == 429 {
        return Err("The wallpaper site is busy. Try again in a minute.".into());
    }
    r.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())
}

/// Wallhaven pictures (general and anime, safe for work).
pub async fn search_pictures(query: &str, page: u64) -> Result<Value, String> {
    let mut url = reqwest::Url::parse("https://wallhaven.cc/api/v1/search").unwrap();
    url.query_pairs_mut()
        .append_pair("q", query.chars().take(100).collect::<String>().as_str())
        .append_pair("categories", "110")
        .append_pair("purity", "100")
        .append_pair("sorting", if query.trim().is_empty() { "toplist" } else { "relevance" })
        .append_pair("atleast", "1280x720")
        .append_pair("page", &page.clamp(1, 100).to_string());
    let v = get_json(url).await?;
    let items: Vec<Value> = v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|w| {
            json!({
                "id": format!("wh-{}", w["id"].as_str().unwrap_or("")),
                "kind": "picture",
                "thumb": w["thumbs"]["large"],
                "file": w["path"],
                "page": w["url"],
                "size": w["file_size"],
                "resolution": w["resolution"],
                "wallhavenId": w["id"],
            })
        })
        .collect();
    Ok(json!({ "items": items, "lastPage": v["meta"]["last_page"] }))
}

/// Who uploaded a Wallhaven picture and where it's originally from.
pub async fn picture_credit(id: &str) -> Result<Value, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("bad id".into());
    }
    let v = get_json(reqwest::Url::parse(&format!("https://wallhaven.cc/api/v1/w/{id}")).unwrap()).await?;
    let d = &v["data"];
    Ok(json!({ "author": d["uploader"]["username"], "source": d["source"], "page": d["url"], "site": "Wallhaven" }))
}

/// Download a picked wallpaper (allowed hosts only, size-capped) for the page to keep.
pub async fn download(url: &str) -> Result<Value, String> {
    if !allowed(url) {
        return Err("That file isn't from Wallhaven or MoeWalls.".into());
    }
    let mut res = client()?.get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    if !allowed(res.url().as_str()) {
        return Err("The download moved somewhere unexpected.".into());
    }
    let mime = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("").to_string();
    if !["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"].contains(&mime.as_str()) {
        return Err(format!("Unsupported file type ({mime})."));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_BYTES {
            return Err("That file is over 40 MB.".into());
        }
    }
    Ok(json!({ "mime": mime, "data": base64::engine::general_purpose::STANDARD.encode(&bytes) }))
}


/// MoeWalls live wallpapers. MoeWalls has no API, so Ruby reads its normal search pages (the
/// same pages a browser gets) and, when you pick one, the wallpaper's page for its looping preview
/// video (1280x720 WebM). Ruby never touches /download, which MoeWalls asks bots to leave alone.
pub async fn search_videos(query: &str, page: u64) -> Result<Value, String> {
    let q: String = query.chars().take(100).collect();
    let page = page.clamp(1, 200);
    let mut url = if page > 1 {
        reqwest::Url::parse(&format!("https://moewalls.com/page/{page}/")).unwrap()
    } else {
        reqwest::Url::parse("https://moewalls.com/").unwrap()
    };
    if !q.trim().is_empty() {
        url.query_pairs_mut().append_pair("s", q.trim());
    }
    let html = client()?.get(url).send().await.map_err(|e| e.to_string())?;
    if html.status() == 404 {
        return Ok(json!({ "items": [], "lastPage": page.saturating_sub(1) }));
    }
    let html = html.error_for_status().map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let link = regex::Regex::new(r#"<a title="([^"]*)" class="g1-frame" href="(https://moewalls\.com/[a-z0-9-]+/[a-z0-9-]+/)""#).unwrap();
    let img = regex::Regex::new(r#"src="(https://moewalls\.com/wp-content/uploads/[0-9]{4}/[0-9]{2}/[a-z0-9-]+-thumb-364x205\.jpg)""#).unwrap();
    let items: Vec<Value> = html
        .split("<article ")
        .skip(1)
        .filter_map(|a| {
            let l = link.captures(a)?;
            let t = img.captures(a)?;
            let title = l[1].replace("&#8217;", "'").replace("&amp;", "&").replace(" Live Wallpaper", "");
            Some(json!({
                "id": format!("mw-{}", l[2].trim_end_matches('/').rsplit('/').next().unwrap_or("")),
                "kind": "video",
                "title": title,
                "thumb": &t[1],
                "page": &l[2],
                "credit": { "author": null, "source": null, "page": &l[2], "site": "MoeWalls", "title": title },
            }))
        })
        .collect();
    let more = html.contains(&format!("/page/{}/", page + 1));
    Ok(json!({ "items": items, "lastPage": if more { page + 1 } else { page } }))
}

/// The looping preview video on a MoeWalls wallpaper page.
pub async fn moewalls_video(page_url: &str) -> Result<String, String> {
    let u = reqwest::Url::parse(page_url).map_err(|e| e.to_string())?;
    if u.scheme() != "https" || u.host_str() != Some("moewalls.com") || u.path().starts_with("/download") {
        return Err("Not a MoeWalls wallpaper page.".into());
    }
    let html = client()?.get(u).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    let re = regex::Regex::new(r#"<source src="(/wp-content/uploads/preview/[0-9]{4}/[a-z0-9-]+-preview\.(?:webm|mp4))""#).unwrap();
    let path = re.captures(&html).map(|c| c[1].to_string()).ok_or("That wallpaper has no video preview.")?;
    Ok(format!("https://moewalls.com{path}"))
}

static THUMBS: once_cell::sync::Lazy<parking_lot::Mutex<std::collections::HashMap<String, String>>> = once_cell::sync::Lazy::new(Default::default);

/// A search preview as a data URL (fetched here so the page doesn't depend on the sites
/// accepting the app's own requests). Kept in memory for the session.
pub async fn thumb(url: &str) -> Result<Value, String> {
    if let Some(v) = THUMBS.lock().get(url).cloned() {
        return Ok(json!(v));
    }
    if !allowed(url) {
        return Err("not an allowed image host".into());
    }
    let r = client()?.get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let mime = r.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").split(';').next().unwrap_or("image/jpeg").to_string();
    if !mime.starts_with("image/") {
        return Err("not an image".into());
    }
    let bytes = r.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("preview too large".into());
    }
    let v = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
    let mut t = THUMBS.lock();
    if t.len() > 400 {
        t.clear();
    }
    t.insert(url.to_string(), v.clone());
    Ok(json!(v))
}

#[cfg(test)]
mod tests {
    #[test]
    fn hosts() {
        assert!(super::allowed("https://w.wallhaven.cc/full/43/x.jpg"));
        assert!(super::allowed("https://moewalls.com/wp-content/uploads/preview/2026/x-preview.webm"));
        assert!(!super::allowed("https://moewalls.com/download/x"));
        assert!(!super::allowed("http://w.wallhaven.cc/x.jpg"));
        assert!(!super::allowed("https://evil.com/w.wallhaven.cc"));
        assert!(!super::allowed("https://w.wallhaven.cc.evil.com/x"));
    }
}
