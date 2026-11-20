use http::header::{CONTENT_TYPE, HeaderValue};
use topcoat::{
    Result,
    context::Cx,
    router::{Body, response::Response, route},
};

use crate::server::utils::config::config;

const PAGES: [(&str, &str, &str); 4] = [
    ("/", "0.9", "weekly"),
    ("/stats", "1.0", "daily"),
    ("/leaderboard", "0.9", "daily"),
    ("/login", "0.9", "weekly"),
];

#[route(GET "/sitemap.xml")]
pub async fn sitemap(cx: &Cx) -> Result<Response> {
    let base = if config().base_url.is_empty() {
        "https://ziit.app"
    } else {
        config().base_url.as_str()
    };
    let lastmod = jiff::Timestamp::now().to_string();
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n",
    );
    for (path, priority, freq) in PAGES {
        xml.push_str(&format!(
            "  <url><loc>{base}{path}</loc><lastmod>{lastmod}</lastmod><changefreq>{freq}</changefreq><priority>{priority}</priority></url>\n"
        ));
    }
    xml.push_str("</urlset>\n");
    let mut response = Response::new(Body::from(xml));
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/xml"));
    Ok(response)
}
