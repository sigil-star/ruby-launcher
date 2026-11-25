//! Roblox chat over HTTP: the platform chat API the website uses, with the older v2 API as a fallback.

use crate::roblox::http;
use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

fn extract_text(row: &Value) -> String {
    for key in [
        "content",
        "text",
        "body",
        "message",
        "displayContent",
        "display_content",
        "snippet",
        "preview",
    ] {
        if let Some(s) = row.get(key).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    String::new()
}

fn normalize_conversation_row(row: &Value) -> Option<Value> {
    let id = row
        .get("id")
        .or_else(|| row.get("conversationId"))
        .or_else(|| row.get("conversation_id"))
        .map(|v| match v {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        })
        .filter(|s| !s.is_empty())?;

    let participants: Vec<Value> = row
        .get("participants")
        .or_else(|| row.get("participant_user_ids"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    if let Some(n) = p.as_i64() {
                        return Some(json!(n));
                    }
                    if let Some(obj) = p.as_object() {
                        return obj
                            .get("targetId")
                            .or_else(|| obj.get("userId"))
                            .or_else(|| obj.get("id"))
                            .and_then(|x| x.as_i64())
                            .map(|n| json!(n));
                    }
                    None
                })
                .collect()
        })
        .unwrap_or_default();

    let is_group = row
        .get("type")
        .and_then(|v| v.as_str())
        .map(|t| t.eq_ignore_ascii_case("group") || t.eq_ignore_ascii_case("multiuserconversation"))
        .unwrap_or(participants.len() > 2);

    // platform-chat-api ships the newest message inline (`messages[0]`) plus a `preview_message`,
    // so the list renders without any extra per-conversation requests.
    let last_raw = row
        .get("lastMessage")
        .or_else(|| row.get("last_message"))
        .or_else(|| row.get("chatMessage"))
        .or_else(|| row.get("messages").and_then(|m| m.as_array()).and_then(|a| a.first()))
        .or_else(|| row.get("preview_message").filter(|v| v.is_object()))
        .cloned()
        .unwrap_or(Value::Null);
    let mut last_message_text = if let Value::String(s) = &last_raw {
        s.trim().to_string()
    } else {
        extract_text(&last_raw)
    };
    if last_message_text.is_empty() {
        if let Some(s) = row.get("preview_message").and_then(|v| v.as_str()) {
            last_message_text = s.trim().to_string();
        }
    }

    let unread = row
        .get("unreadCount")
        .or_else(|| row.get("unread_count"))
        .or_else(|| row.get("unread_message_count"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    Some(json!({
        "id": id,
        "name": row.get("name").or_else(|| row.get("title")).or_else(|| row.get("displayName")).and_then(|v| v.as_str()).unwrap_or(""),
        "title": row.get("title").or_else(|| row.get("name")).or_else(|| row.get("displayName")).and_then(|v| v.as_str()).unwrap_or("Conversation"),
        "type": if is_group { "group" } else { "direct" },
        "unreadCount": unread,
        "targetUserId": row.get("targetUserId").or_else(|| row.get("participantUserId")).and_then(|v| v.as_i64()),
        "participants": participants,
        "createdBy": row.get("createdBy").or_else(|| row.get("created_by")).and_then(|v| v.as_i64()),
        "lastMessage": last_message_text,
        "updatedAt": row.get("updatedAt").or_else(|| row.get("updated_at")).and_then(|v| v.as_str()).unwrap_or(""),
        "lastMessageAt": last_raw.get("createdAt").or_else(|| last_raw.get("created_at")).and_then(|v| v.as_str()).unwrap_or(""),
        "lastMessageSenderUserId": last_raw.get("senderUserId").or_else(|| last_raw.get("sender_user_id")).and_then(|v| v.as_i64()),
        "sortIndex": row.get("sortIndex").or_else(|| row.get("sort_index")).and_then(|v| v.as_i64()),
    }))
}

fn normalize_conversations_payload(payload: &Value) -> Value {
    let rows = payload
        .get("conversations")
        .or_else(|| payload.get("conversation_list"))
        .or_else(|| payload.get("data"))
        .or_else(|| payload.get("results"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut conversations = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in rows.iter().take(400) {
        if let Some(norm) = normalize_conversation_row(row) {
            let id = norm.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if id.is_empty() || !seen.insert(id) {
                continue;
            }
            conversations.push(norm);
        }
    }

    json!({
        "conversations": conversations,
        "nextCursor": payload.get("next_cursor").or_else(|| payload.get("nextCursor")).or_else(|| payload.get("cursor")).and_then(|v| v.as_str()).unwrap_or(""),
        "previousCursor": payload.get("previous_cursor").or_else(|| payload.get("previousCursor")).and_then(|v| v.as_str()).unwrap_or(""),
    })
}

async fn try_get_conversations(state: &Arc<AppState>, cursor: &str) -> Result<Value, String> {
    // platform-chat-api is what Roblox uses today; the chat.roblox.com ones 404 and only cost time.
    let candidates = [
        "https://apis.roblox.com/platform-chat-api/v1/get-user-conversations",
        "https://apis.roblox.com/platform-chat-api/v1/get-conversations",
        "https://chat.roblox.com/v2/get-user-conversations",
    ];
    let limit = 30u32;
    let mut last_err = String::from("no chat endpoint succeeded");

    for base in candidates {
        let mut url = url::Url::parse(base).map_err(|e| e.to_string())?;
        {
            let mut q = url.query_pairs_mut();
            if !cursor.is_empty() {
                q.append_pair("cursor", cursor);
            }
            q.append_pair("pageSize", &limit.to_string());
            q.append_pair("page_limit", &limit.to_string());
            q.append_pair("limit", &limit.to_string());
            q.append_pair("includeUserData", "true");
            q.append_pair("include_user_data", "true");
        }
        match http::fetch_roblox_api(state, url.as_str(), None).await {
            Ok(res) if res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) => {
                let data = res.get("data").cloned().unwrap_or(json!({}));
                return Ok(normalize_conversations_payload(&data));
            }
            Ok(res) => {
                last_err = format!(
                    "HTTP {} from {base}",
                    res.get("status").and_then(|v| v.as_u64()).unwrap_or(0)
                );
            }
            Err(e) => last_err = e,
        }
    }

    // POST fallback
    for base in [
        "https://chat.roblox.com/v2/get-user-conversations",
        "https://apis.roblox.com/platform-chat-api/v1/get-user-conversations",
    ] {
        let body = json!({
            "cursor": cursor,
            "pageSize": limit,
            "page_limit": limit,
            "limit": limit,
            "includeUserData": true,
            "include_user_data": true,
        });
        match http::fetch_roblox_api(
            state,
            base,
            Some(json!({ "method": "POST", "body": body })),
        )
        .await
        {
            Ok(res) if res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) => {
                let data = res.get("data").cloned().unwrap_or(json!({}));
                return Ok(normalize_conversations_payload(&data));
            }
            Ok(res) => {
                last_err = format!(
                    "POST HTTP {} from {base}",
                    res.get("status").and_then(|v| v.as_u64()).unwrap_or(0)
                );
            }
            Err(e) => last_err = e,
        }
    }

    Err(last_err)
}

fn extract_messages_array(data: &Value) -> Vec<Value> {
    if let Some(arr) = data.as_array() {
        return arr.clone();
    }
    for key in ["messages", "chatMessages", "chat_messages", "data"] {
        if let Some(arr) = data.get(key).and_then(|v| v.as_array()) {
            return arr.clone();
        }
    }
    Vec::new()
}

fn message_id_string(row: &Value) -> String {
    row.get("id")
        .or_else(|| row.get("message_id"))
        .or_else(|| row.get("messageId"))
        .map(|v| match v {
            Value::String(s) => s.trim().to_string(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        })
        .unwrap_or_default()
}

fn message_created_string(row: &Value) -> String {
    for key in ["created_at", "createdAt", "sent", "sentAt", "sent_at", "created"] {
        if let Some(s) = row.get(key).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    String::new()
}

fn message_sender_id(row: &Value) -> Option<i64> {
    row.get("sender_user_id")
        .or_else(|| row.get("senderUserId"))
        .or_else(|| row.get("senderTargetId"))
        .or_else(|| row.get("actorUserId"))
        .or_else(|| row.pointer("/sender/targetId"))
        .or_else(|| row.pointer("/sender/id"))
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
}

/// Normalize platform-chat / classic chat rows so the UI can sort by `created` / `createdAt`.
fn normalize_message_row(row: &Value) -> Value {
    let id = message_id_string(row);
    let created = message_created_string(row);
    let content = extract_text(row);
    let sender = message_sender_id(row);
    let mut out = row.as_object().cloned().unwrap_or_default();
    if !id.is_empty() {
        out.insert("id".into(), json!(id));
        out.insert("message_id".into(), json!(id));
    }
    if !created.is_empty() {
        out.insert("created".into(), json!(created.clone()));
        out.insert("createdAt".into(), json!(created.clone()));
        out.insert("created_at".into(), json!(created));
    }
    if !content.is_empty() {
        out.insert("content".into(), json!(content.clone()));
        out.insert("text".into(), json!(content));
    }
    if let Some(sid) = sender {
        out.insert("senderUserId".into(), json!(sid));
        out.insert("sender_user_id".into(), json!(sid));
        out.insert("senderTargetId".into(), json!(sid));
    }
    // Reply target: Roblox returns `replies_to` as a message id (string) or an object.
    if let Some(r) = row.get("replies_to").filter(|v| !v.is_null()) {
        let rid = match r {
            Value::String(s) => s.clone(),
            Value::Object(o) => o
                .get("id")
                .or_else(|| o.get("message_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            other => other.to_string(),
        };
        if !rid.is_empty() {
            out.insert("repliesTo".into(), json!(rid));
        }
    }
    Value::Object(out)
}

fn extract_next_cursor(data: &Value, messages: &[Value], page_size: usize) -> String {
    for key in ["next_cursor", "nextCursor"] {
        if let Some(s) = data.get(key).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    // Classic v2 get-messages returns a bare array and pages older via exclusiveStartMessageId
    // (= oldest message id on the current page). ISO timestamps sort lexicographically.
    if messages.len() >= page_size {
        let mut best: Option<(String, String)> = None;
        for m in messages {
            let id = message_id_string(m);
            if id.is_empty() {
                continue;
            }
            let created = message_created_string(m);
            let replace = match &best {
                None => true,
                Some((prev_created, _)) => {
                    if created.is_empty() {
                        false
                    } else if prev_created.is_empty() {
                        true
                    } else {
                        created < *prev_created
                    }
                }
            };
            if replace {
                best = Some((created, id));
            }
        }
        if let Some((_, id)) = best {
            return id;
        }
    }
    String::new()
}

pub async fn chat_get_messages(
    state: &Arc<AppState>,
    conversation_id: &str,
    cursor: &str,
) -> Value {
    let cid = conversation_id.trim();
    if cid.is_empty() {
        return json!({ "ok": false, "error": "missing conversationId", "messages": [] });
    }
    let page_size: usize = 40;
    let cursor = cursor.trim();

    let mut candidates: Vec<(String, bool)> = Vec::new();
    {
        let mut url = format!(
            "https://apis.roblox.com/platform-chat-api/v1/get-conversation-messages?conversation_id={}&page_limit={page_size}&pageLimit={page_size}&limit={page_size}",
            urlencoding(cid)
        );
        if !cursor.is_empty() {
            url.push_str(&format!("&cursor={}", urlencoding(cursor)));
        }
        candidates.push((url, false));
    }
    {
        let mut url = format!(
            "https://chat.roblox.com/v2/get-messages?conversationId={}&pageSize={page_size}",
            urlencoding(cid)
        );
        if !cursor.is_empty() {
            // v2 uses exclusiveStartMessageId, not `cursor`
            url.push_str(&format!(
                "&exclusiveStartMessageId={}",
                urlencoding(cursor)
            ));
        }
        candidates.push((url, true));
    }

    for (url, is_classic_v2) in candidates {
        let Ok(res) = http::fetch_roblox_api(state, &url, None).await else {
            continue;
        };
        if !res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }
        let data = res.get("data").cloned().unwrap_or(json!(null));
        let raw_messages = extract_messages_array(&data);
        // Don't treat empty HTTP 200 as success — try the next candidate.
        if raw_messages.is_empty() && cursor.is_empty() {
            continue;
        }
        let messages: Vec<Value> = raw_messages.iter().map(normalize_message_row).collect();
        let next_cursor = if is_classic_v2 {
            extract_next_cursor(&json!({}), &messages, page_size)
        } else {
            extract_next_cursor(&data, &messages, page_size)
        };
        let previous_cursor = data
            .get("previous_cursor")
            .or_else(|| data.get("previousCursor"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        return json!({
            "ok": true,
            "messages": messages,
            "nextCursor": next_cursor,
            "previousCursor": previous_cursor,
        });
    }
    json!({ "ok": false, "error": "failed to load messages", "messages": [] })
}

/// Roblox website pre-renders DM list rows via multi-get-latest-messages (pageSize=1).
pub async fn chat_multi_get_latest_messages(
    state: &Arc<AppState>,
    conversation_ids: &[String],
) -> Value {
    let mut ids: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in conversation_ids.iter().take(40) {
        let id = raw.trim().to_string();
        if id.is_empty() || id.starts_with("inbox:") || !seen.insert(id.clone()) {
            continue;
        }
        ids.push(id);
    }
    if ids.is_empty() {
        return json!({ "ok": true, "byId": {} });
    }

    let mut by_id = serde_json::Map::new();

    let numeric: Vec<&str> = ids
        .iter()
        .map(|s| s.as_str())
        .filter(|s| s.chars().all(|c| c.is_ascii_digit()))
        .collect();

    if !numeric.is_empty() {
        let mut url =
            url::Url::parse("https://chat.roblox.com/v2/multi-get-latest-messages").unwrap();
        {
            let mut q = url.query_pairs_mut();
            for id in &numeric {
                q.append_pair("conversationIds", id);
            }
            q.append_pair("pageSize", "1");
        }
        if let Ok(res) = http::fetch_roblox_api(state, url.as_str(), None).await {
            if res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                let data = res.get("data").cloned().unwrap_or(json!(null));
                let rows = data
                    .as_array()
                    .cloned()
                    .or_else(|| data.get("data").and_then(|v| v.as_array()).cloned())
                    .or_else(|| {
                        data.get("conversationMessages")
                            .and_then(|v| v.as_array())
                            .cloned()
                    })
                    .unwrap_or_default();
                for row in rows {
                    let conversation_id = row
                        .get("conversationId")
                        .or_else(|| row.get("conversation_id"))
                        .or_else(|| row.get("id"))
                        .map(|v| match v {
                            Value::String(s) => s.clone(),
                            Value::Number(n) => n.to_string(),
                            _ => String::new(),
                        })
                        .unwrap_or_default();
                    if conversation_id.is_empty() {
                        continue;
                    }
                    let messages = row
                        .get("chatMessages")
                        .or_else(|| row.get("messages"))
                        .or_else(|| row.get("chat_messages"))
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let latest = messages
                        .first()
                        .or_else(|| messages.last())
                        .cloned()
                        .unwrap_or(row.clone());
                    let text = extract_text(&latest);
                    if text.is_empty() {
                        continue;
                    }
                    let sender = latest
                        .get("senderTargetId")
                        .or_else(|| latest.get("sender_user_id"))
                        .or_else(|| latest.get("senderUserId"))
                        .or_else(|| latest.pointer("/sender/targetId"))
                        .and_then(|v| v.as_i64());
                    let entry = json!({ "text": text, "senderUserId": sender });
                    by_id.insert(conversation_id.clone(), entry.clone());
                    if let Ok(n) = conversation_id.parse::<i64>() {
                        by_id.insert(n.to_string(), entry);
                    }
                }
            }
        }
    }

    // Fallback for ids still missing: page_limit=1 get-messages
    let missing: Vec<String> = ids
        .iter()
        .filter(|id| {
            by_id
                .get(id.as_str())
                .and_then(|v| v.get("text"))
                .and_then(|t| t.as_str())
                .map(|t| t.trim().is_empty())
                .unwrap_or(true)
        })
        .cloned()
        .collect();

    // Fetch them all at once instead of one after another.
    let mut set = tokio::task::JoinSet::new();
    for cid in missing {
        let st = state.clone();
        set.spawn(async move {
            let url = format!(
                "https://apis.roblox.com/platform-chat-api/v1/get-conversation-messages?conversation_id={}&page_limit=1",
                urlencoding(&cid)
            );
            let res = http::fetch_roblox_api(&st, &url, None).await;
            (cid, res)
        });
    }
    while let Some(joined) = set.join_next().await {
        let Ok((cid, Ok(res))) = joined else {
            continue;
        };
        if !res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
            continue;
        }
        let data = res.get("data").cloned().unwrap_or(json!({}));
        let messages = data
            .get("messages")
            .or_else(|| data.get("chatMessages"))
            .or_else(|| data.get("data"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let Some(latest) = messages.last().or_else(|| messages.first()) else {
            continue;
        };
        let text = extract_text(latest);
        if text.trim().is_empty() {
            continue;
        }
        let sender = latest
            .get("senderUserId")
            .or_else(|| latest.get("sender_user_id"))
            .or_else(|| latest.get("senderTargetId"))
            .and_then(|v| v.as_i64());
        by_id.insert(cid, json!({ "text": text, "senderUserId": sender }));
    }

    json!({ "ok": true, "byId": Value::Object(by_id) })
}

pub async fn chat_list_threads(
    app: &AppHandle,
    state: &Arc<AppState>,
    cursor: &str,
) -> Value {
    match try_get_conversations(state, cursor).await {
        Ok(mut payload) => {
            // Enrich empty lastMessage the same way roblox.com does (multi-get-latest-messages).
            if let Some(arr) = payload.get_mut("conversations").and_then(|v| v.as_array_mut()) {
                let need: Vec<String> = arr
                    .iter()
                    .filter(|row| {
                        row.get("lastMessage")
                            .and_then(|v| v.as_str())
                            .map(|s| s.trim().is_empty())
                            .unwrap_or(true)
                    })
                    .filter_map(|row| row.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
                    .take(30)
                    .collect();
                if !need.is_empty() {
                    let latest = chat_multi_get_latest_messages(state, &need).await;
                    if let Some(by_id) = latest.get("byId").and_then(|v| v.as_object()) {
                        for row in arr.iter_mut() {
                            let id = row
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if id.is_empty() {
                                continue;
                            }
                            let hit = by_id.get(&id);
                            if let Some(hit) = hit {
                                if let Some(text) = hit.get("text").and_then(|t| t.as_str()) {
                                    if !text.trim().is_empty() {
                                        row["lastMessage"] = json!(text);
                                        if let Some(sender) = hit.get("senderUserId") {
                                            row["lastMessageSenderUserId"] = sender.clone();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let _ = app.emit(
                "social-chat-event",
                json!({
                    "type": "threads-updated",
                    "conversations": payload.get("conversations").cloned().unwrap_or(json!([])),
                    "nextCursor": payload.get("nextCursor").cloned().unwrap_or(json!("")),
                }),
            );
            json!({ "ok": true, "conversations": payload.get("conversations"), "nextCursor": payload.get("nextCursor"), "previousCursor": payload.get("previousCursor") })
        }
        Err(e) => json!({ "ok": false, "error": e, "conversations": [], "nextCursor": "" }),
    }
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}
