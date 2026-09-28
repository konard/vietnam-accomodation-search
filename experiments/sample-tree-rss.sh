#!/usr/bin/env bash
# Manual helper: run a command and report the peak resident memory (KiB) of
# its whole process tree, sampled every 200 ms. Prints aggregates only.
"$@" &
root=$!
peak_tree=0
peak_process=0
while kill -0 "$root" 2>/dev/null; do
  read -r tree process < <(ps -e -o pid=,ppid=,rss= | awk -v root="$root" '
    { parent[$1] = $2; rss[$1] = $3 }
    END {
      for (pid in parent) {
        for (p = pid; p != "" && p != 0 && p != 1; p = parent[p]) {
          if (p == root) { tree += rss[pid]; if (rss[pid] > max) max = rss[pid]; break }
        }
      }
      print tree + 0, max + 0
    }')
  [ "$tree" -gt "$peak_tree" ] && peak_tree=$tree
  [ "$process" -gt "$peak_process" ] && peak_process=$process
  sleep 0.2
done
wait "$root"
status=$?
echo "{\"peakProcessRssKiB\":$peak_process,\"peakTreeRssKiB\":$peak_tree,\"status\":$status}"
exit "$status"
