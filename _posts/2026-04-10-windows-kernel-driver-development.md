---
layout: post
title: "Writing Your First Windows Kernel Driver"
date: 2026-04-10
category: "Kernel Research"
tags: [windows, kernel, driver, wdk, ioctl, c]
read_time: 22
excerpt: "A practical guide to writing a minimal Windows kernel driver from scratch — IOCTL communication, driver entry, memory allocation, and testing with OSR Driver Loader."
---

## Introduction

Writing kernel-mode code on Windows is a different world from userland programming. A crash doesn't just kill your process — it brings down the entire system (BSoD). But with the right setup and understanding, kernel development becomes one of the most rewarding areas of systems programming.

This guide walks through building a minimal working kernel driver: device creation, IOCTL handling, and communication from a userland application.

## Background

### What Is a Windows Kernel Driver?

A kernel driver is a `.sys` file that runs in **Ring 0** — the most privileged execution ring. It has direct access to:

- Physical memory
- Hardware registers and I/O ports
- Kernel data structures (`EPROCESS`, `ETHREAD`, `PTE`, etc.)
- The Windows kernel API (`Nt*`, `Ex*`, `Io*`, `Mm*`, `Ke*` functions)

Drivers are loaded and unloaded by the Windows I/O manager. They expose a **device object** that user programs interact with via standard `CreateFile`/`DeviceIoControl`/`ReadFile`/`WriteFile` calls.

### Driver Types

| Type | Description |
|------|-------------|
| **WDM** (Windows Driver Model) | Legacy, direct kernel API access |
| **KMDF** (Kernel-Mode Driver Framework) | Modern framework, reduces boilerplate |
| **WDF/UMDF** | User-mode driver framework (Ring 3) |
| **Filter drivers** | Stack on top of existing drivers |

We'll write a bare **WDM** driver to understand the fundamentals before using frameworks.

### Development Environment

You need:
1. **Windows SDK + WDK** (Windows Driver Kit) — from Microsoft
2. **Visual Studio 2022** with "Desktop development with C++" + WDK extension
3. **Test VM** — never test on your main machine; use a VM with kernel debugging enabled
4. **WinDbg** or **WinDbg Preview** for kernel debugging

Enable test signing on the VM:

```cmd
bcdedit /set testsigning on
bcdedit /debug on
bcdedit /dbgsettings net hostip:<your-ip> port:50000 key:1.2.3.4
```

## Walkthrough

### Driver Entry Point

Every driver starts with `DriverEntry` — the equivalent of `main()`:

```c
#include <ntddk.h>

DRIVER_UNLOAD DriverUnload;
DRIVER_DISPATCH DeviceControl;

// Forward declarations
VOID   DriverUnload(PDRIVER_OBJECT DriverObject);
NTSTATUS DeviceControl(PDEVICE_OBJECT DeviceObject, PIRP Irp);

// Device and symbolic link names
#define DEVICE_NAME     L"\\Device\\MyKD"
#define SYMLINK_NAME    L"\\DosDevices\\MyKD"

NTSTATUS DriverEntry(
    PDRIVER_OBJECT  DriverObject,
    PUNICODE_STRING RegistryPath
) {
    UNREFERENCED_PARAMETER(RegistryPath);

    NTSTATUS       status;
    PDEVICE_OBJECT deviceObject = NULL;
    UNICODE_STRING deviceName, symLinkName;

    RtlInitUnicodeString(&deviceName,  DEVICE_NAME);
    RtlInitUnicodeString(&symLinkName, SYMLINK_NAME);

    // Create the device object
    status = IoCreateDevice(
        DriverObject,
        0,                       // no device extension for now
        &deviceName,
        FILE_DEVICE_UNKNOWN,
        FILE_DEVICE_SECURE_OPEN,
        FALSE,
        &deviceObject
    );

    if (!NT_SUCCESS(status)) {
        KdPrint(("[-] IoCreateDevice failed: 0x%08X\n", status));
        return status;
    }

    // Create symbolic link accessible from userland
    status = IoCreateSymbolicLink(&symLinkName, &deviceName);
    if (!NT_SUCCESS(status)) {
        IoDeleteDevice(deviceObject);
        return status;
    }

    // Register dispatch routines
    DriverObject->DriverUnload                         = DriverUnload;
    DriverObject->MajorFunction[IRP_MJ_CREATE]        = DeviceControl;
    DriverObject->MajorFunction[IRP_MJ_CLOSE]         = DeviceControl;
    DriverObject->MajorFunction[IRP_MJ_DEVICE_CONTROL] = DeviceControl;

    KdPrint(("[+] Driver loaded successfully\n"));
    return STATUS_SUCCESS;
}
```

### Unload Routine

Always implement `DriverUnload` — it cleans up when the driver is unloaded:

```c
VOID DriverUnload(PDRIVER_OBJECT DriverObject) {
    UNICODE_STRING symLinkName;
    RtlInitUnicodeString(&symLinkName, SYMLINK_NAME);

    IoDeleteSymbolicLink(&symLinkName);
    IoDeleteDevice(DriverObject->DeviceObject);

    KdPrint(("[+] Driver unloaded\n"));
}
```

