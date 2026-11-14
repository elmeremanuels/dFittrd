# Test specification: proof that the D19 face route stores nothing

Status: specification only, 14 November 2026. The route does not exist; nothing here has been run.
For the engineers who build the route (owner of `apps/api`). Decision D19 requires "a test that proves
nothing is stored" before the route ships.

## 1. The claim under test

The prompt says (variant B, claims C7, C8, C10, C21, C23, C24, C25 in `avatar-consent-copy.md`): "It is
deleted right after. We do not keep it." "Only your head and neck. Never your body." "That did not work.
Your photo was deleted." "This takes at most [60] seconds. Then the photo and the shape are gone for
good." "We show you the photo first. It is sent only when you press Send." The draft terms say the same
in clauses T4.2 to T4.5, T4.7, T4.9, T4.10 and T7.1, with the limits stated in T4.11.

One requirement (NS-15) is not about the face route. It guards claim C29 and clause T5.4 ("See it on
me" always shows the standard face), because a face leaking into that upload would falsify the on-device
promise as well.

The test suite must make those sentences true or fail. If a requirement below cannot be met, the copy
changes before the flag is switched on; the requirement is not dropped quietly.

## 2. Method: canary images

Every test uploads a **canary**: a valid head-and-neck image that carries three independent markers.

- **Byte marker:** a random 32-byte sequence in the encoded file (for example in a metadata segment),
  new for every test run.
- **Pixel marker:** a block of pixels with a fixed, improbable pattern, so the decoded bitmap contains a
  known byte run even after the encoded file is gone.
- **Derived marker:** the test build of the processor writes a known value into its intermediate result
  (landmarks or texture) when it sees the pixel marker, so derived data can be searched for too.

"No trace" below means: none of the three markers, in raw, base64 or hex form, is found.

## 3. Requirements

Each requirement names what the test must show. NS = nothing stored.

| Id | The test must show | How |
|---|---|---|
| NS-1 No disk writes | During and after a request, the API process and its children write no file that contains a marker, and create no file at all (the allowlist is empty: logs go to standard output, not to a file) | Run the API in a container with a read-only root file system and no writable temp directory or volume; the request must still succeed. In addition trace file-opening system calls (strace or eBPF) for the request and assert the allowlist. After the request, search every mounted volume for the markers |
| NS-2 No database or queue row | No table, cache, queue or object store gains a row or key that contains a marker or any binary value over 1 KB | Snapshot row counts and sizes before and after; search a database dump for the markers |
| NS-3 No image bytes in logs | Application logs, access logs (API and the Caddy proxy), error traces, metrics, and any tracing, error-reporting or performance-monitoring (APM) payload contain no marker, no request body, no response body (the returned face picture, head shape and colour) and no base64 run longer than 64 characters | Capture all log streams at the most verbose level, and every payload the observability clients would send (pointed at a local collector), including for a request that throws inside the processor; search them. Assert the logger's serializer drops `body` for this route in both directions |
| NS-4 Technical record only | The only thing persisted is the record of T4.7, with exactly four fields: time, byte size, outcome, duration. No hash of the image, no thumbnail, no pixel dimensions (not even width and height), no device number, no IP address | Assert the exact set of fields written; the test fails on any extra field |
| NS-5 Memory released and overwritten | After the response is sent, the buffers that held the upload, the decoded bitmap and every intermediate result have been overwritten with zeros and released | The route owns its buffers explicitly (no strings, no base64 text). A test hook lists the buffers the route allocated; the test asserts each is zero-filled after the response. Then take a heap snapshot (and, for a native or Python worker, a process memory dump) and search it for the markers |
| NS-6 Response, then delete, in that order and always | Deletion runs after the response is flushed, and also when processing throws, the client disconnects mid-upload, or the time limit ([60] s) is hit | Four cases: success, processor error, client abort, timeout. In each, NS-1, NS-3 and NS-5 hold, and the timeout case shows deletion at the limit without waiting for the processor |
| NS-7 No copy leaves the server | While the request is handled, the process opens no outbound connection except to the configured processor | Run with outbound network blocked except the allowlist; the request succeeds. If a rented GPU provider is used, see section 5 |
| NS-8 Head and neck only | The route refuses anything that is not a head-and-neck crop: larger than [MAX] bytes or [MAX] pixels, more than one image, video, or an image where the detected face fills less than [X]% of the frame or where a body is detected | Upload a full-body canary, a video, an oversized file and two images; each is refused with an error, and NS-1, NS-3, NS-5 hold for the refused upload too |
| NS-9 No caching on the way back | The response carries `Cache-Control: no-store`; the embed's service worker and HTTP cache hold neither the request nor the response | Header assertion; a browser test lists Cache Storage and finds no entry |
| NS-10 Nothing after a crash | A crash during processing leaves no core dump and no crash report containing image bytes | Kill the process mid-request with a fatal signal; assert no core file (core size limit 0) and no marker in any crash output. Error reporting tools, if any are added, must be shown not to attach request bodies |
| NS-11 Proxy does not buffer to disk | The Caddy proxy passes the body through without writing it to disk and without an access log line for this route | Assert the deployed Caddy configuration (no request-body buffering to file, access log off for the route) and search the proxy container's file system for the markers |
| NS-12 Consent gate and preview | The route refuses a request that does not carry the consent marker, and the embed sends nothing before the shopper has pressed the yes button **and then Send on the preview of the cropped photo** (T4.10, claim C25). Closing the preview sends nothing | API test for the refusal; browser test that records all network traffic and finds no request to the route after the yes tap, after the photo is chosen, or after the preview is closed, and exactly one after Send. The preview shows the same bytes that are uploaded (compare a hash in the test build). This is not proof of consent, only that the code path cannot run without it |
| NS-13 Abuse limits hold no image data | Rate limiting keys on IP address only (T4.7: not the device number), in memory, with a time limit; the route neither reads nor records the device number or session | Field assertion; marker search of the limiter's store; a request with and without a device token is handled and recorded identically |
| NS-14 Static guard | The route's source files do not import file-system, database, queue or outbound HTTP modules, and `PersonInput.kind` still has no `'userPhoto'` member | A lint rule or CI script, like the existing bundle-secret check |
| NS-15 See it on me has the standard face | With Use my face on and a face shown on screen (both variants), the hero upload contains no photo, face picture or face texture; only the skin fill differs from the neutral figure (T5.4, claim C29, D20.1) | Extend the existing hero allowlist test: build the hero input with a face tile set and assert no `<image>`, no blob or data href, no face texture, and that the only difference from the neutral build is the allowed skin colour value. Runs in the web test suite, not in the route's suite |
| NS-16 Encrypted transport only | The route answers only over HTTPS; a plain-HTTP request is refused or redirected before any body is read, and the embed never builds a plain-HTTP address for it (T4.3) | Deploy-time check against the production host and the Caddy configuration; unit test on the embed's URL builder |
| NS-17 No template, no matching | The processor produces only the outputs in T4.6 (face picture, head shape, skin colour). It computes no face embedding or identity vector, loads no face-recognition model, and has no code path that compares two faces or looks a face up (T4.9) | Assert the exact set of output fields; a CI check on the list of model files and packages in the container image against an allowlist (no recognition or embedding model); NS-14's import guard. The derived marker of section 2 must not appear in anything but those outputs |

## 4. Where the tests run

- NS-1 to NS-8, NS-10, NS-12 to NS-14 and NS-17 run in CI on every change to the route, against the same container
  image that is deployed.
- NS-9 runs in the Playwright privacy suite next to the existing "no image leaves the page" test. That
  existing test needs a new, explicit exception for this one route in variant B builds, and must keep
  failing for every other route and for variant A builds.
- NS-15 runs in the web package's test suite on every change to the hero input or the avatar view.
- NS-11, NS-16 and the swap setting (section 5) are checked against the production host by a deploy-time
  script, because CI does not see the real proxy.
- The per-shop `face` flag cannot be switched on for a build whose nothing-stored suite did not pass.
  The build records the suite result; the flag endpoint checks it.

## 5. What these tests cannot prove (tell counsel, and do not let the copy outrun it)

- **Runtime copies.** A garbage-collected runtime (Node, Python) can copy data while moving objects, and
  the network and encryption layers hold the encrypted and decrypted bytes in buffers the route does not
  own. NS-5 proves our own buffers are zeroed and that a memory search finds no marker afterwards; it
  does not prove that no stale copy ever existed for some milliseconds. Keep image bytes out of strings,
  and prefer one native worker process per request that exits afterwards, so the operating system
  reclaims its memory.
- **Swap and hibernation.** Memory can be written to disk by the operating system. The host must run
  with swap off or encrypted. This is a host setting, checked at deploy time, not a unit test.
- **The hosting provider.** A virtual machine can be snapshotted or moved by the provider. That is
  covered by contract, not by a test.
- **A rented GPU provider (decision D16).** If the processor runs there, none of NS-1 to NS-11 covers
  it. Either the same suite runs inside the provider's container image and the contract forbids logging
  and retention, or the face step runs on our own machine. Until one of those is true, the prompt may
  not say "We do not keep it".
- **The shopper's own device.** The browser may keep the picked photo in its own places (camera roll,
  file picker history). The copy does not promise otherwise.
- **People.** A test cannot prove that nobody adds a debug dump later. NS-14 and code review are the
  guard.

So the honest wording of the proof is: "tested on every release to leave no copy on disk, in logs, in
the database or in memory after the answer is returned", not "impossible to recover". Clause T4.11 of
the draft terms now says exactly this, and the prompt's "We do not keep it" is defined by it. The copy
file marks the variant B lines as conditional on the provider question; if Naomi finds the short
sentence too strong even so, the fallback line "It is deleted right after." (C7 B-alt) replaces it.

## 6. Not in scope

Quality of the face result, the consent wording itself, the on-device variant (covered by the existing
privacy e2e), and the legal question of whether a momentary copy counts as collection (counsel brief,
question 10).
