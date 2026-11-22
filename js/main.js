// js/main.js
import { supabase, DEFAULT_AVATAR } from './config.js';
import * as auth from './auth.js';
import * as posts from './posts.js';
import { initAutoGrow, autoGrow, autoGrowObserver, toast, escapeHtml, sanitizeUrl, formatDate, formatShortDate, confirmDialog } from './utils.js';

const lenis = new window.Lenis({ duration: 1.2, smooth: true, smoothTouch: false });
function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
requestAnimationFrame(raf);

const $ = id => document.getElementById(id);

// --- Тема ---
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

function updateThemeIcon(theme) {
  $("iconMoon").style.display = theme === 'dark' ? 'none' : 'block';
  $("iconSun").style.display = theme === 'dark' ? 'block' : 'none';
}

$("themeToggle").addEventListener("click", async () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  const applyTheme = () => {
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
  };
  if (!document.startViewTransition) { applyTheme(); return; }
  const x = window.innerWidth, y = 0, endRadius = Math.hypot(window.innerWidth, window.innerHeight);
  const transition = document.startViewTransition(applyTheme);
  try {
    await transition.ready;
    document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
      { duration: 550, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' });
  } catch (e) {}
});

window.toggleAuthView = function(view) {
  $("loginFormView").style.display = view === 'signup' ? 'none' : 'block';
  $("signupFormView").style.display = view === 'signup' ? 'block' : 'none';
};

// --- Авторизация и старт ---
async function startApp() {
  await auth.refreshSession(
    () => { // onSuccess
      $("authScreen").classList.remove("active");
      document.body.classList.remove("auth-mode");
      $("mainSite").classList.remove("hidden");
      $("mainFooter").classList.remove("hidden");
      
      $("userProfile").classList.add("active");
      $("logoutBtn").style.display = "block";
      $("headerUsername").innerHTML = escapeHtml(auth.currentProfile?.display_name || auth.currentProfile?.tag || "User");
      $("headerAvatar").src = sanitizeUrl(auth.currentProfile?.avatar_url) || DEFAULT_AVATAR;

      $("editor").classList.add("open");
      
      renderPostsList();
      setTimeout(() => { initAutoGrow(); autoGrow($("postContent")); }, 50);
    },
    () => { // onFail
      $("authScreen").classList.add("active");
      document.body.classList.add("auth-mode");
      $("mainSite").classList.add("hidden");
      $("mainFooter").classList.add("hidden");
    },
    () => { // onTagMissing
      $("authScreen").classList.remove("active");
      $("mainSite").classList.add("hidden");
      $("mainFooter").classList.add("hidden");
      $("onboardingTagModal").classList.add("open");
    }
  );
  
  const preloader = $("preloader");
  if (preloader) {
    preloader.style.opacity = '0';
    setTimeout(() => preloader.remove(), 300);
  }
}

