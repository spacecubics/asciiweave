# Durable Objects duration: incident and fix plan

On 2026-09-04 the Space Cubics Cloudflare account exceeded the Workers Free plan
limit for Durable Objects duration. Cloudflare then refused every Durable Object
request that incurs duration until the daily reset at 00:00 UTC, which took the
production collaboration WebSocket down. This document records how Durable
Objects duration is billed, what the analytics showed, the exact cause in the
`CollabRoom` implementation, and the planned fix. See
[`deployment-cloudflare.md`](deployment-cloudflare.md) for the deployment
runbook and [`architecture.md`](architecture.md) for the collaboration design.

## How Durable Objects duration is billed

A Durable Object is a single-instance, single-threaded JavaScript object
addressed by name. Cloudflare guarantees exactly one live copy of `CollabRoom`
per document ID, so it can be the one writer for that document, the same role
the Node process plays locally. It is not a long-running server: the runtime
loads it when a request or WebSocket message arrives and unloads it when it goes
quiet.

Durable Objects have two meters:

- **Requests** count invocations. They are not the problem here.
- **Duration** is wall-clock time while the object executes or sits idle but is
  ineligible for hibernation, billed as if it used 128 MB regardless of actual
  use and measured in GB-seconds. An idle, hibernateable Object is not billed
  even during the short interval before Cloudflare removes it from memory.

The Free plan allows 13,000 GB-s per day, shared by every Durable Object in the
account (staging and production together). Divided by 0.128 GB this is 101,562.5
object-seconds, or about 28.2 object-hours per day. Expressed in microseconds it
is exactly the `101562500000` quoted in Cloudflare's notice.

An object accrues duration while it executes code and also while it sits idle
but is not allowed to hibernate. Per Cloudflare's lifecycle rules an object can
hibernate only when all of the following hold:

- no `setTimeout` or `setInterval` callback is pending;
- no awaited `fetch()` is in flight;
- no WebSocket was accepted through the standard `ws.accept()` API (as opposed
  to the WebSocket Hibernation API, `ctx.acceptWebSocket()`);
- no request or event is being processed;
- no outbound TCP or WebSocket connection is open.

When these hold, duration stops accruing as soon as the object goes idle.
Cloudflare's pricing page is explicit: "An idle Durable Object that qualifies
for hibernation does not incur duration charges, even during the brief window
before the runtime hibernates it." The runtime physically hibernates the object
after about 10 seconds of quiet; its WebSockets stay connected at the Cloudflare
edge, and the next message wakes it, runs the constructor again, and starts with
empty in-memory state. When the conditions do not hold, the object stays in
memory, and billed, for as long as the connection or timer lives.

Two related runtime facts matter for the fix. `state.waitUntil()` is documented
as having no effect in Durable Objects: "Durable Objects automatically remain
active as long as there is ongoing work or pending I/O, so `waitUntil` is not
needed." And `ws.serializeAttachment()` stores up to 16,384 bytes of
structured-clone data per WebSocket that "persist through hibernation as long as
the WebSocket remains healthy."

## What the analytics showed

The GraphQL analytics API (`durableObjectsPeriodicGroups`, field `activeTime`,
in microseconds) accepts the OAuth token that `wrangler login` stores, so usage
can be read from a terminal. For the production namespace:

| Date (UTC)                | Billed active time | Inbound WS messages | Requests |
| ------------------------- | ------------------ | ------------------- | -------- |
| 2026-09-03                | 68,070 s (18.9 h)  | 12,401              | 50       |
| 2026-09-04                | 106,236 s (29.5 h) | 12,578              | 39       |
| 2026-09-05 (to 07:09 UTC) | 24,825 s (6.9 h)   | 1,618               | 5        |
| Daily limit               | 101,562 s (28.2 h) |                     |          |

The 2026-09-04 total splits across exactly two objects (`objectId` dimension):

| Object (id prefix) | Active time | Duration    | CPU time | Inbound WS messages |
| ------------------ | ----------- | ----------- | -------- | ------------------- |
| `6cd73c65`         | 61,002 s    | 7,808 GB-s  | 3.05 s   | 6,802               |
| `2916829a`         | 45,234 s    | 5,790 GB-s  | 2.25 s   | 5,776               |
| Total              | 106,236 s   | 13,598 GB-s | 5.30 s   | 12,578              |

