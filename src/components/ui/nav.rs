use topcoat::{
    context::Cx,
    runtime::{link_attrs, prefetch_mode},
    view::{AttributeValueViewParts, Attributes},
};

pub fn nav(cx: &Cx, href: impl AttributeValueViewParts) -> Attributes {
    link_attrs(cx, href, prefetch_mode(cx))
}
