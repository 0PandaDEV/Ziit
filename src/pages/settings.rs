use topcoat::{
    Result,
    context::Cx,
    router::page,
    view::{View, attributes, view},
};

use crate::{
    app::{PageMeta, meta},
    components::{
        flash::flash,
        password_rules::{password_match, password_rules},
        ui::{button::button, input::input, modal::modal, radio_button::radio_button},
    },
    layouts::default::default_layout,
    server::utils::http_util::{auth_user, query_map},
};

fn success_message(code: &str) -> &'static str {
    match code {
        "github_linked" => "GitHub account linked successfully",
        "github_updated" => "GitHub account updated successfully",
        "epilogue_linked" => "Epilogue account linked successfully",
        "epilogue_updated" => "Epilogue account updated successfully",
        "accounts_merged" => "Accounts merged successfully",
        _ => "Success",
    }
}

fn error_message(code: &str) -> &'static str {
    match code {
        "link_failed" => "Account linking failed, please try again",
        "link_cancelled" => "Account linking was cancelled",
        _ => "Something went wrong",
    }
}

fn yes_no(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

#[page(
    "/settings",
    with(meta("Ziit - Settings", "Manage your Ziit account, API key and data.", "/settings")),
    with(PageMeta { class: "page-settings", needs_tz: false })
)]
pub async fn settings(cx: &Cx) -> Result<impl View> {
    let user = auth_user(cx)?.clone();
    let query = query_map(cx);
    let success = query.get("success").map(|c| success_message(c).to_string());
    let error = query.get("error").map(|c| error_message(c).to_string());
    let has_github = user.github_id.is_some();
    let has_epilogue = user.epilogue_id.is_some();
    let toggle_label = if user.leaderboard_enabled {
        "Opt-out of Leaderboard"
    } else {
        "Opt-in to Leaderboard"
    };
    let toggle_body = format!("{{\"leaderboardEnabled\":{}}}", !user.leaderboard_enabled);
    let toggle_success = if user.leaderboard_enabled {
        "Opted out of leaderboard successfully"
    } else {
        "Opted in to leaderboard successfully"
    };
    let public_label = if user.public_data {
        "Make Data Private"
    } else {
        "Make Data Public"
    };
    let public_body = format!("{{\"publicData\":{}}}", !user.public_data);
    let public_success = if user.public_data {
        "Your data is now private"
    } else {
        "Your data is now public"
    };
    let api_key = user.api_key.clone();

    Ok(view! {
        default_layout(
            <div class="container">
                flash(message: success, success: true)
                flash(message: error)
                <section class="account-information">
                    <h2 class="title">"Account Information"</h2>
                    <div class="items">
                        <div class="keys">
                            <p>"User ID"</p>
                            <p>"Email"</p>
                            <p>"Github Linked"</p>
                            <p>"Epilogue Linked"</p>
                            <p>"Show up on Leaderboard"</p>
                        </div>
                        <div class="values">
                            <p>(&user.id)</p>
                            <p>(&user.email)</p>
                            <p>(yes_no(has_github))</p>
                            <p>(yes_no(has_epilogue))</p>
                            <p>(yes_no(user.leaderboard_enabled))</p>
                        </div>
                    </div>
                    <div class="buttons">
                        if !has_github {
                            button(
                                text: "Link Github",
                                key_name: "L",
                                attrs: attributes! { data-api="/api/auth/github/link" data-method="GET" data-open-url="" }
                            )
                        }
                        if !has_epilogue {
                            button(
                                text: "Link Epilogue",
                                key_name: "M",
                                attrs: attributes! { data-api="/api/auth/epilogue/link" data-method="GET" data-open-url="" }
                            )
                        }
                        button(
                            text: toggle_label,
                            key_name: "O",
                            attrs: attributes! {
                                data-api="/api/user"
                                data-body=(toggle_body)
                                data-success=(toggle_success)
                                data-reload=""
                            }
                        )
                        button(
                            text: public_label,
                            key_name: "B",
                            attrs: attributes! {
                                data-api="/api/user"
                                data-body=(public_body)
                                data-success=(public_success)
                                data-reload=""
                            }
                        )
                        button(text: "Change Email", key_name: "E", attrs: attributes! { data-open="#email-modal" })
                        button(text: "Change Password", key_name: "P", attrs: attributes! { data-open="#password-modal" })
                        button(text: "Logout", key_name: "Alt+L", attrs: attributes! { data-api="/api/auth/logout" data-redirect="/login?success=logout" })
                    </div>
                </section>

                modal(id: "email-modal", title: "Change Email", api: "/api/user", success: "Email updated successfully",
                    input(name: "email", input_type: "email", placeholder: "New Email Address", value: &user.email, attrs: attributes! { required="" })
                    input(name: "currentPassword", input_type: "password", placeholder: "Current Password")
                )
                modal(
                    id: "password-modal",
                    title: "Change Password",
                    api: "/api/user",
                    success: "Password updated successfully",
                    input(name: "currentPassword", input_type: "password", placeholder: "Current Password")
                    input(name: "password", input_type: "password", placeholder: "New Password", attrs: attributes! { required="" data-rules="#settings-rules" })
                    password_rules(id: "settings-rules", inline: true)
                    input(name: "confirm", input_type: "password", placeholder: "Confirm Password", attrs: attributes! { required="" data-match="password" })
                    password_match()
                )

                <section class="api-key">
                    <h2 class="title">"API Key"</h2>
                    input(input_type: "password", value: &api_key, locked: true, attrs: attributes! { id="api-key" })
                    <div class="buttons">
                        button(text: "Show API Key", key_name: "S", attrs: attributes! { data-toggle-secret="#api-key" })
                        button(text: "Copy API Key", key_name: "c", attrs: attributes! { data-copy="#api-key" })
                        button(
                            text: "Regenerate API Key",
                            key_name: "r",
                            attrs: attributes! {
                                data-api="/api/user/apikey"
                                data-confirm="Are you sure you want to regenerate your API key? Your existing VS Code extension setup will stop working until you update it."
                                data-success="API key regenerated successfully"
                                data-apply="#api-key@apiKey"
                            }
                        )
                    </div>
                </section>

                <section class="wakatime-import" id="import">
                    <h2 class="title">"Data Import"</h2>
                    <div class="setting-group">
                        <div class="radio-group">
                            radio_button(text: "WakaTime (API Key)", name: "type", value: "wakatime-api", selected: true)
                            radio_button(text: "WakaTime (File)", name: "type", value: "wakatime-file")
                            radio_button(text: "WakAPI", name: "type", value: "wakapi")
                        </div>

                        <div class="when when-wakatime-api when-wakapi">
                            input(name: "apiKey", input_type: "password", placeholder: "Enter your API Key")
                        </div>
                        <div class="when when-wakapi">
                            input(name: "instanceUrl", input_type: "text", placeholder: "Enter your WakAPI instance URL (e.g. https://wakapi.dev)")
                        </div>

                        <div class="steps when when-wakatime-api">
                            <p>"1. Go to " <a href="https://wakatime.com/settings/api-key" target="_blank">"WakaTime API Key Settings"</a></p>
                            <p>"2. Copy your API key (format: waka_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"</p>
                            <p>"3. Paste it above and click Import Data"</p>
                        </div>
                        <div class="steps when when-wakatime-file">
                            <p>"1. Go to " <a href="https://wakatime.com/settings/account" target="_blank">"WakaTime Settings"</a></p>
                            <p>"2. Click on " <kbd>"Export my code stats..."</kbd> " and select Heartbeats"</p>
                            <p>"3. Wait and then download your data"</p>
                            <p>"4. Upload the downloaded JSON file below"</p>
                        </div>
                        <input type="file" id="wakaTimeFileUpload" name="file" accept=".json" class="when when-wakatime-file">
                    </div>
                    <p class="setting-description">
                        "For a detailed guide refer to "
                        <a href="https://docs.ziit.app/data-import">"Wakatime/Wakapi Import"</a>
                    </p>
                    button(text: "Import Data", key_name: "I", attrs: attributes! { id="import-submit" })
                    <div id="import-status" class="import-status" hidden="">
                        <p>
                            <span class="spinner">"-"</span>
                            <span class="message"></span>
                        </p>
                        <div class="bar-container"><div class="bar"></div></div>
                    </div>
                </section>

                <section class="data-export">
                    <h2 class="title">"Data Export"</h2>
                    <form action="/api/user/export" method="get" class="setting-group">
                        <div class="radio-group">
                            radio_button(text: "JSON", name: "format", value: "json", selected: true)
                            radio_button(text: "CSV", name: "format", value: "csv")
                        </div>
                        <p class="setting-description export-json">"Includes your account info, daily summaries and every heartbeat."</p>
                        <p class="setting-description export-csv">"One row per heartbeat: timestamp, project, editor, language, OS, file and branch."</p>
                        button(text: "Export Data", key_name: "X", attrs: attributes! { type="submit" })
                    </form>
                </section>

                <section class="danger-zone">
                    <h2 class="title">"Danger Zone"</h2>
                    <div class="setting-group">
                        button(
                            text: "Purge all data",
                            key_name: "Alt+C",
                            red: true,
                            attrs: attributes! {
                                data-api="/api/user/purge"
                                data-countdown="purge"
                                data-success="User data successfully purged"
                                data-reload=""
                            }
                        )
                        button(
                            text: "Delete account",
                            key_name: "Alt+D",
                            red: true,
                            attrs: attributes! {
                                data-api="/api/user/delete"
                                data-countdown="delete"
                                data-redirect="/login"
                            }
                        )
                    </div>
                </section>
            </div>
        )
    })
}