The cumulative per-minute series crosses the daily limit during the minute
starting 2026-09-04T15:38:00Z. Only the production namespace contributed on the
incident days; the staging namespace last showed usage on 2026-08-28 (386 s of
test traffic). The 2026-09-05 row is a partial day, queried at 07:09 UTC, and
comes entirely from object `6cd73c65`, which was still connected at that time.

A few dozen requests per day against tens of thousands of seconds of active time
and about five seconds of CPU means the cost is idle duration, not traffic.
Roughly 12,500 inbound messages per day is one every 7 seconds, which matches
about two browser tabs each sending the y-websocket awareness heartbeat every
15 seconds. The partial figure for 2026-09-05 (6.9 active hours in the first
7.15 hours) shows one object alive continuously, that is, a tab left open on
production.

## Exact cause

Any open editor tab keeps its document's `CollabRoom` in memory, and billed,
for the life of the tab, because `server/src/worker/room.ts` accepts WebSockets
with the standard API (`ws.accept()` in `accept()`). That disqualifies the
Object from hibernation for as long as any connection is open. This is the
empirically confirmed cause: every billed interval in the analytics had at least
one WebSocket attached, and the two objects billed on 2026-09-04 correspond to
two documents with one or more open tabs on each.

A second, latent blocker sits in the same file. The server-side
`awarenessProtocol.Awareness` created in `load()` starts a 3-second
`setInterval` in its constructor (y-protocols `awareness.js`). That timer by
itself forbids hibernation, so it would defeat the Hibernation API if left in
place. The analytics do not show it contributing during this incident, since
the sockets already kept the Object awake, but it must go in the same change.

The 1-second persist debounce in `server/src/collaboration/room-binding.ts` is
not a cause: its timer is pending only while someone is typing.

The browser's behavior is not a blocker. The y-protocols client re-broadcasts
its awareness state every 15 seconds while its local state is non-null, which
wakes a hibernated Object every 15 seconds per idle tab. Each wake is billed
only for the time spent executing the handler (and the D1 reload of the Yjs
state on a cold wake), not for the idle seconds that follow, so an idle tab
costs milliseconds per minute once the server can hibernate.

## Fix plan

Steps 1 through 4 are implemented in the Worker target. The staging measurement
and promotion checks passed on 2026-09-05; the results are recorded below.
Production deployment remains a separate promotion step.

1. **Move `CollabRoom` to the WebSocket Hibernation API.** Replace `ws.accept()`
   with `this.state.acceptWebSocket(server)` and turn the `message`, `close`,
   and `error` listeners into `webSocketMessage`, `webSocketClose`, and
   `webSocketError` methods on the class. Because memory is wiped on
   hibernation, the document name must travel in each WebSocket's attachment
   (`ws.serializeAttachment()`), and the connection map must be rebuilt from
   `this.state.getWebSockets()` on wake. The lazy `load()` still restores the
   Yjs document from D1, but it now runs on every cold wake, not only on first
   use, and must take its document name from the attachment.

2. **Remove the server-side Awareness timer and keep presence complete across
   hibernation.** The `Awareness` instance's 3-second interval must not run
   inside the Object; either clear it right after construction or replace the
   class with a timerless relay. To preserve today's immediate presence for a
   new joiner, store each connection's controlled awareness client IDs together
   with its latest encoded awareness update in the attachment:

   ```ts
   interface Attachment {
     docName: string
     controlledIds: number[]
     awarenessUpdate?: Uint8Array
   }
   ```

   An incoming awareness message can be incremental, so do not store its raw
   bytes as though they were a complete snapshot. After applying it, encode all
   states currently controlled by that connection and replace the attachment's
   `awarenessUpdate` with that complete per-connection snapshot. On wake, rebuild
   the server awareness state from every attachment before sending a new
   connection its handshake. Ordinary asciiweave awareness payloads are a few
   hundred bytes, but attachment serialization must still handle the hard
   16,384-byte limit without taking down the room.

   Initialization order is part of correctness. On a WebSocket wake, obtain the
   document name from an attachment, restore the Yjs document from D1, restore
   awareness from all attached WebSockets, and only then deliver queued socket
   events. Use `state.blockConcurrencyWhile()` during this cold initialization,
   or provide an equivalent loading gate that every event handler awaits. Attach
   the Yjs update/broadcast listener after applying the stored state so loading a
   room does not broadcast its entire document as a new update.

