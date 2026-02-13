# Low Level Lab - Man Page Style Blog

Ultra-minimal static blog. Pure HTML/CSS. Zero JavaScript. Zero distractions.

Inspired by Unix man pages.

## Files

```
index.html          - home page
blog.html           - all posts
post-template.html  - copy this for new posts
styles.css          - minimal styling
posts/              - blog posts directory
```

## Test Locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`

## Add New Post

1. Copy template:
```bash
cp post-template.html posts/my-post.html
```

2. Edit `posts/my-post.html`:
   - Change `<title>MY-POST(1)</title>`
   - Update h1 and article title
   - Replace content

3. Add to `blog.html`:
```html
<div class="post">
    <div class="post-meta">2024-02-15 | category | 10 min</div>
    <div class="post-title"><a href="posts/my-post.html">Title</a></div>
    <p>Description</p>
</div>
```

4. (Optional) Add to `index.html` recent posts

## Man Page Sections

Use these standard man page section names in your posts:

- NAME - brief description
- SYNOPSIS - quick summary
- DESCRIPTION - main content
- IMPLEMENTATION - code details
- EXAMPLES - usage examples
- NOTES - important details
- SEE ALSO - references

## Deploy

### GitHub Pages

```bash
git init
git add .
git commit -m "init"
git push -u origin main
```

Enable Pages in repo settings.

### Other

Upload files to any static host.

## That's It

No build process. No dependencies. Just write and deploy.
