use topcoat::{
    Result,
    context::Cx,
    view::{View, attributes, component, view},
};

use super::ui::button::button;

#[component]
pub async fn leaderboard_setup(cx: &Cx) -> Result<impl View> {
    Ok(view! {
        <div class="leaderboard-setup">
            <div class="text">
                <h2 class="title">"Do you want participate in the public Leaderboard?"</h2>
                <p class="description">"No personal information is exposed except the unique user ID."</p>
            </div>
            <div class="buttons">
                button(
                    text: "Yes",
                    key_name: "Alt+Y",
                    attrs: attributes! {
                        data-api="/api/user"
                        data-body="{\"leaderboardEnabled\":true,\"leaderboardFirstSet\":true}"
                        data-reload=""
                    }
                )
                button(
                    text: "No",
                    key_name: "Alt+N",
                    attrs: attributes! {
                        data-api="/api/user"
                        data-body="{\"leaderboardEnabled\":false,\"leaderboardFirstSet\":true}"
                        data-reload=""
                    }
                )
            </div>
        </div>
    })
}
