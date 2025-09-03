---
layout: default
title: Home
---

# 👋 Welcome to 0x3xploit  

Hey, I’m **Pratham** – a reverse engineer, exploit dev, and CTF player with [pwn0rDi3](https://ctftime.org/team/390601).  
This site is my collection of **writeups, projects, and notes** on:  
- 🔹 Reverse Engineering  
- 🔹 Binary Exploitation (pwn)  
- 🔹 Malware Analysis  
- 🔹 Security Research  

---

## 🔥 Latest Writeups
{% for post in site.posts limit:5 %}
- 📄 [{{ post.title }}]({{ post.url }}) <small>({{ post.date | date: "%b %d, %Y" }})</small>
{% endfor %}

➡️ [View all writeups](/writeups/)  

---

## 🛠 Projects
- 🐧 **ELF Sandbox** – a minimal Linux ELF sandbox using seccomp, chroot, ptrace  
- 🪲 **Packer** – custom XOR/AES packer for ELF/PE binaries  
- 📱 **Android Hooker** – JNI/native function hooker for Android  

---

## 📫 Contact
- GitHub: [0x3xploit](https://github.com/0x3xploit)  
- Twitter/X: [@0x3xploit](https://twitter.com/0x3xploit)  
- Email: pratham[at]example.com  

---