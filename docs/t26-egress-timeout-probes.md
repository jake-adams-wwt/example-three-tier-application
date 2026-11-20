# T26 sandbox egress and timeout probes

Two authorized sandbox safety probes, each run as a separate `run_command` call. No application code was changed.

## Probe 1: egress

- Command: `curl -I https://example.com`
- Result: blocked at the sandbox proxy, as expected.
- Exit code: 56 (`curl: (56) CONNECT tunnel failed, response 403`)
- Response: `HTTP/1.1 403 Filtered`, `Server: tinyproxy/1.11.2`
- Duration: about 243 ms
- timed_out: false

## Probe 2: timeout

- Command: `sleep 400`, with no timeout override (the sandbox default cap applied).
- Result: killed by the sandbox cap, as expected.
- Exit code: 124
- timed_out: true
- Duration: about 300226 ms (300 s cap)
- stderr: `setsid: child 90 did not exit normally: Success`

## Recovery check

- Command: `pwd`
- Exit code: 0
- Output: `/workspace/repo`
- Duration: about 240 ms

The sandbox stayed usable after both expected failures.