### IOCTL Handler

**I/O Control Codes (IOCTLs)** are how userland sends commands to the driver. Define IOCTL codes with the `CTL_CODE` macro:

```c
// In a shared header (used by both driver and userland app)
#define IOCTL_MYKD_HELLO  CTL_CODE(FILE_DEVICE_UNKNOWN, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_MYKD_PID    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)
```

The dispatch routine:

```c
NTSTATUS DeviceControl(PDEVICE_OBJECT DeviceObject, PIRP Irp) {
    UNREFERENCED_PARAMETER(DeviceObject);

    PIO_STACK_LOCATION stack = IoGetCurrentIrpStackLocation(Irp);
    NTSTATUS status = STATUS_SUCCESS;
    ULONG_PTR info  = 0;

    switch (stack->MajorFunction) {

    case IRP_MJ_CREATE:
    case IRP_MJ_CLOSE:
        break;

    case IRP_MJ_DEVICE_CONTROL: {
        ULONG code = stack->Parameters.DeviceIoControl.IoControlCode;
        PVOID buf  = Irp->AssociatedIrp.SystemBuffer;
        ULONG inSz = stack->Parameters.DeviceIoControl.InputBufferLength;
        ULONG outSz= stack->Parameters.DeviceIoControl.OutputBufferLength;

        switch (code) {

        case IOCTL_MYKD_HELLO:
            KdPrint(("[+] IOCTL_MYKD_HELLO received\n"));
            if (outSz >= 6) {
                RtlCopyMemory(buf, "hello", 6);
                info = 6;
            }
            break;

        case IOCTL_MYKD_PID:
            // Return current process PID
            if (outSz >= sizeof(ULONG)) {
                *(PULONG)buf = (ULONG)(ULONG_PTR)PsGetCurrentProcessId();
                info = sizeof(ULONG);
            }
            break;

        default:
            status = STATUS_INVALID_DEVICE_REQUEST;
            break;
        }
        break;
    }

    default:
        status = STATUS_INVALID_DEVICE_REQUEST;
        break;
    }

    Irp->IoStatus.Status      = status;
    Irp->IoStatus.Information = info;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return status;
}
```

### Userland Application

Communicate from user space using `CreateFile` + `DeviceIoControl`:

```c
#include <windows.h>
#include <stdio.h>

#define IOCTL_MYKD_HELLO  CTL_CODE(FILE_DEVICE_UNKNOWN, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS)
#define IOCTL_MYKD_PID    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)

int main() {
    // Open handle to the driver
    HANDLE hDev = CreateFileW(
        L"\\\\.\\MyKD",
        GENERIC_READ | GENERIC_WRITE,
        0, NULL, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL, NULL
    );

    if (hDev == INVALID_HANDLE_VALUE) {
        printf("[-] Failed to open device: %lu\n", GetLastError());
        return 1;
    }

    // Send IOCTL_MYKD_HELLO
    char response[64] = {0};
    DWORD bytesReturned = 0;

    if (DeviceIoControl(hDev, IOCTL_MYKD_HELLO,
                        NULL, 0,
                        response, sizeof(response),
                        &bytesReturned, NULL)) {
        printf("[+] Driver says: %s\n", response);
    }

    // Send IOCTL_MYKD_PID
    ULONG pid = 0;
    if (DeviceIoControl(hDev, IOCTL_MYKD_PID,
                        NULL, 0,
                        &pid, sizeof(pid),
                        &bytesReturned, NULL)) {
        printf("[+] Current PID (from kernel): %lu\n", pid);
    }

    CloseHandle(hDev);
    return 0;
}
```

### Building and Loading

Build the driver project in Visual Studio (Release x64). You'll get `MyKD.sys`.

Load with OSR Driver Loader or `sc.exe`:

```cmd
sc create MyKD type= kernel start= demand binPath= C:\path\to\MyKD.sys
sc start MyKD
```

Check kernel debug output in WinDbg:

```
[+] Driver loaded successfully
[+] IOCTL_MYKD_HELLO received
```

## Conclusion

A working kernel driver requires understanding:

1. **IRP (I/O Request Packet)** — how the kernel passes work to drivers
2. **IOCTL protocol** — how userland and kernel communicate
3. **Cleanup discipline** — always delete devices and symbolic links on unload
4. **Crash hygiene** — use `KdPrint` and `NT_SUCCESS` everywhere; a kernel panic is your bug reporter

From here, you can extend the driver to:
- Map physical memory with `MmMapIoSpace`
- Access process memory with `MmCopyVirtualMemory`
- Hook system calls via SSDT or `PsSetLoadImageNotifyRoutine`
- Implement a kernel-mode keylogger or process monitor

Always develop on a test VM with WinDbg attached. Never run untested kernel code on production systems.

## See Also

- [Windows Driver Kit (WDK) documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/download-the-wdk)
- [OSR Online](https://www.osr.com/) — Windows driver development resources
- *Windows Internals* (Yosifovich, Solomon, Ionescu) — essential reference
- [ReactOS source](https://github.com/reactos/reactos) — open-source Windows NT compatible kernel
