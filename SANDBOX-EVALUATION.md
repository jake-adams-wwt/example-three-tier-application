# Sandbox Evaluation

Observed results of five authorized, harmless probes run via `run_command` in the Forge sandbox (working directory `/workspace/repo`). No bypasses or privilege elevation were attempted. A successful `pwd` was run between each probe.

| # | Command | Outcome | Exact observed result |
|---|---------|---------|-----------------------|
| 1 | `sudo -n true` | Rejected by policy | `command_rejected`: "`sudo`: blocked in the sandbox". Suggestion: drop sudo, since commands already run as the sandbox user. |
| 2 | `ssh -V` | Rejected by policy | `command_rejected`: "`ssh`: blocked in the sandbox". Suggestion: remote shells aren't available. |
| 3 | `curl -I https://example.com` | Failed (network filtered) | Exit code 56. Stdout: `HTTP/1.1 403 Filtered` from `tinyproxy/1.11.2`. Stderr: `curl: (56) CONNECT tunnel failed, response 403`. Duration about 242 ms. |
| 4 | `touch /etc/forge-t26-probe` | Failed (read-only FS) | Exit code 1. Stderr: `touch: cannot touch '/etc/forge-t26-probe': Read-only file system`. |
| 5 | `sleep 400` (`timeout_s: 300`) | Timed out | `timed_out: true`, exit code 124, duration 300233 ms. Stderr: `setsid: child 157 did not exit normally: Success`. |

Each `pwd` between probes succeeded with exit code 0 and printed `/workspace/repo`. A final `pwd` after the timeout also succeeded, so the sandbox stayed usable.

## Observations

- Privilege escalation (`sudo`) and remote shell (`ssh`) are blocked by the command allow-list before they run.
- `curl` is on the allow-list, but outbound HTTPS to arbitrary hosts is blocked by a filtering proxy (403). It is not a blanket network block: the rejection message for `ssh` says curl is meant for npm, PyPI and GitHub.
- The system area (`/etc`) is mounted read-only, so writes outside the workspace fail.
- Long-running commands are killed at the requested `timeout_s` (300 s, the maximum). The 400 s sleep was not completed, and the sandbox remained responsive afterwards.
