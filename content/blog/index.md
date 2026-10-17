<!--
  Blog index. One "## Title" per post (newest date first), then:
    date    YYYY-MM-DD
    tags    comma separated
    file    markdown file next to this one (default: <slug>.md), or "-" to inline the summary
    draft   any value shows a DRAFT badge
  Summary text under the fields is also searched by the filter box.
  Link to a post from anywhere with  [text](#/blog/<slug>)
-->

## How Android Binder actually works
- date: 2026-10-14
- tags: android, binder, ipc, kernel, reversing
- file: binder-internals.md

The one subsystem you have to understand before any Android internals work makes sense. A bottom-up tour of Binder — from the `ioctl` on `/dev/binder` up to `onTransact` — written from the debugger's seat.
