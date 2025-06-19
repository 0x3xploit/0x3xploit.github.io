function filterByTag(tag) {
  const posts = document.querySelectorAll(".post");
  posts.forEach(post => {
    if (tag === "all") {
      post.style.display = "block";
    } else {
      post.style.display = post.classList.contains(tag) ? "block" : "none";
    }
  });
}
