---
layout: post
title: "Reverse Engineering a Custom Obfuscated Protocol: A Practical Walkthrough"
date: 2026-04-28
category: "Reverse Engineering"
tags: [reverse-engineering, ghidra, x64dbg, protocol, obfuscation, wireshark]
read_time: 25
excerpt: "A complete reverse engineering walkthrough of a binary with a custom obfuscated network protocol. Covers static analysis with Ghidra, dynamic tracing with x64dbg, and protocol reconstruction from first principles."
---

## Introduction

This article documents a full reverse engineering session against a compiled binary that communicates over a proprietary, obfuscated protocol. No source code, no symbols, no documentation — just a binary and a packet capture.

The workflow mirrors real-world scenarios: malware analysis, license enforcement research, or interoperability engineering. We'll go from zero context to a fully reconstructed protocol spec.

> **Note:** All analysis here is performed on a custom binary created for this walkthrough. No real product or malware is referenced.

---

## Background

### What We Have

- `client.exe` — a 64-bit PE compiled with MSVC, stripped symbols
- `traffic.pcap` — 30 minutes of recorded network traffic between client and server
- A running server at `127.0.0.1:9999` on the test VM

### Toolchain

| Tool | Purpose |
|------|---------|
| **Ghidra** | Static disassembly + decompilation |
| **x64dbg** | Dynamic analysis, breakpoints, memory inspection |
| **Wireshark** | Protocol-level traffic analysis |
| **CyberChef** | In-browser crypto/encoding transforms |
| **Python + scapy** | Traffic replay and protocol fuzzing |

### Initial Questions

Before touching any tool, ask:

1. What transport is used? (TCP/UDP/QUIC)
2. Is traffic encrypted? Compressed?
3. What does the packet structure look like at a glance?
4. Are there patterns? Magic bytes? Length fields?

---

## Phase 1 — Traffic Analysis

### Opening the PCAP

Load `traffic.pcap` in Wireshark. Filter for the server IP:

```
ip.addr == 127.0.0.1 && tcp.port == 9999
```

**Immediate observations:**

- TCP. Three-way handshake, then sustained bidirectional traffic.
- Packets range from 16 to 512 bytes.
- No TLS handshake visible — either plaintext or custom crypto.

### Identifying Structure

Follow a TCP stream (`Right-click → Follow → TCP Stream`). Switch to **Hex dump** view.

First client→server packet:
```
00000000  de ad be ef 00 00 00 1c  01 00 00 00 48 65 6c 6c  |........ ....Hell|
00000010  6f 20 73 65 72 76 65 72  21 00 00 00              |o server!...|
```

First server→client response:
```
00000000  de ad be ef 00 00 00 08  02 00 00 00              |........ ....|
```

**Observations:**
- Magic bytes `DE AD BE EF` at offset 0 — consistent across all packets
- Bytes 4–7: little-endian DWORD — appears to be payload length (`0x1c = 28`, and 28 bytes follow the header)
- Byte 8: appears to be a **message type** or **opcode** (`01` = request, `02` = response?)
- Bytes 9–11: possibly a sequence number or flags

Tentative header struct:

```c
typedef struct {
    DWORD magic;      // 0xEFBEADDE (stored little-endian as DE AD BE EF)
    DWORD length;     // payload size in bytes
    BYTE  opcode;     // message type
    BYTE  flags;      // unused?
    WORD  sequence;   // request/response correlation
} ProtoHeader;        // total: 12 bytes
```

---

## Phase 2 — Static Analysis with Ghidra

### Loading the Binary

1. Open Ghidra, create a new project, import `client.exe`
2. Let the auto-analysis run (default options are fine)
3. Open the Code Browser

### Finding the Network Code

Search for strings related to networking:

- `Search → For Strings` → filter for `"9999"`, `"socket"`, `"connect"`
- Cross-reference from string usage to find the connection setup code

Or search for `WSAStartup` / `connect` imports in the Symbol Tree (`Imports → ws2_32.dll`).

Double-click `connect` → press **X** (cross references) → shows all call sites.

One call site stands out — it's in a function `FUN_140003a80` called from `main`.

### Analyzing the Send Function

Following call chains from the connect site, we find a function I'll rename `proto_send`:

```c
// Ghidra decompilation (cleaned up)
int proto_send(SOCKET sock, int opcode, void *data, size_t data_len) {
    ProtoHeader hdr;
    hdr.magic    = 0xEFBEADDE;
    hdr.length   = (DWORD)data_len;
    hdr.opcode   = (BYTE)opcode;
    hdr.flags    = 0;
    hdr.sequence = (WORD)InterlockedIncrement(&g_seq_counter);

    send(sock, (char *)&hdr, sizeof(hdr), 0);

    if (data_len > 0) {
        // XOR encode the payload before sending
        char *encoded = (char *)malloc(data_len);
        for (size_t i = 0; i < data_len; i++) {
            encoded[i] = ((char *)data)[i] ^ g_xor_key[i % 16];
        }
        send(sock, encoded, (int)data_len, 0);
        free(encoded);
    }
    return 0;
}
```

The payload is **XOR-encoded** with a 16-byte repeating key. Now we need the key.

### Finding the XOR Key

`g_xor_key` is a global variable. In Ghidra, click it to navigate to the data section:

