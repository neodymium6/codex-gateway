<script setup lang="ts">
import { BellIcon, Loader2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import type { BrowserNotificationSettings, GatewayNotificationSettings } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import { Label } from "@codex-gateway/ui/label";
import { Switch } from "@codex-gateway/ui/switch";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { normalizeNotificationSettings } from "@/stores/gateway/config";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";

const store = useGatewayConfigStore();
const { t } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t));
const saving = ref(false);
const error = ref("");
const form = ref<GatewayNotificationSettings>(normalizeNotificationSettings());
const browserCategories: (keyof BrowserNotificationSettings)[] = [
  "turnCompleted",
  "goalCompleted",
  "userInputRequested",
  "tmuxCompleted",
  "hostLifecycle",
];
const barkGroup = computed({
  get: () => form.value.bark.group ?? "",
  set: (value: string | number) => {
    form.value.bark.group = String(value).trim() || null;
  },
});

watch(
  () => store.gatewayConfig.notifications,
  (settings) => {
    form.value = normalizeNotificationSettings(settings);
  },
  { immediate: true, deep: true },
);

async function saveSettings() {
  error.value = "";
  saving.value = true;
  try {
    await store.saveNotificationSettings(form.value);
  } catch (caught: unknown) {
    error.value = messageFromError(
      caught,
      t("app.notificationSettingsSaveFailed"),
      errorLabels.value,
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-5">
    <section class="space-y-3" data-testid="browser-notification-settings">
      <h3 class="font-medium">{{ t("app.browserNotifications") }}</h3>
      <p class="text-sm text-ink-secondary">{{ t("app.browserNotificationsDescription") }}</p>
      <div class="space-y-4 rounded-xl border border-hairline bg-canvas-soft/70 p-4">
        <div
          v-for="category in browserCategories"
          :key="category"
          class="flex items-center justify-between gap-4"
        >
          <Label :for="`notify-${category}`">{{
            t(`app.browserNotificationCategories.${category}`)
          }}</Label>
          <Switch :id="`notify-${category}`" v-model="form.browser[category]" />
        </div>
      </div>
    </section>
    <div class="space-y-1">
      <div class="flex items-center gap-2 font-medium">
        <BellIcon class="size-4 text-ink-muted" />
        {{ t("app.barkNotifications") }}
      </div>
      <p class="text-sm text-ink-secondary">
        {{ t("app.barkNotificationsDescription") }}
      </p>
    </div>

    <div class="rounded-xl border border-hairline bg-canvas-soft/70 p-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <Label for="bark-enabled">{{ t("app.enableBark") }}</Label>
          <p class="text-sm text-ink-secondary">{{ t("app.enableBarkDescription") }}</p>
        </div>
        <Switch id="bark-enabled" v-model="form.bark.enabled" />
      </div>
    </div>

    <div class="grid gap-4">
      <div class="grid gap-2">
        <Label for="bark-server-url">{{ t("app.barkServerUrl") }}</Label>
        <Input
          id="bark-server-url"
          v-model="form.bark.serverUrl"
          autocomplete="off"
          inputmode="url"
          placeholder="https://api.day.app"
        />
      </div>
      <div class="grid gap-2">
        <Label for="bark-device-key">{{ t("app.barkDeviceKey") }}</Label>
        <Input
          id="bark-device-key"
          v-model="form.bark.deviceKey"
          autocomplete="off"
          type="password"
          :placeholder="t('app.barkDeviceKeyPlaceholder')"
        />
      </div>
      <div class="grid gap-2">
        <Label for="bark-group">{{ t("app.barkGroup") }}</Label>
        <Input
          id="bark-group"
          v-model="barkGroup"
          autocomplete="off"
          :placeholder="t('app.barkGroupPlaceholder')"
        />
      </div>
    </div>

    <div
      v-if="error"
      class="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <div class="flex justify-end">
      <Button :disabled="saving" @click="saveSettings">
        <Loader2Icon v-if="saving" class="size-4 animate-spin" />
        {{ t("app.saveNotificationSettings") }}
      </Button>
    </div>
  </div>
</template>
