<!--
  CVEs window. Text before the first "## " is shown above the table.
  One "## CVE-ID" per entry, then optional fields:
    severity  critical / high / medium / low   (or give cvss: 9.8 and it is derived)
    cvss, target, product, type, cwe, affected, fixed, date, status, credit
    advisory, nvd, writeup, poc, patch   (URLs -> buttons)
  The text under the fields is markdown (shown when the row is expanded).
-->

Vulnerabilities I found and reported through coordinated disclosure, with CVEs assigned and fixes shipped. All three are in [cpp-httplib](https://github.com/yhirose/cpp-httplib), a widely used header-only C++ HTTP/HTTPS library — click any row for the details.

## CVE-2026-32627
- severity: high
- cvss: 8.7  (CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:N)
- target: cpp-httplib
- type: TLS certificate verification bypass
- cwe: CWE-295 Improper Certificate Validation
- affected: <= 0.37.1
- fixed: 0.37.2
- date: 2026-03-13
- status: Fixed
- credit: Pratham (0x3xploit)
- advisory: https://github.com/yhirose/cpp-httplib/security/advisories/GHSA-c3h8-fqq4-xm4g
- nvd: https://nvd.nist.gov/vuln/detail/CVE-2026-32627

When a client is configured with a proxy **and** `set_follow_location(true)`, any HTTPS redirect it follows gets TLS certificate and hostname verification **silently disabled** on the new connection. The client accepts any certificate the redirect target presents — expired, self-signed or forged — with no error and no notification.

A network attacker who can return a `3xx` redirect can fully intercept the follow-up HTTPS request, including any credentials or session tokens in flight. The bug lives in `ClientImpl::create_redirect_client()`: the redirect client is built without copying over the TLS verification settings from the parent client, so it falls back to "verify nothing".

## CVE-2026-31870
- severity: high
- cvss: 7.5  (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
- target: cpp-httplib
- type: Denial of service (uncaught exception)
- cwe: CWE-248 Uncaught Exception
- affected: <= 0.37.0
- fixed: 0.37.1
- date: 2026-03-10
- status: Fixed
- credit: Pratham (0x3xploit)
- advisory: https://github.com/yhirose/cpp-httplib/security/advisories/GHSA-39q5-hh6x-jpxx
- nvd: https://nvd.nist.gov/vuln/detail/CVE-2026-31870

The streaming client API (`Get`, `Post`, …) calls `std::stoull()` straight on the `Content-Length` response header with no validation and no exception handling.

`std::stoull` throws `std::invalid_argument` on a non-numeric string and `std::out_of_range` on a value past `ULLONG_MAX`. Nothing catches either, so the runtime calls `std::terminate()` and the process dies with `SIGABRT`. Any server the client talks to — directly, through a redirect, or from a MITM position — can crash the client with a single response header. No auth, no interaction, deterministic.

## CVE-2026-28434
- severity: medium
- cvss: 5.3  (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- target: cpp-httplib
- type: Information disclosure
- cwe: CWE-209 Error Message Information Exposure
- affected: <= 0.34.0
- fixed: 0.35.0
- date: 2026-03-02
- status: Fixed
- credit: Pratham (0x3xploit)
- advisory: https://github.com/yhirose/cpp-httplib/security/advisories/GHSA-8mpw-r4gc-xm7q
- nvd: https://nvd.nist.gov/vuln/detail/CVE-2026-28434

When a request handler throws a C++ exception and the application hasn't registered a custom handler via `set_exception_handler()`, the library writes the exception message straight into the response as a header named `EXCEPTION_WHAT` — sent to whoever made the request, no auth, no opt-in.

The behaviour is on by default, so a developer who never learns to call `set_exception_handler()` ships a server that leaks internal exception text (paths, state, sometimes stack detail) to any client that can make a handler throw.