```
                    g_xor_key
00140012340  db  0x41 0x42 0x43 0x44  0x45 0x46 0x47 0x48
             db  0x49 0x4a 0x4b 0x4c  0x4d 0x4e 0x4f 0x50
```

The key is `ABCDEFGHIJKLMNOP`. Simple, but it confirms the obfuscation.

---

## Phase 3 — Dynamic Analysis with x64dbg

Static analysis gave us the structure. Dynamic analysis confirms it and helps with unknowns.

### Setup

1. Open `client.exe` in x64dbg
2. Set a breakpoint on `ws2_32.send` (in the Symbols pane, search for `send`)
3. Run the binary and connect it to the test server

### Inspecting the Call Stack on send()

When the breakpoint hits:
- `RCX` (1st arg): socket handle
- `RDX` (2nd arg): pointer to buffer — dump this in the memory view
- `R8D` (3rd arg): buffer length

The memory dump shows our header exactly as predicted: `DE AD BE EF ...`.

### Patching to Log All Messages

Instead of manually hitting breakpoints, use x64dbg's conditional logging:

```
// Breakpoint condition: always
// Log format: "SEND {r8:d} bytes: {[rdx]:b}"
```

This dumps every send call to the log window, giving us a complete trace of the protocol session.

### Identifying Opcode Meanings

By correlating logged packets with observable behavior (connecting, sending a message, receiving a response), we map the opcodes:

| Opcode | Direction | Meaning |
|--------|-----------|---------|
| `0x01` | C→S | `HELLO` — initial handshake |
| `0x02` | S→C | `HELLO_ACK` — server acknowledges |
| `0x10` | C→S | `MSG_SEND` — send a message |
| `0x11` | S→C | `MSG_ACK` — message acknowledged |
| `0x20` | C→S | `HEARTBEAT` — keepalive |
| `0x21` | S→C | `HEARTBEAT_ACK` |
| `0xFF` | Both | `ERROR` — error response |

---

## Phase 4 — Protocol Reconstruction

### Full Packet Structure

```
Byte  0–3:   Magic (0xEFBEADDE)
Byte  4–7:   Payload length (little-endian uint32)
Byte  8:     Opcode
Byte  9:     Flags (0x00 = none, 0x01 = compressed)
Byte 10–11:  Sequence number (uint16, little-endian)
Byte 12+:    Payload (XOR-encoded, key = "ABCDEFGHIJKLMNOP")
```

### MSG_SEND Payload (Opcode 0x10)

Further analysis reveals the `MSG_SEND` payload structure:

```c
typedef struct {
    WORD  recipient_len;
    char  recipient[];      // variable, UTF-8
    WORD  content_len;
    char  content[];        // variable, UTF-8
} MsgSendPayload;
```

### Writing a Python Client

With the full spec, we can write an independent client:

```python
import socket
import struct

XOR_KEY = b"ABCDEFGHIJKLMNOP"
MAGIC   = 0xEFBEADDE

def xor_encode(data: bytes) -> bytes:
    return bytes(b ^ XOR_KEY[i % 16] for i, b in enumerate(data))

def make_packet(opcode: int, payload: bytes, seq: int = 0) -> bytes:
    encoded = xor_encode(payload)
    header  = struct.pack("<IBBH", MAGIC, len(encoded), opcode, 0, seq)
    return header + encoded

def send_hello(sock: socket.socket) -> None:
    pkt = make_packet(0x01, b"hello", seq=1)
    sock.sendall(pkt)
    resp = sock.recv(1024)
    magic, length, opcode, flags, seq = struct.unpack("<IBBH", resp[:10])
    print(f"[+] Server responded with opcode 0x{opcode:02x}")

def send_message(sock: socket.socket, recipient: str, content: str, seq: int) -> None:
    rec = recipient.encode()
    msg = content.encode()
    payload = struct.pack(">H", len(rec)) + rec + struct.pack(">H", len(msg)) + msg
    pkt = make_packet(0x10, payload, seq=seq)
    sock.sendall(pkt)

if __name__ == "__main__":
    with socket.create_connection(("127.0.0.1", 9999)) as s:
        send_hello(s)
        send_message(s, "admin", "Hello from Python!", seq=2)
        print("[+] Done")
```

---

## Conclusion

This walkthrough covered the full reverse engineering lifecycle:

1. **Traffic analysis** — identify structure from patterns in raw bytes
2. **Static analysis** — Ghidra decompilation to understand encoding logic
3. **Dynamic analysis** — x64dbg breakpoints to confirm and fill gaps
4. **Protocol reconstruction** — build a complete spec and independent implementation

The XOR obfuscation used here is trivially broken; real-world protocols use AES or ChaCha20. But the methodology is identical — find the crypto primitive, find the key material, reconstruct the spec.

Key skills developed:
- Recognizing magic bytes, length-prefixed fields, and opcode patterns in hex dumps
- Cross-referencing imports and strings to navigate stripped binaries
- Correlation between static decompilation output and runtime behavior
- Building a ground-truth client to validate your understanding

---

## See Also

- [Ghidra documentation](https://ghidra-sre.org/) — NSA's free reverse engineering suite
- [x64dbg](https://x64dbg.com/) — open-source Windows debugger
- [Wireshark](https://wireshark.org/) — protocol analysis
- [scapy](https://scapy.net/) — Python packet crafting library
- *The IDA Pro Book* (Eagle) — still relevant for learning binary analysis concepts
