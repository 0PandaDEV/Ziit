pub struct PasswordRule {
    pub pattern: &'static str,
    pub label: &'static str,
    pub short: &'static str,
    pub test: fn(&str) -> bool,
}

pub const PASSWORD_RULES: [PasswordRule; 5] = [
    PasswordRule {
        pattern: "^.{12,}",
        label: "At least 12 characters",
        short: "12+ characters",
        test: |v| v.chars().count() >= 12,
    },
    PasswordRule {
        pattern: "[A-Z]",
        label: "One uppercase letter",
        short: "Uppercase letter",
        test: |v| v.chars().any(|c| c.is_ascii_uppercase()),
    },
    PasswordRule {
        pattern: "[a-z]",
        label: "One lowercase letter",
        short: "Lowercase letter",
        test: |v| v.chars().any(|c| c.is_ascii_lowercase()),
    },
    PasswordRule {
        pattern: "[0-9]",
        label: "One number",
        short: "Number",
        test: |v| v.chars().any(|c| c.is_ascii_digit()),
    },
    PasswordRule {
        pattern: "[^A-Za-z0-9]",
        label: "One special character",
        short: "Special character",
        test: |v| v.chars().any(|c| !c.is_ascii_alphanumeric()),
    },
];

pub fn first_error(password: &str) -> Option<&'static str> {
    PASSWORD_RULES
        .iter()
        .find(|r| !(r.test)(password))
        .map(|r| r.label)
}
