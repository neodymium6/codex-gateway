// Background events have no browser request/cookie. Use the deployment default
// for server-generated notifications and lifecycle details (including tooltips).
export function serverText(en: string, zh: string): string {
  return process.env.NUXT_PUBLIC_DEFAULT_LOCALE === "en" ? en : zh;
}