3. **Make persistence hibernation-safe.** The debounced write in
   `room-binding.ts` already keeps the Object awake while it is pending (a
   pending `setTimeout` blocks hibernation) and while the D1 write is in flight
   (pending I/O keeps the Object active), so `waitUntil` is neither needed nor
   effective. What should change: the last-client flush in `handleClose` must
   cancel the pending debounce so the Object does not write twice and can go
   idle a second sooner, and the wake path must tolerate the constructor
   running again with an empty `conns` map. This may mean extending the shared
   binding API so the debounce can be cancelled from outside; the shared module
   is not guaranteed to stay untouched.

4. **Add Worker tests** (`npm run test:workers`) covering eviction and wake
   with connected sockets, immediate presence for a joiner after a wake, edit
   convergence across a wake, close cleanup of awareness state, and D1
   persistence through the debounce and last-client flush.

5. **Optional: disconnect hidden tabs in the browser.** Once the server can
   hibernate, this is no longer needed to stay within the duration budget. It
   would reduce the 15-second wake cadence (each wake is a request plus a D1
   read) and the presence noise of abandoned tabs, but it changes presence and
   connection behavior on both server targets, so it is a product decision to
   make separately. If done, disconnect the provider rather than nulling
   awareness: y-websocket closes and reopens any socket that has received
   nothing for 30 seconds, which would wake the Object every 30 seconds instead.

Expected effect after steps 1 to 3: an idle open tab, visible or hidden, costs
only its brief handler executions; a closed or explicitly disconnected tab
costs nothing; and an actively edited document costs roughly its editing time.
The daily budget of about 28 object-hours then covers normal use comfortably.

## UI and UX expectations

Hibernation must be an infrastructure detail, not a connection state visible to
the editor. Cloudflare keeps a hibernatable WebSocket connected at the edge, so
sleeping and waking the Object must not make the top bar flash `Offline` or
`Connecting...`, remove collaborators, reset cursors, or require a page reload.

asciiweave's local-first editing path makes this a good fit. CodeMirror applies
an edit to the browser's Yjs document immediately and the preview renders from
that local state; neither waits for the server. A cold wake can therefore add
latency only to remote delivery, presence, API reads, and persistence. It must
not add latency to local typing or preview rendering.

Preserve these observable properties:

- typing and local preview updates remain immediate while a room wakes;
- the provider's WebSocket stays connected throughout an idle period and wake;
- the first edit after a cold wake reaches another editor without a visible
  pause;
- existing names and cursors do not flicker or disappear across a wake;
- a newly joining editor immediately receives the complete current presence
  state rather than waiting for the next 15-second awareness renewal;
- simultaneous messages arriving during cold initialization are applied once,
  in a consistent order, and all peers converge;
- an export or document GET during a wake returns the current room source;
- a runtime eviction or failed wake never silently reports `Synced` while edits
  are no longer reaching the server. Normal y-websocket reconnection may show
  the existing connection-state UI when there is a real connection failure.

Do not disconnect hidden tabs as part of the duration fix. Doing so changes
presence semantics and causes a visible reconnection when the user returns,
without being necessary for hibernation savings. Revisit it only if later
measurements show that awareness request volume or repeated cold D1 loads are a
material problem.

## Staging measurement and benchmark plan

Measure the change on the dedicated staging Worker before production. Use new
document IDs for each run so pre-fix and post-fix samples cannot be mixed, and
record the Worker version, UTC start/end timestamps, browser count, document
size, and test region with every result. Keep the browser machine awake and the
network stable. Run each latency scenario enough times to report median and p95,
not a single best-case sample.

### Establish the duration baseline

Before deploying the fix, run a controlled 30-minute idle session against the
current staging version with one visible browser connected to one otherwise
unused document. Do not type after initial synchronization. The standard
WebSocket implementation should produce approximately 1,800 active seconds, or
230.4 GB-s (`1,800 * 0.128`), and provides the direct comparison for the fixed
version.

Repeat the same 30-minute workload after deploying the fix. Query
`durableObjectsPeriodicGroups` grouped by namespace, Object, and minute, and
record at least `activeTime`, `duration`, `cpuTime`, inbound/outbound WebSocket
messages, and maximum active WebSocket connections. Hibernatable incoming
WebSocket messages are reported in `durableObjectsInvocationsAdaptiveGroups`,
so use that dataset for their invocation counts after the migration. Allow for
Cloudflare's analytics ingestion delay before judging the run.

