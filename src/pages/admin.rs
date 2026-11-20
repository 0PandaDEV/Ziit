use serde::Deserialize;
use topcoat::{
    Result,
    context::Cx,
    cookie::{Cookie, Cookies, SameSite, cookies, time::Duration},
    router::{content::Form, page, response::Response, route},
    view::{View, class, component, view},
};

use crate::components::ui::nav::nav;
use crate::{
    app::{PageMeta, meta},
    components::ui::{button::button, icon::Icon, input::input},
    layouts::navbar::navbar_layout,
    server::{
        api::admin_get::{AdminUser, dashboard_rows, valid_key},
        utils::{
            auth::read_cookie,
            config::config,
            http_util::{query_map, redirect},
        },
    },
};

#[derive(Deserialize)]
struct AuthForm {
    #[serde(rename = "adminKey")]
    admin_key: String,
}

#[route(POST "/admin")]
pub async fn authenticate(cx: &Cx, Form(form): Form<AuthForm>) -> Result<Response> {
    if valid_key(&form.admin_key, &config().admin_key) {
        cookies(cx).add(
            Cookie::build(("adminKey", form.admin_key))
                .path("/")
                .max_age(Duration::hours(1))
                .http_only(true)
                .secure(config().production)
                .same_site(SameSite::Strict),
        );
        Ok(redirect("/admin"))
    } else {
        Ok(redirect("/admin?error=invalid"))
    }
}

fn minutes(total: i64) -> String {
    format!("{}h {}m", total / 60, total % 60)
}

fn date(value: &str) -> String {
    value.replace('T', " ").chars().take(16).collect()
}

#[component]
async fn header_cell(
    cx: &Cx,
    label: &str,
    key: &str,
    sort: &str,
    desc: bool,
    #[default] id: bool,
) -> Result<impl View> {
    let active = sort == key;
    let next = if active && desc { "asc" } else { "desc" };
    Ok(view! {
        <td class=(class!("id" if id, "sorted" if active, "asc" if active && !desc, "desc" if active && desc))>
            <a (nav(cx, format!("/admin?sort={key}&order={next}")))>(label)</a>
        </td>
    })
}

fn sort_users(users: &mut [AdminUser], key: &str, desc: bool) {
    users.sort_by(|a, b| {
        let ordering = match key {
            "id" => a.id.cmp(&b.id),
            "email" => a.email.cmp(&b.email),
            "github_username" => a.github_username.cmp(&b.github_username),
            "total_minutes" => a.total_minutes.cmp(&b.total_minutes),
            "heartbeats" => a.heartbeats_count.cmp(&b.heartbeats_count),
            "summaries" => a.summaries_count.cmp(&b.summaries_count),
            "last_login" => a.last_login.cmp(&b.last_login),
            _ => a.created_at.cmp(&b.created_at),
        };
        if desc { ordering.reverse() } else { ordering }
    });
}

#[page(
    "/admin",
    with(meta("Ziit - Admin", "Ziit administration dashboard.", "/admin")),
    with(PageMeta { class: "page-admin", needs_tz: false })
)]
pub async fn admin(cx: &Cx) -> Result<impl View> {
    let query = query_map(cx);
    let authenticated =
        read_cookie(cx, "adminKey").is_some_and(|k| valid_key(&k, &config().admin_key));
    let sort = query
        .get("sort")
        .cloned()
        .unwrap_or_else(|| "created_at".into());
    let desc = query.get("order").map(String::as_str) != Some("asc");
    let mut users = if authenticated {
        dashboard_rows().await.unwrap_or_default()
    } else {
        Vec::new()
    };
    sort_users(&mut users, &sort, desc);
    let invalid = query.contains_key("error");
    let by = |key: &str| sort == key;
    let (by_id, by_email, by_github, by_minutes, by_hb, by_sum, by_created, by_login) = (
        by("id"),
        by("email"),
        by("github_username"),
        by("total_minutes"),
        by("heartbeats"),
        by("summaries"),
        by("created_at"),
        by("last_login"),
    );

    Ok(view! {
        navbar_layout(
            if !authenticated {
                <form class="auth" method="post" action="/admin" autocomplete="on">
                    if invalid {
                        <p class="description">"Invalid admin key"</p>
                    }
                    input(name: "adminKey", placeholder: "Enter Admin Key", input_type: "password", icon_name: Some(Icon::KeyRound))
                    button(text: "Authenticate", key_name: "enter", attrs: topcoat::view::attributes! { type="submit" })
                </form>
            } else {
                <table class="data-table">
                    <thead class="header row">
                        <tr>
                            header_cell(label: "User ID", key: "id", sort: &sort, desc: desc, id: true)
                            header_cell(label: "Email", key: "email", sort: &sort, desc: desc)
                            header_cell(label: "GitHub", key: "github_username", sort: &sort, desc: desc)
                            header_cell(label: "Total Hours", key: "total_minutes", sort: &sort, desc: desc)
                            header_cell(label: "Heartbeats", key: "heartbeats", sort: &sort, desc: desc)
                            header_cell(label: "Active Days", key: "summaries", sort: &sort, desc: desc)
                            header_cell(label: "Created At", key: "created_at", sort: &sort, desc: desc)
                            header_cell(label: "Last Login", key: "last_login", sort: &sort, desc: desc)
                        </tr>
                    </thead>
                    <tbody>
                        for user in users {
                            <tr class="row">
                                <td class=(class!("id", "sorted" if by_id))>(user.id.clone())</td>
                                <td class=(class!("sorted" if by_email))>
                                    <a href=(format!("mailto:{}", user.email))>(user.email.clone())</a>
                                </td>
                                <td class=(class!("sorted" if by_github))>
                                    if let Some(name) = user.github_username.clone() {
                                        <a href=(format!("https://github.com/{name}")) target="_blank">(name)</a>
                                    } else {
                                        <span>"N/A"</span>
                                    }
                                </td>
                                <td class=(class!("sorted" if by_minutes))>(minutes(user.total_minutes))</td>
                                <td class=(class!("sorted" if by_hb))>(user.heartbeats_count)</td>
                                <td class=(class!("sorted" if by_sum))>(user.summaries_count)</td>
                                <td class=(class!("sorted" if by_created))>(date(&user.created_at))</td>
                                <td class=(class!("sorted" if by_login))>(date(&user.last_login))</td>
                            </tr>
                        }
                    </tbody>
                </table>
            }
        )
    })
}
