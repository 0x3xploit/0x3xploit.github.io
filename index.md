---
layout: default
title: Home
---

# Welcome to 0x3xploit  

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

---

## 🛠 Projects 
- 🪲 **Packer** – custom XOR packer for ELF/PE binaries  
- 📱 **Android Hooker** – JNI/native function hooker for Android 9  

---

## 📫 Contact
- GitHub: [0x3xploit](https://github.com/0x3xploit)  
- Linkdin: [Pratham Naik](https://www.linkedin.com/in/pratham-naik-a0b794221/)
- Email: naikpratham1212@gmail.com

---