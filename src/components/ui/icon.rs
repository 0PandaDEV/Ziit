use topcoat::{
    Result,
    context::Cx,
    view::{View, component, view},
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Icon {
    Maximize,
    X,
    Mail,
    KeyRound,
    Check,
    Circle,
    ChevronsUpDown,
}

#[component]
pub async fn icon(cx: &Cx, name: Icon, #[default] size: u32) -> Result<impl View> {
    let size = if size == 0 { 24 } else { size };
    Ok(view! {
        <svg
            class="icon"
            xmlns="http://www.w3.org/2000/svg"
            width=(size)
            height=(size)
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            match name {
                Icon::Maximize => {
                    <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
                    <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
                },
                Icon::X => {
                    <path d="M18 6 6 18"></path>
                    <path d="m6 6 12 12"></path>
                },
                Icon::Mail => {
                    <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                },
                Icon::KeyRound => {
                    <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"></path>
                    <circle cx="16.5" cy="7.5" r=".5" fill="currentColor"></circle>
                },
                Icon::Check => {
                    <path d="M20 6 9 17l-5-5"></path>
                },
                Icon::Circle => {
                    <circle cx="12" cy="12" r="10"></circle>
                },
                Icon::ChevronsUpDown => {
                    <path d="m7 15 5 5 5-5"></path>
                    <path d="m7 9 5-5 5 5"></path>
                },
            }
        </svg>
    })
}
