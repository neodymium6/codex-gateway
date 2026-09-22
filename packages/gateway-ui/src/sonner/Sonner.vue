<script lang="ts" setup>
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
  XIcon,
} from "@lucide/vue";

import type { ToasterProps } from "vue-sonner";
import { reactiveOmit } from "@vueuse/core";
import { Toaster as Sonner } from "vue-sonner";
import { cn } from "../utils";

const props = defineProps<ToasterProps>();
const delegatedProps = reactiveOmit(props, "class", "toastOptions");
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'hsl(var(--popover) / 0.9)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="{
      classes: {
        // Notifications float above every workspace panel, so passive toast text must not block
        // the editor underneath. Keep only Sonner's explicit action controls interactive.
        toast:
          'pointer-events-none max-h-48 overflow-hidden rounded-md [&_[data-button]]:pointer-events-auto [&_[data-cancel]]:pointer-events-auto [&_[data-close-button]]:pointer-events-auto',
        content: 'min-w-0',
        title: 'max-h-32 overflow-auto whitespace-pre-wrap break-words',
        description: 'max-h-24 overflow-auto whitespace-pre-wrap break-words',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>
