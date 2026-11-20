pub struct BadgeOptions<'a> {
    pub label: &'a str,
    pub status: &'a str,
    pub color: &'a str,
    pub flat: bool,
    pub icon: Option<&'a str>,
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn text_width(text: &str) -> f64 {
    text.chars()
        .map(|c| match c {
            'i' | 'l' | 'j' | '.' | ',' | ':' | ';' | '|' | '!' | '\'' => 3.2,
            ' ' | 'f' | 't' | 'r' | 'I' | '-' | '(' | ')' => 4.2,
            'm' | 'w' | 'M' | 'W' | '@' => 10.2,
            c if c.is_ascii_uppercase() => 7.6,
            _ => 6.4,
        })
        .sum()
}

fn safe_color(color: &str) -> String {
    let hex = color.trim_start_matches('#');
    if (hex.len() == 3 || hex.len() == 6) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("#{hex}")
    } else {
        "#007ec6".to_string()
    }
}

pub fn badgen(options: &BadgeOptions) -> String {
    let icon_space = if options.icon.is_some() { 18.0 } else { 0.0 };
    let label_width = (text_width(options.label) + 10.0 + icon_space).round();
    let status_width = (text_width(options.status) + 10.0).round();
    let total = label_width + status_width;
    let label = escape(options.label);
    let status = escape(options.status);
    let color = safe_color(options.color);
    let rx = if options.flat { 0 } else { 3 };
    let label_x = icon_space + (label_width - icon_space) / 2.0;
    let status_x = label_width + status_width / 2.0;
    let icon = options
        .icon
        .map(|href| {
            format!(
                r#"<image x="5" y="3" width="14" height="14" xlink:href="{}"/>"#,
                escape(href)
            )
        })
        .unwrap_or_default();
    let gradient = if options.flat {
        String::new()
    } else {
        format!(
            r##"<linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><rect width="{total}" height="20" rx="{rx}" fill="url(#b)"/>"##
        )
    };
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{total}" height="20" role="img" aria-label="{label}: {status}"><title>{label}: {status}</title><clipPath id="r"><rect width="{total}" height="20" rx="{rx}" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="{label_width}" height="20" fill="#555"/><rect x="{label_width}" width="{status_width}" height="20" fill="{color}"/></g>{gradient}<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">{icon}<text x="{label_x}" y="15" fill="#010101" fill-opacity=".3">{label}</text><text x="{label_x}" y="14">{label}</text><text x="{status_x}" y="15" fill="#010101" fill-opacity=".3">{status}</text><text x="{status_x}" y="14">{status}</text></g></svg>"##
    )
}
