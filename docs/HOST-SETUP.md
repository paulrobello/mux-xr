# Host setup

Use this guide for real par-mux panes and the optional macOS companion service. The [README](../README.md) has a streamer-free demo quick start.

## Serve the built app

Use a mux-enabled par-term-streamer and an existing par-mux daemon. Full hierarchy browsing needs the metadata WebSocket at `/ws?metadata=1` and the core tree request and snapshot messages. The plain streamer binary lacks mux support. [core-release.json](../core-release.json) pins core 0.81.0. The official macOS ARM64 streamer at that pin was qualified against a private par-mux 0.80.0 daemon. See the [core 0.81 review](core-0.81-review.md) for artifact hashes, compatibility, and verification.

Build the frontend with `make build`. Run the streamer in a par-mux pane with the actual binary, socket and TLS PEM paths. For LAN use, load your existing streamer authentication settings first. This example assumes HTTP Basic Auth is already configured with `PAR_TERM_HTTP_USER` and `PAR_TERM_HTTP_PASSWORD_HASH`. Use the HTTPS origin you will open on Quest.

```sh
/path/to/par-term-streamer --host 0.0.0.0 --port 4240 \
  --enable-http --web-root /absolute/path/to/mux-xr/dist \
  --mux-socket /path/to/par-mux.sock --tls-pem /path/to/existing.pem \
  --allowed-origins https://mux-host.local:4240
```

