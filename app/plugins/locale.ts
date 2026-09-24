// Apply the same locale before SSR and hydration. Vue does not repair every
// mismatched title/aria attribute, so client-only switching leaves stale tooltips.
export default defineNuxtPlugin(async () => {
  const { $i18n } = useNuxtApp();
  const preferred = useCookie<string | null>("gateway-ui-locale");
  const configured = useRuntimeConfig().public.defaultLocale;
  const locale = preferred.value ?? configured;
  await $i18n.setLocale(locale === "en" ? "en" : "zh");
});
