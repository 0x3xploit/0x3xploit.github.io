When I started pulling Android apps apart, Binder was the wall I kept hitting. You open a service in jadx, you see `onTransact(code=7, ...)`, and you have no idea where that 7 came from or who is on the other end. Every "how Binder works" article I found stopped at the same cartoon — a client box, a server box, and an arrow labelled "Binder" in the middle. That arrow is the entire thing I wanted to understand.

So this is the writeup I wish I'd had: Binder from the bottom up, in the order it actually made sense to me, which was more or less the order the bytes travel.

## Why it exists at all

Android processes are isolated. Each app is its own Linux process with its own UID, and the whole security model leans on that. But an app is useless on its own — it needs the location service, the clipboard, the package manager, SurfaceFlinger, the telephony stack. All of those live in *other* processes. So basically everything interesting on Android is one process asking another process to do something on its behalf. That's IPC, and on Android that IPC is almost always Binder.

The obvious question is: why not just use pipes, sockets, or shared memory like everyone else? A few reasons that actually matter once you've worked with it:

- **One copy, not two.** A normal socket round-trip copies your data user→kernel→user. Binder maps a chunk of the target's address space into the kernel once, so a transaction is a single copy. At the volume of IPC Android does, that adds up.
- **The kernel vouches for the caller.** This is the big one. When you receive a Binder call, the kernel hands you the sender's real PID and UID. The caller cannot lie about who they are. Half of Android's permission checks are built on exactly this fact.
- **It carries object references, not just bytes.** You can put a reference to one of *your* objects into a transaction, and the other process receives a handle it can call back into. Try doing that cleanly over a raw socket.

Keep that second point in your head. If you only remember one thing about Binder security, it's that `getCallingUid()` is not spoofable, because the number comes from the kernel and not from the message.

## The actual interface: one device, one ioctl

Strip away every framework layer and Binder is a character device: `/dev/binder` (plus `/dev/hwbinder` and `/dev/vndbinder` on newer devices — same driver, separate contexts). A process gets in by doing basically three things:

```c
int fd = open("/dev/binder", O_RDWR | O_CLOEXEC);

struct binder_version v;
ioctl(fd, BINDER_VERSION, &v);          // sanity-check the protocol

// one big read buffer the kernel will copy incoming transactions into
void *buf = mmap(NULL, 1 * 1024 * 1024 - 8192,
                 PROT_READ, MAP_PRIVATE, fd, 0);
```

That `mmap` is the "single copy" trick. You don't read() transactions; the driver copies an incoming transaction straight into this mapping and just tells you the offset. Your side only ever reads from it.

After setup, *all* the real work happens through exactly one ioctl:

```c
ioctl(fd, BINDER_WRITE_READ, &bwr);
```

Everything — sending a call, getting the reply, receiving a call, replying to it, managing refcounts — is `BINDER_WRITE_READ`. The struct is deceptively small:

```c
struct binder_write_read {
    binder_size_t write_size;     // bytes of commands to send
    binder_size_t write_consumed;
    binder_uintptr_t write_buffer; // pointer to a stream of BC_* commands
    binder_size_t read_size;      // space for incoming BR_* commands
    binder_size_t read_consumed;
    binder_uintptr_t read_buffer;
};
```

`write_buffer` and `read_buffer` are each a little command stream. The commands you *send* are the `BC_` ("binder command") opcodes; the ones you *receive* are the `BR_` ("binder return") opcodes. So one trip into the kernel can say "here are the commands I'm issuing, and by the way give me anything waiting for me." Reversing a native service really comes down to reading these two streams.

## Transactions, and the opcodes that matter

The opcode you care about 95% of the time is `BC_TRANSACTION` going down, and `BR_TRANSACTION` / `BR_REPLY` coming back. The payload is `binder_transaction_data`:

```c
struct binder_transaction_data {
    union { size_t handle; void *ptr; } target;  // who you're calling
    void     *cookie;
    __u32     code;        // <-- the method number. this is your onTransact code
    __u32     flags;       // TF_ONE_WAY lives here
    pid_t     sender_pid;  // the kernel fills these two in for the receiver.
    uid_t     sender_euid; // you cannot set them yourself.
    binder_size_t data_size;
    binder_size_t offsets_size;
    struct { binder_uintptr_t buffer; binder_uintptr_t offsets; } data;
};
```

Two fields are worth staring at.

`code` is that mysterious `7` from `onTransact`. It's just a method index. AIDL assigns them in declaration order starting at `FIRST_CALL_TRANSACTION = 0x1` (which is `android.os.IBinder.FIRST_CALL_TRANSACTION`, = 1). So when I'm reversing and I see transaction code `3`, I go count down the `.aidl` (or the generated `Stub`) to the third method, and that's what's being called. There's a whole range of magic codes below that too — `INTERFACE_TRANSACTION` (`0x5f4e5446`, ASCII `_NTF`) is the one that asks "what interface do you implement?", which is how `dumpsys` enumerates services.

`sender_pid` / `sender_euid` are filled in **by the driver**, on the receiving side. Your process never writes them. This is the mechanism behind the unspoofable-caller property — it's not a convention, it's the kernel copying `task->cred` at transaction time.