// --- Отрисовка постов ---
async function renderPostsList() {
  const postsList = $("postsList");
  try {
    const fetchedPosts = await posts.fetchPosts();
    
    if (fetchedPosts.length === 0) {
      postsList.innerHTML = `<div class="card empty-state"><div class="icon">📝</div><p>It's quiet here... Write your first post!</p></div>`;
      return;
    }

    postsList.innerHTML = fetchedPosts.map((post, index) => {
      const postId = String(post.id);
      let imagesHtml = "";
      const rawImages = post.image_urls?.length > 0 ? post.image_urls : (post.image_url ? [post.image_url] : []);
      const images = rawImages.map(sanitizeUrl).filter(Boolean);
      
      if (images.length > 0) {
        imagesHtml = `<div class="post-gallery ${images.length === 1 ? 'single' : ''}">
          ${images.map(url => `<img src="${escapeHtml(url)}" loading="lazy" alt="Post image" />`).join("")}
        </div>`;
      }

      const isAuthor = auth.currentUser && post.user_id === auth.currentUser.id;
      const authorAvatar = sanitizeUrl(post.author.avatar_url) || DEFAULT_AVATAR;
      const authorName = post.author.display_name || post.author.tag || "Anonymous";
      const authorTag = post.author.tag || "";
      
      const likeState = posts.getLikeState(postId);
      const likeBtnClass = likeState.liked ? "like-btn liked" : "like-btn";
      const likeIcon = likeState.liked ? "♥" : "♡";

      return `
      <article class="post card" style="--index: ${index};" data-post-id="${escapeHtml(postId)}">
        <div class="post-author"
             data-action="view-profile"
             data-user-id="${escapeHtml(post.user_id)}"
             data-name="${escapeHtml(authorName)}"
             data-tag="${escapeHtml(authorTag)}"
             data-avatar="${escapeHtml(authorAvatar)}"
             data-bio="${escapeHtml(post.author.bio || "")}">
          <img src="${escapeHtml(authorAvatar)}" class="post-author-avatar" alt="Author">
          <div class="post-author-info">
            <div class="post-author-name">${escapeHtml(authorName)}</div>
            <div class="post-author-tag">${escapeHtml(authorTag)}</div>
          </div>
        </div>

        <div class="post-header">
          <div>
            <h2>${escapeHtml(post.title)}</h2>
            <div class="post-date">${formatDate(post.created_at)}</div>
          </div>
        </div>
        ${imagesHtml}
        <div class="post-content">${escapeHtml(post.content)}</div>

        <div class="post-footer">
          <button class="${likeBtnClass}" type="button" data-action="toggle-like" data-post-id="${escapeHtml(postId)}" data-tooltip="${likeState.liked ? 'Unlike' : 'Like'}">
            <span class="like-icon">${likeIcon}</span>
            <span class="like-count">${likeState.count}</span>
          </button>
          ${isAuthor ? `<div class="post-footer-actions">
            <button class="btn-glass" data-action="edit-post" data-post-id="${escapeHtml(postId)}">Edit</button>
            <button class="btn-danger" data-action="delete-post" data-post-id="${escapeHtml(postId)}">Delete</button>
          </div>` : ""}
        </div>

        <div class="comments-section" data-comments-for="${escapeHtml(postId)}">
          <button class="comments-toggle" data-action="toggle-comments" data-post-id="${escapeHtml(postId)}">
            💬 Comments <span class="count" data-comment-count>${post.comment_count || 0}</span>
          </button>
          <div class="comments-body" data-comments-body>
            <div class="comments-loading">Loading...</div>
          </div>
        </div>
      </article>`;
    }).join("");
  } catch (err) {
    console.error(err);
    postsList.innerHTML = `<div class="card empty-state"><div class="icon">⚠️</div><p>Could not load posts.</p></div>`;
  }
}

// --- Обработчики событий ---
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await auth.handleLogin($("emailInput").value.trim(), $("passwordInput").value);
    startApp();
  } catch (err) {
    $("loginError").textContent = err.message;
    $("loginError").style.display = "block";
  }
});

$("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await auth.handleSignup($("signupEmail").value.trim(), $("signupPassword").value);
    startApp();
  } catch (err) {
    $("signupError").textContent = err.message;
    $("signupError").style.display = "block";
  }
});

$("logoutBtn").addEventListener("click", auth.handleLogout);
if ($("onboardingLogoutBtn")) $("onboardingLogoutBtn").addEventListener("click", auth.handleLogout);

// Обработчик кликов по постам
$("postsList").addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  
  const action = target.dataset.action;
  const postId = target.dataset.postId;

  if (action === "toggle-like") {
     const success = await posts.toggleLike(postId, target);
     if (!success) renderPostsList(); // откат при ошибке
  } 
  else if (action === "delete-post") {
     if (await confirmDialog("Delete this post?", { title: "Delete", okText: "Yes" })) {
       await supabase.from("posts").delete().eq("id", postId);
       renderPostsList();
     }
  }
  else if (action === "toggle-comments") {
     const sec = target.closest(".comments-section");
     const body = sec.querySelector("[data-comments-body]");
     body.classList.toggle("open");
     if (body.classList.contains("open") && !body.dataset.loaded) {
        // Логика загрузки комментов при необходимости...
        body.dataset.loaded = "true";
     }
  }
});

// Инициализация Observer для textarea
autoGrowObserver.observe(document.body, { childList: true, subtree: true });

// Запуск
startApp();