The duration acceptance criterion is at least a 95% reduction in idle
`activeTime` relative to the controlled baseline, with no continuous minute-by-
minute accumulation that resembles socket residency. If idle active time
exceeds 90 seconds in a 30-minute run, investigate which handler, timer, or I/O
operation remains active before promoting the build. Also confirm that duration
stops accumulating after the last socket closes.

Run two scaling controls after the single-browser case:

1. two idle browsers connected to the same document, which should increase
   messages but still use one Object; and
2. one idle browser on each of two documents, which should use two Objects but
   remain charged only for their brief handler executions.

These controls distinguish per-message work from the per-Object wall-clock leak
that caused the incident.

### Measure collaboration latency and behavior

Use two independent browser contexts and timestamp a Yjs transaction in the
sending page and its observation in the receiving page. Measure both a warm
room and a cold room. For the cold case, force both clients to renew their
awareness state together, then leave the room completely idle for at least 12
seconds but less than the next 15-second awareness renewal and the client's
30-second reconnect timeout before sending an edit. This prevents a staggered
heartbeat from waking the room during the intended idle window. Duration
metrics can confirm that the Object stopped billing, but only a constructor
marker or equivalent temporary staging-only diagnostic proves that the runtime
physically discarded and recreated it. Require that evidence before treating a
sample as a cold wake.

Use these initial UX gates:

| Measurement                                       | Acceptance criterion                       |
| ------------------------------------------------- | ------------------------------------------ |
| Warm remote-edit delivery, p95                    | <= 250 ms                                  |
| Cold-wake remote-edit delivery, p95               | <= 500 ms                                  |
| Worst cold-wake sample                            | < 2 s                                      |
| New collaborator presence after joining           | <= 1 s, without waiting for a heartbeat    |
| Connection status during idle wake                | No false `Offline` or reconnect transition |
| Peer convergence after concurrent cold-wake edits | Exact convergence in every run             |

Treat these as launch gates, then retain the measured staging values as the
baseline for future regressions. If network variance makes an absolute latency
gate noisy, compare cold and warm samples from the same run and investigate a
cold-wake p95 penalty above 300 ms.

Exercise both a small document and a generated AsciiDoc document of about 150
KB, comparable in size to the larger production document seen during this
incident without copying its contents. The large case exposes D1 read and Yjs
decode costs that a nearly empty document would hide. Record D1 rows read and
the number of cold room loads alongside latency so a good browser result does
not conceal excessive database traffic.

### Staging functional checks

In addition to the measurements, verify these sequences before promotion:

1. idle past hibernation, edit from either browser, and observe convergence;
2. idle, join with a third browser, and see both existing users immediately;
3. idle, disconnect one browser, and see its awareness disappear immediately;
4. edit, cross the persistence debounce, hibernate, and recover the same source;
5. close the last browser during a pending debounce and verify one final durable
   snapshot without a duplicate delayed write;
6. request document JSON and plain-source export during and after a cold wake;
7. force eviction in the Workers test runtime and repeat wake, presence, close,
   and persistence checks.

