import { shellQuote } from "../infra/ssh/shell";

export function hostMetricsRemoteCommand(includeGpuProcesses: boolean) {
  return `sh -lc ${shellQuote(script(includeGpuProcesses))}`;
}

function script(includeGpuProcesses: boolean) {
  return String.raw`
set -u
if [ ! -r /proc/stat ] || [ ! -r /proc/meminfo ] || [ ! -r /proc/net/dev ] || [ ! -r /proc/diskstats ]; then
  printf '@@UNSUPPORTED\n'
  exit 0
fi
export LC_ALL=C
# Millisecond-width %N is not portable (some date implementations ignore its
# width and return nanoseconds successfully). Whole seconds suffice for polling.
sampled_at="$(date +%s)000"
printf '@@BEGIN\t%s\n' "$sampled_at"
printf '@@CPU\n'
sed -n '1p' /proc/stat
printf '@@LOAD\n'
sed -n '1p' /proc/loadavg
printf '@@MEM\n'
grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
printf '@@ROUTE\n'
cat /proc/net/route
printf '@@NET\n'
cat /proc/net/dev
printf '@@BLOCK\n'
for block in /sys/block/*; do [ -e "$block" ] && basename "$block"; done
printf '@@DISK\n'
cat /proc/diskstats
printf '@@FS\n'
df -PkT 2>/dev/null || true
printf '@@GPU\n'
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || true
fi
${includeGpuProcesses ? gpuProcessScript() : ""}
printf '@@END\n'
`;
}

function gpuProcessScript() {
  return String.raw`printf '@@GPU_PROCESS\n'
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_processes="$(nvidia-smi --query-compute-apps=gpu_uuid,pid,used_gpu_memory --format=csv,noheader,nounits 2>/dev/null || true)"
  printf '%s\n' "$gpu_processes"
  printf '@@GPU_PROCESS_OS\n'
  pids="$(printf '%s\n' "$gpu_processes" | awk -F',' '{ gsub(/[[:space:]]/, "", $2); if ($2 ~ /^[0-9]+$/) print $2 }' | sort -nu | paste -sd, -)"
  if [ -n "$pids" ] && command -v ps >/dev/null 2>&1; then
    ps -ww -p "$pids" -o pid=,user:64=,etimes=,pcpu=,rss=,comm=,args= 2>/dev/null || true
  fi
else
  printf '@@GPU_PROCESS_OS\n'
fi
`;
}