## Nodes, handles, and the one magic number

Here's the part that took me longest. A Binder object has two identities depending on which side you're on:

- In the process that **owns** it, it's a **node** (a kernel `binder_node`, pointing at your in-process object).
- In every **other** process, it's a **handle** — just an integer the driver hands out.

When you put an object into a transaction, you don't put a pointer (that'd be meaningless across address spaces). You put a `flat_binder_object` with type `BINDER_TYPE_BINDER` (I own this) or `BINDER_TYPE_HANDLE` (I'm passing on a handle). The `offsets` array in the transaction tells the driver where these live in the buffer, and as the transaction crosses the boundary the driver **translates** them: your `BINDER_TYPE_BINDER` becomes a `BINDER_TYPE_HANDLE` on the other side, allocating a handle and wiring it back to your node. That translation step is the magic that makes "passing an object reference" work.

And then there's **handle 0**. Handle 0 is, by convention baked into everything, the **ServiceManager** — the context manager, the one process that registered itself with `BINDER_SET_CONTEXT_MGR`. It's the bootstrap. You know handle 0 is the ServiceManager the same way you know PID 1 is init: because the system is built so that it is.

## Climbing back up to the framework

Nobody hand-rolls `binder_transaction_data`. The native runtime wraps all of it:

- **`ProcessState`** — one per process. Opens `/dev/binder`, does the `mmap`, owns the fd.
- **`IPCThreadState`** — one per thread. Owns the read/write command streams and the actual `talkWithDriver()` loop that calls `ioctl`. When you hear "the binder thread pool," this is the thing looping; the driver tells a process to grow the pool with `BR_SPAWN_LOOPER`.
- **`BpBinder`** (proxy, the "p" is for proxy) holds a handle and is your local stand-in for a remote object. `BBinder` is the base you subclass on the server to receive calls.
- **`Parcel`** is the serialization buffer — `writeInt32`, `writeString16`, `writeStrongBinder` (that last one is what emits a `flat_binder_object`).

The whole client call collapses to one virtual call:

```cpp
// client side, roughly
Parcel data, reply;
data.writeInterfaceToken(descriptor);   // the "is this the right interface" tag
data.writeInt32(42);
remote()->transact(SOME_CODE, data, &reply, 0 /* or TF_ONE_WAY */);
int result = reply.readInt32();
```

`transact()` marshals the Parcel into a `BC_TRANSACTION`, blocks in `ioctl` until `BR_REPLY` comes back (unless it's one-way), and unmarshals `reply`. On the server, the driver delivers a `BR_TRANSACTION`, the thread pool picks it up, and it lands in:

```java
// server side — this is the method you keep seeing in jadx
protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) {
    switch (code) {
        case TRANSACTION_doThing:               // some generated constant
            data.enforceInterface(DESCRIPTOR);  // reject wrong-interface callers
            int arg = data.readInt32();
            int res = doThing(arg);             // the real implementation
            reply.writeNoException();
            reply.writeInt32(res);
            return true;
    }
    return super.onTransact(code, data, reply, flags);
}
```

AIDL just generates the `Stub`/`Proxy` pair around this so you get `doThing(int)` in Java and never see the `code`. But when you're reversing, you *do* see the code, and now you know it's the index into that switch.

One flag worth calling out: `TF_ONE_WAY`. A `oneway` call returns immediately and gets no reply — fire and forget. It matters for security because a oneway call can't block the caller, but it also means the sender doesn't find out if you rejected it. I've seen bugs on both sides of that.

## Where this pays off when you're reversing

Once the model clicks, a bunch of techniques stop being magic:

- **`service list` / `dumpsys`** enumerate exactly the things registered with ServiceManager (handle 0). That's your attack-surface map — every system service reachable over Binder.
- **Transaction codes line up with AIDL.** Find the `.aidl` (or the `Stub` constants), count the methods, and `code=N` tells you the method without guessing.
- **Frida on `IPCThreadState::transact`** (native) or on the generated `Stub` dispatch (Java) lets you watch and rewrite real traffic between apps and services. Hooking `onTransact` on a target service shows you every call reaching it, with the raw Parcel.
- **`/sys/kernel/debug/binder/`** (`transactions`, `stats`, `failed_transactions`) is the driver telling you what's actually crossing the boundary, including the pid/uid pairs.
- **The security questions get concrete.** "Can I reach this service from an unprivileged app?" becomes "is it registered, does `onTransact` enforce the interface, and what does it do with `Binder.getCallingUid()` before it trusts me?" A service that forgets that last check is where a lot of local privilege-escalation bugs live.

That's the whole pipeline: `ioctl(BINDER_WRITE_READ)` on `/dev/binder`, a `binder_transaction_data` with a target handle and a method `code`, the driver translating objects and stamping the caller's real uid, and the framework dressing all of it up as a plain method call. The cartoon arrow was hiding a surprisingly elegant little protocol.

If you want to actually feel it, write the ~30 lines of C that open `/dev/binder`, do the `mmap`, and send a single `BC_TRANSACTION` to handle 0 asking the ServiceManager to look up a service by name. Watching the `BR_REPLY` come back with a handle you can then call into is the moment it stops being a diagram.
