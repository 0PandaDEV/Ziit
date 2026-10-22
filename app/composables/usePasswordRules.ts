export const passwordRules = [
  { key: "length", label: "At least 12 characters", short: "12+ characters", test: (v: string) => v.length >= 12 },
  { key: "upper", label: "One uppercase letter", short: "Uppercase letter", test: (v: string) => /[A-Z]/.test(v) },
  { key: "lower", label: "One lowercase letter", short: "Lowercase letter", test: (v: string) => /[a-z]/.test(v) },
  { key: "number", label: "One number", short: "Number", test: (v: string) => /[0-9]/.test(v) },
  { key: "special", label: "One special character", short: "Special character", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

export function usePasswordRules(password: Ref<string>) {
  const results = computed(() =>
    passwordRules.map((rule) => ({
      key: rule.key,
      label: rule.label,
      short: rule.short,
      met: rule.test(password.value),
    }))
  );
  const valid = computed(() => results.value.every((r) => r.met));
  const firstError = computed(
    () => results.value.find((r) => !r.met)?.label ?? null
  );
  return { results, valid, firstError };
}