Run the normal Worker checks before deploying the benchmark build:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:workers
npm run build
```

Deploy only to staging, record the uploaded commit in `GIT_COMMIT`, perform the
controlled runs, and review Durable Object errors and duration graphs before
allowing the production workflow to promote the change. Do not use production
documents or production traffic as the benchmark.

## Staging measurement results

The controlled staging run on 2026-09-05 compared pre-fix commit `22d92da`
with fixed commit `e3cfc17`. The browser host was in Tokyo, Japan. Every idle
case used a new document containing the 50-byte initial source, and every
browser context reported `visible`, connected, and `Synced` for the complete
run.

The one-browser baseline ran from 08:31:45 to 09:01:45 UTC. The matching
post-fix run ran from 09:03:59 to 09:33:59 UTC:

| Measurement               | Pre-fix      | Post-fix   | Change        |
| ------------------------- | ------------ | ---------- | ------------- |
| Billed active time        | 1,815.762 s  | 6.086 s    | 99.6648% less |
| Duration                  | 232.418 GB-s | 0.779 GB-s | 99.6648% less |
| Maximum connected sockets | 1            | 1          | unchanged     |
| Connection transitions    | 0            | 0          | unchanged     |

The post-fix result is below the 90-second investigation threshold and exceeds
the required 95% reduction. Its minute series consists of short awareness
handler executions rather than continuous 60-second residency. The Object had
no analytics rows after its last socket closed, confirming that duration
stopped accumulating.

Two ten-minute scaling controls also remained hibernateable:

| Workload                             | Objects | Active time |
| ------------------------------------ | ------- | ----------- |
| Two browsers on one document         | 1       | 2.605 s     |
| One browser on each of two documents | 2       | 3.757 s     |

The second case approximately doubles per-message Object and D1 work without
reintroducing wall-clock residency. The same-document case increases message
volume while retaining one Object and one cold-load cadence.

Latency was measured between two independent browser contexts. Each document
had 30 warm samples and 20 cold samples. A temporary staging-only constructor
marker confirmed a distinct Object instance with both socket attachments
restored for every one of the 40 cold samples. The marker was never committed
and the exact `e3cfc17` build was redeployed afterward.

| Document                   | Warm median | Warm p95 | Cold median | Cold p95 | Worst cold |
| -------------------------- | ----------- | -------- | ----------- | -------- | ---------- |
| Initial source (50 B)      | 26 ms       | 34 ms    | 74 ms       | 78 ms    | 80 ms      |
| Generated source (150 KiB) | 25 ms       | 33 ms    | 186 ms      | 434 ms   | 437 ms     |

Both cases passed the latency gates, converged exactly, and had no false
`Offline` or reconnect transition. Across both latency windows, analytics
reported 175 D1 rows read and the constructor marker recorded 40 cold room
loads; this total also includes document setup and persistence queries.

The staging functional checks produced these results:

- idle and simultaneous cold-wake edits converged exactly;
- a newly joining collaborator received complete presence in 912 ms;
- a disconnected collaborator disappeared from presence in 85 ms;
- document JSON and plain-source export returned current source across a wake;
- the last-client flush advanced persistence revision from 4 to 5, and it
  remained 5 after the debounce window; and
- the final exact-build smoke test passed with 35 ms warm p95, 94 ms cold p95,
  exact convergence, and no connection-state transitions.

Cloudflare's invocation aggregate reported `errors` in WebSocket connection
setup buckets, including one for the pre-fix one-browser baseline. The count
scaled with connection setup, while every captured constructor event had an
`ok` outcome and no exception, and every browser check passed. The results
therefore show no runtime error attributable to hibernation.

All pre-deployment checks passed: formatting, lint, type checking, 67 unit
tests, 17 Worker tests, and the production browser build. Staging finished on
the exact committed `e3cfc17b4285afe0fb0c9f329ddc1b8d34540288` build. No
production traffic or deployment was used for these measurements.

## Effect on the Node target

Steps 1, 2, and 4 change only `server/src/worker/room.ts` and its tests, which
the Node target never runs. The local server uses y-websocket's
`setupWSConnection` in `server/src/collaboration/rooms.ts` with its own
`Awareness` instance, awareness interval, and 30-second server ping; none of
that needs to change, because a self-hosted process has no duration billing.
Step 3 may add a cancel hook to the shared
`server/src/collaboration/room-binding.ts`; the Node wrappers in `rooms.ts`
would keep their current behavior.

The optional step 5 is client code and therefore reaches both targets. To
either server a hidden tab disconnecting looks exactly like the user closing
the tab, a path both already handle: y-websocket persists the room through
`writeState` and drops it when the last connection closes, and `CollabRoom`
flushes through `persistRoom` in `handleClose`. The next connection rebuilds
the room from SQLite or D1. Two visible effects would apply to both targets
equally: a hidden tab's collaborator leaves the presence list until the tab
returns, and the sync indicator shows "Connecting…" briefly when it does. Yjs
merges any changes made in the meantime. On Node, document GETs fall back from
the closed in-memory room to the persisted text, which was flushed just before
the room closed.

Smaller notes:

- The Worker API's `liveSource` in `server/src/worker/index.ts` wakes the Object
  and reloads from D1 on every document GET. Once the room is hibernateable this
  costs only the D1 load and request execution, not idle duration, so it can
  stay as a later improvement.
- The Workers Paid plan (5 USD per month) includes 400,000 GB-s per month, which
  covers one Object running nonstop for a month. It is a fallback, but the code
  changes above are worth doing regardless.
- Until the fix ships, closing open production tabs stops the drain immediately.
