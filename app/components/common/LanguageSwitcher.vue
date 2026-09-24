<script setup lang="ts">
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";

const { locale, setLocale } = useI18n();
const preferredLocale = useCookie<string | null>("gateway-ui-locale", { sameSite: "lax" });

async function switchLanguage(value: unknown) {
  if (value === "zh" || value === "en") {
    await setLocale(value);
    preferredLocale.value = value;
  }
}
</script>

<template>
  <Select :model-value="locale" @update:model-value="switchLanguage">
    <SelectTrigger class="h-8 w-28 bg-surface/80">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="zh">中文</SelectItem>
      <SelectItem value="en">English</SelectItem>
    </SelectContent>
  </Select>
</template>
