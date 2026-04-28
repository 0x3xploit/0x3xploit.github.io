---
layout: default
title: "Blog"
permalink: /blog/
---

<div class="blog-header">
  <h1>All Posts</h1>
  <p>{{ site.posts | size }} articles on security research, exploit development, and reverse engineering.</p>
</div>

<div class="posts">
  {% for post in site.posts %}
  <a class="post-card fade-in" href="{{ post.url | relative_url }}">
    <div class="post-meta">
      <span class="post-date">{{ post.date | date: "%Y-%m-%d" }}</span>
      {% if post.category %}
      <span class="post-category cat-{{ post.category | downcase | replace: ' ', '-' | replace: '/', '-' }}">{{ post.category }}</span>
      {% endif %}
      {% if post.read_time %}
      <span class="read-time">{{ post.read_time }} min read</span>
      {% endif %}
    </div>
    <h2 class="post-title">{{ post.title }}</h2>
    <p class="post-excerpt">{{ post.excerpt | strip_html | truncate: 220 }}</p>
    <div class="post-footer">
      <div class="post-tags">
        {% for tag in post.tags limit:5 %}
        <span class="post-tag">{{ tag }}</span>
        {% endfor %}
      </div>
      <span class="read-more">Read more <span class="arrow">→</span></span>
    </div>
  </a>
  {% endfor %}
</div>
