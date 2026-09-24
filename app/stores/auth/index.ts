import { defineStore } from "pinia";
import { useLocalStorage } from "@vueuse/core";

export const AUTH_STORAGE_KEY = "codex-gateway-auth-token";

export const useAuthStore = defineStore("auth", () => {
  const token = ref("");
  const username = ref("");
  const initialized = ref(false);
  const trustedNetwork = ref(false);
  const bootstrapFailed = ref(false);
  let bootstrapPromise: Promise<void> | null = null;
  const sessionEpoch = ref(0);
  const storedToken = useLocalStorage<string | null>(AUTH_STORAGE_KEY, null);
  const storedUsername = useLocalStorage<string | null>(`${AUTH_STORAGE_KEY}:username`, null);

  const isAuthenticated = computed(() => token.value !== "");

  watch([storedToken, storedUsername], ([nextToken, nextUsername]) => {
    if (!initialized.value) return;
    // VueUse synchronizes useLocalStorage across same-origin tabs. Mirror that durable state into
    // the live session so logout/account switches advance sessionEpoch and cancel stale HTTP/RAF
    // work in every open Gateway tab without waiting for a refresh.
    replaceSession(nextToken ?? "", nextUsername ?? "");
  });

  function hydrate() {
    if (!import.meta.client || initialized.value) {
      return;
    }
    replaceSession(storedToken.value ?? "", storedUsername.value ?? "");
    initialized.value = true;
  }

  async function bootstrap() {
    if (bootstrapPromise !== null) return bootstrapPromise;
    bootstrapPromise = (async () => {
      bootstrapFailed.value = false;
      try {
        const result = await $fetch<{
          mode: "password" | "trusted-network";
          session?: { token: string; user: { username: string } };
        }>("/api/auth/bootstrap", {
          method: "POST",
          body: {},
          headers:
            storedToken.value !== null && storedToken.value !== ""
              ? { authorization: `Bearer ${storedToken.value}` }
              : {},
        });
        trustedNetwork.value = result.mode === "trusted-network";
        if (result.session) setSession(result.session.token, result.session.user.username);
        else hydrate();
      } catch {
        bootstrapFailed.value = true;
        replaceSession("", "");
        initialized.value = true;
      }
    })().finally(() => {
      bootstrapPromise = null;
    });
    return bootstrapPromise;
  }

  async function login(input: { username: string; password: string }) {
    const session = await $fetch<{
      token: string;
      expiresAt: string;
      user: { id: number; username: string };
    }>("/api/auth/login", {
      method: "POST",
      body: input,
    });
    setSession(session.token, session.user.username);
    return session;
  }

  function setSession(nextToken: string, nextUsername: string) {
    replaceSession(nextToken, nextUsername);
    initialized.value = true;
    storedToken.value = nextToken;
    storedUsername.value = nextUsername;
  }

  async function logout() {
    const currentToken = token.value;
    if (currentToken !== "") {
      try {
        await $fetch("/api/auth/logout", {
          method: "POST",
          headers: { authorization: `Bearer ${currentToken}` },
        });
      } finally {
        clearSession();
      }
      return;
    }
    clearSession();
  }

  function clearSession() {
    replaceSession("", "");
    initialized.value = true;
    storedToken.value = null;
    storedUsername.value = null;
    if (trustedNetwork.value) void bootstrap();
  }

  function replaceSession(nextToken: string, nextUsername: string) {
    if (token.value !== nextToken) sessionEpoch.value += 1;
    token.value = nextToken;
    username.value = nextUsername;
  }

  function isCurrentSession(epoch: number) {
    return sessionEpoch.value === epoch;
  }

  return {
    token,
    username,
    initialized,
    sessionEpoch,
    isAuthenticated,
    hydrate,
    bootstrap,
    bootstrapFailed,
    trustedNetwork,
    login,
    logout,
    clearSession,
    isCurrentSession,
  };
});