Since core 0.80.0, unauthenticated non-loopback binds require an explicit `--allow-unauthenticated` opt-in. Anyone who can reach an unauthenticated writable listener can send shell input. Keep the listener on the intended LAN and preserve your existing authentication and origin settings. Add `--allow-pane-create` only when users should be able to [create a terminal](WORKSPACE.md#create-terminals). Stop the streamer with Ctrl-C in its owning pane.

## Quest and LAN HTTPS

Open the frontend over HTTPS with a certificate the headset trusts and whose name matches the address you open. Use WSS for the streamer. Desktop localhost can use HTTP for development. Vite can use an existing PEM certificate and key via `MUX_XR_TLS_CERT` and `MUX_XR_TLS_KEY`.

The serving origin is the default streamer endpoint. The app remembers a custom endpoint and attempts to connect automatically when the field is populated. If automatic immersion requires browser activation, use the entry button on the page.

For the prepared preview, look up the exact address, socket and owning pane in the stable checkout’s gitignored `.local/runtime.json` and local launch configuration. The preview mirrors the shared default daemon. Use [isolated fixtures](TESTING.md#private-real-streamer-checks) for automated commands, pane creation, and grid changes.

## Local Whisper dictation

The optional companion serves `/dictate` on port 4242 and accepts the configured frontend origins. It converts audio with FFmpeg and transcribes with local `whisper-cli`. Recording is bounded to 60 seconds and 8 MiB. Temporary audio is removed after processing. See [keyboard and dictation](WORKSPACE.md#keyboard-and-dictation) for the browser workflow.

Install boot startup from the stable checkout with `make install-whisper-service` (administrator authentication required). The system LaunchDaemon runs Bun directly as the configured non-root user, uses RunAtLoad and KeepAlive, and retains the existing model, TLS and origins. It does not require a par-mux session. `make whisper-service-plist` prints the exact configuration without installing it. The installer drains a recognized existing listener, verifies launchd ownership and HTTPS health, and restores availability if the cutover fails. The bundled launchd templates describe the prepared Mac. Inspect the printed plist for the account, paths, and origins before installing.

For a different host or local setup, run the server with explicit values. Repeat `--origin` for each frontend origin.

```sh
bun run scripts/dictation-server.ts --host 0.0.0.0 --port 4242 \
  --origin https://mux-host.local:4240 \
  --cert /path/to/cert.pem --key /path/to/key.pem \
  --model /path/to/ggml-base.en.bin
```

The prepared base.en model is pinned to [whisper.cpp model revision 5359861](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1), SHA-256 `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`, under the model’s MIT license. Local provenance is stored alongside the ignored model.

### Telemetry

Whisper OpenTelemetry loads optional `.local/whisper-otel.env` (mode 600), or standard `OTEL_*` environment variables. `OTEL_EXPORTER_OTLP_ENDPOINT` supplies the base URL, per-signal endpoints override it, and `OTEL_EXPORTER_OTLP_HEADERS` supplies the existing ingestion headers. Metrics, transcription spans and bounded operational logs use service name `mux-xr-whisper`. Telemetry excludes audio, transcript text, and raw exceptions. Metrics are cumulative with explicit timestamps and include request/rejection counts, transcription outcomes and duration, audio byte totals, client/active-job gauges, availability and heartbeat. Export runs every 15 seconds with bounded requests and buffers. Collector failure never blocks dictation. Shutdown exports availability zero.

## Host clipboard sync

**Host → Quest** and **Quest → Host** (browser keyboard drawer, beside **Paste**) copy text between the Mac clipboard and the Quest browser clipboard. In XR, the keyboard panel adds **Paste host**, which types the Mac clipboard into the selected connected terminal through the same bracketed paste path and guards as **Paste**, and **Copy to host**, which sends the Quest clipboard, or text highlighted in Mux XR, to the Mac. Every transfer is one explicit request. Nothing polls or syncs in the background, and terminal OSC 52 copies are not forwarded to the host. If the Quest browser refuses a clipboard write (it needs focus, and often fails in an immersive session), the host text stays available to the very next **Paste** for up to 60 seconds and a toast says so. After that, Paste reads the Quest clipboard again. **Copy to host** never sends that kept host text back. A second **Paste host** press while one is still loading is ignored.

Transfers use the dictation server on port 4242 at `/clipboard` and are off until you pair them:

1. On the Mac, place the owner-provided pairing secret in `.local/clipboard-secret` in the stable checkout, with mode 600. The server requires at least 32 characters, a regular file (not a symlink) of at most 4 KiB, owned by you with no group or world access. The server never creates, generates or defaults this file.
2. Run the server as a per-user LaunchAgent. The system LaunchDaemon cannot reach the Mac pasteboard.
3. In the browser, open **Workspace settings → Host clipboard**, paste the file's contents into **Pairing secret** and choose **Save**. **Forget** removes it from this browser.

The pasteboard (`com.apple.pboard`) is registered only in the logged-in user's `gui/<uid>` launchd domain, so the clipboard route needs the server in that domain. `make whisper-agent-plist` prints the LaunchAgent, which is the same server with `--clipboard-secret-file <repo>/.local/clipboard-secret`, `LimitLoadToSessionType Aqua` and no `UserName`.

To switch from the LaunchDaemon, run `sudo launchctl bootout system/org.mux-xr.whisper && sudo rm /Library/LaunchDaemons/org.mux-xr.whisper.plist`, then `make install-whisper-agent` as yourself (no sudo). That installer refuses while the LaunchDaemon is still loaded or anything else owns port 4242, then checks HTTPS health. Dictation then runs only while you are logged in to the Mac.

To switch back to the LaunchDaemon, run `make uninstall-whisper-agent` as yourself (it boots the agent out, waits for port 4242 to free and removes its plist), then `make install-whisper-service`. The LaunchDaemon installer refuses while the agent is loaded, because KeepAlive would restart an agent it stopped and the two would fight over the port. A failed agent install restores and restarts the previous agent.

Removing the secret file disables clipboard sync and the other paired routes. The server rereads it for every request, so no restart is needed. It also refuses a secret file that is group- or world-accessible, and running without `--clipboard-secret-file` (as the LaunchDaemon does) keeps the route off.

### Pairing and request limits

The Origin allow-list blocks other web pages but is not authentication, because any LAN client can forge it. Each transfer therefore proves the secret with an HMAC-SHA256 challenge-response, so the secret never crosses the wire and never appears in a URL. The comparison is constant-time. Five failed or still-pending attempts in a minute from one client refuse it with HTTP 429, and the block is checked again when the proof arrives. IPv6 clients are grouped by /64. At most 8 clipboard connections are open at once, and the Mac runs one `pbcopy` or `pbpaste` at a time. The client accepts exactly one 32-byte challenge per connection. Before auth, the route does answer `disabled` when no valid secret is set, which tells a LAN client only that sync is off.

Text is limited to 256 KiB of valid UTF-8 without NUL bytes in both directions. `pbcopy` and `pbpaste` run without a shell, with text on stdin and stdout, a 5-second timeout and `LC_CTYPE=UTF-8`. Logs record only directions, byte counts and refusal codes, never clipboard text or the secret. Anyone holding the secret and on the LAN can read and replace the Mac clipboard, so treat it like a password, and Forget it on shared browsers. The browser keeps it in `localStorage` under `mux-xr.host-clipboard-secret`, separate from workspace settings.

The read-only `/host-stats` route for the Host load widget uses the same secret and the same challenge-response under its own protocol string (`mux-xr-host-stats-v1`), so a clipboard proof never passes for stats or the reverse. It shares the clipboard route's failure limit, so failed proofs on either route count toward the same five a minute. It allows 4 open connections in all, 2 per client, and 30 successful requests a minute per client, and returns only the three load averages, the CPU percentage and the core count, never the hostname, CPU model or uptime. CPU usage is sampled from `os.cpus()` only when a request arrives. The server logs each refusal as `Host stats refused: <code>` (origin, rate_limited, busy, auth or disabled) and never logs a successful request.

## Optional host routes

The LaunchAgent installer accepts the flags below after `--install --agent`. Pass all flags for the features you intend to keep enabled when reinstalling. Direct invocation of the server takes `on` after each listed flag. Configure the pairing secret first.

| Feature | Route | Flag or requirement |
| --- | --- | --- |
| Host load and Weather | `/host-stats`, `/weather` | Clipboard pairing |
| Git & CI | `/repo-status` | `--repo-status` |
| Picture proxy | `/picture-fetch` | `--picture-proxy` |
| Picture depth | `/picture-depth` | `--picture-depth` and the pinned ONNX model |
| Kanban strip and Host bookings | `/kanban-strip`, `/bookings` | `--board-feeds` and a working kanban CLI |
| Service health | `/service-health` | `--service-health` and an owner-only `.local/par-obs-query.env` |
| Mesh inbox | `/mesh-inbox` | `--mesh-inbox` and a working par-mesh CLI |
| Toasts | `/toast`, `/toasts` | Clipboard pairing. `--toast-lan` allows posts from other LAN hosts. |

For picture depth, `bun run scripts/fetch-depth-model.ts` installs the pinned Depth Anything V2 Small model and verifies its hash. The server can override the model path with `--depth-model`. For Service health, the environment file supplies `PAR_OBS_CF_ACCESS_CLIENT_ID` and `PAR_OBS_CF_ACCESS_CLIENT_SECRET`. Use mode 600 and keep the file local. See [widgets](WORKSPACE.md#widgets) for the data each feed shows.

### Git and CI route

The pairing secret gates `/repo-status`, the route behind the Git & CI widget, but only when the dictation server also runs with `--repo-status on` (the LaunchAgent installer adds it for `--agent --repo-status`). The route is off by default, so pairing the host clipboard alone never lets a client run commands on the Mac. The client proves the secret with an HMAC-SHA256 over a separate protocol label, the nonce, the pane's OSC 7 host name and the requested directory, so a proof is bound to one host and directory and cannot be replayed against `/clipboard`. An absent host, `localhost` and this Mac's full or short host name in any case count as local. Any other host answers `remote` without running anything. The server resolves the directory with `realpath` and answers only when the directory, the repo root, its git directory and its common git directory all resolve inside the home directory of the user it runs as. Missing paths, paths outside home and non-repos all answer `not-a-repo`, so the answer does not say whether a path exists (response timing still can, to a client holding the secret). It never runs `git status`.

Every git command starts with `git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c safe.bareRepository=explicit -c protocol.allow=never --no-optional-locks -C <dir>`, with the same four settings repeated through `GIT_CONFIG_COUNT` and `GIT_CEILING_DIRECTORIES` set to the parent of home. The git commands are `rev-parse --show-toplevel --absolute-git-dir --git-common-dir`, `symbolic-ref -q --short HEAD`, `for-each-ref --format=%(upstream:short)%00%(upstream:track) refs/heads/<branch>`, `diff-index --cached --quiet HEAD --`, `ls-files --others --exclude-standard --directory` (output capped at one byte) and `config --get remote.origin.url`. None of them reads tracked file content, so the repo's own filter drivers never run. When origin is a GitHub URL with a valid `owner/repo`, the server also runs `gh run list -R <owner/repo> --limit 1 --json conclusion,status,headBranch,workflowName,createdAt --branch=<branch>` from `/`. Otherwise CI reads unknown and `gh` does not run. Each command runs without a shell, with a fixed environment, an output cap and a timeout (3 seconds for git, 4 for `gh`), in its own process group, which is killed on timeout. The requested directory is only ever the `-C` argument.

Answers carry the repo folder name, the branch, the ahead/behind counts, the dirty flag and the CI conclusion, status, workflow name and start time, never file names, remote URLs or the full path. Each client may make 30 authenticated requests a minute and hold 2 unauthenticated connections. Failed proofs on either route count toward one shared five-per-minute block, and at most 8 connections are open at once. Git probes run one at a time and a queued probe whose connection has closed is skipped, while `gh` runs outside that queue.

### Toasts from other programs

Other programs can put a message in front of you in XR. They POST it to the dictation server's `/toast` route on port 4242, and every paired headset receives it on its `/toasts` subscription. The host service handles this route alongside the official streamer binary. A toast is a dark card with a colored stripe for its level: **INFO** cyan, **OK** green (`success`), **WARN** amber, **ERROR** coral, or any `#rrggbb` color you give. Cards show the level, title and source above the message, and play a short cue (an error buzz for errors).

```sh
bun run scripts/send-toast.ts "mux-xr main passed in 4m 12s" --level success --title CI --source gh
bun run scripts/send-toast.ts "Deploying…" --id deploy --timeout 0 --placement center
bun run scripts/send-toast.ts --dismiss deploy
bun run scripts/send-toast.ts "Waiting for an answer" --level warn --pane current
```

`send-toast.ts` reads the pairing secret from `.local/clipboard-secret`, or from `--secret-file` or `MUX_XR_SECRET_FILE`. You can also POST directly over trusted HTTPS.

```sh
curl -sS https://localhost:4242/toast \
  -H "Authorization: Bearer $(cat .local/clipboard-secret)" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Disk is 91% full","level":"warn","title":"Disk","timeout":20}'
```

The JSON body takes these fields:

| Field | Values | Default |
| --- | --- | --- |
| `message` | 1-280 characters, newlines kept | required |
| `level` | `info`, `success`, `warn`, `error` | `info` |
| `title` | up to 60 characters | none |
| `source` | up to 40 characters, shown after the title | none |
| `color` | `#rrggbb` accent, overrides the level color | level color |
| `timeout` | 0–3600 seconds. `0` keeps it until dismissed. | 6 info and success, 10 warn, 15 error |
| `placement` | `top`, `center`, `bottom`, `hud`, `pane` | `top` |
| `paneId` | par-mux pane id such as `%12`, for `pane` | the selected pane |
| `id` | Letters, digits, `.`, `_`, `:` and `-`. Posting the same id again replaces that toast in place | generated |
| `dismiss` | `true` with `id` clears that toast | |

`top`, `center` and `bottom` float 1.25 m in front of you and follow your head with a short lag. Top and bottom each stack up to three cards, newest nearest the edge, and center holds one. `hud` stacks above the HUD's notice row and moves with the HUD. `pane` sits above the named pane, or the selected one, and falls back to the top of view while that pane is not shown. Point and trigger or pinch on a card, or its ×, to dismiss it. Up to 24 toasts are held, extra ones wait for a free card, and a timeout counts from arrival. Warnings and errors are also added to the Bell feed as notices, so they are not lost if the card times out unseen. Toasts posted while no headset is connected are replayed when one subscribes, until they time out (at most 16 are kept).

The reply is `202 {"id": "...", "delivered": N}`, where `N` is the number of subscribed headsets. Refusals carry `{"error": "..."}`: 400 for an invalid field (the message names it), 401 for a missing or wrong bearer token, 403 for a browser request (any `Origin` header) or a LAN sender without `--toast-lan on`, 405 for anything but POST, 413 over 4 KiB, 415 without `Content-Type: application/json`, 429 after five failed tokens a minute (shared with the other routes) or 120 toasts a minute from one client, and 503 while no pairing secret is set.

Security: senders must present the host clipboard pairing secret as `Authorization: Bearer <secret>`. The comparison is constant-time. By default only this Mac may send (loopback addresses). Installing the LaunchAgent with `--toast-lan` (`bun run scripts/install-dictation-service.ts --install --agent --toast-lan`) also accepts LAN senders that present the secret over HTTPS. Browser pages are refused outright, so a web page cannot post toasts. Headsets subscribe with the same HMAC challenge-response as the other routes under their own protocol string (`mux-xr-toasts-v1`), so a proof for one route never passes another. At most 8 subscriptions are open, 4 per client, with a ping every 25 seconds. Control and bidi-override characters are stripped from all text. The server log records levels, delivery counts and refusal codes, never message text or the secret. `bun run scripts/toast-shots.ts` renders every level and placement to `/tmp/xr-toast-shots`.

### Picture proxy

Most image hosts send no CORS headers, so the browser refuses to read them. When the direct fetch fails as CORS, the picture loader falls back to the dictation server's `/picture-fetch` route, which downloads the image on the Mac and returns the bytes. The route is off by default, like `/repo-status`: it needs `--picture-proxy on` (the LaunchAgent installer adds it for `bun run scripts/install-dictation-service.ts --install --agent --picture-proxy`) and the clipboard pairing secret from Settings → Host clipboard. Without the flag the notice reads that the proxy is off, and an unpaired client keeps the plain CORS notice.

The client proves the secret with an HMAC-SHA256 over its own protocol label (`mux-xr-picture-fetch-v1`), the nonce and the requested URL, so a proof cannot be replayed for another URL or against another route.

The server accepts only `http:` and `https:` URLs without a username or password and only the scheme's default port (80 or 443), on the first URL and on every redirect. It resolves the name itself, and refuses the whole request if any answer is loopback, private (10/8, 172.16/12, 192.168/16), link-local, CGNAT (100.64/10), 0/8, multicast, broadcast or reserved (including 192.88.99.0/24), IPv6 loopback, unspecified, unique-local (fc00::/7) or link-local (fe80::/10), or an IPv4-mapped, IPv4-translated, NAT64 or 6to4 form of any of those, or 2001:20::/28 or 3fff::/20. It also reads the Mac's network interfaces fresh on every hop and refuses any address that is one of the Mac's own or falls inside an on-link prefix of any interface, IPv4 or IPv6, so the Mac's global IPv6 address and its LAN neighbours are unreachable through the proxy.

It connects to the validated address, so a second DNS answer cannot redirect the request, while the Host header and TLS server name stay the original hostname. Redirects are followed by hand, at most 3, and every hop is validated again. No cookies or credentials are sent. The whole exchange has a 10 second deadline and a 10 MiB body cap enforced while streaming. Only `image/png`, `image/jpeg`, `image/gif`, `image/webp` and HEVC HEIF (declared `image/heic` or `image/heif`, returned as `image/heif`) are returned, and the first bytes must match the declared type. Closing the client socket aborts its in-flight fetch. Each client may make 20 requests a minute and hold 2 connections, auth failures share the five-per-minute block with the other routes, and at most 8 connections are open at once. The server log records refusal codes and byte counts, never a URL.

An `http:` picture on an `https:` page skips the blocked direct fetch and goes straight to the proxy when a pairing secret exists, and keeps the mixed-content notice otherwise. The server therefore allows `http:` URLs and https-to-http redirects by design, so an on-path observer between the Mac and the image host can read or alter that traffic.
