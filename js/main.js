import { supabase, DEFAULT_AVATAR } from './config.js';
import * as auth from './auth.js';
import * as posts from './posts.js';
import { initAutoGrow, autoGrow, autoGrowObserver, escapeHtml, sanitizeUrl, formatDate, formatShortDate, toast, confirmDialog, stripImageMetadata, triggerSpin } from './utils.js';

const $ = id => document.getElementById(id);

let editingPostId = null;
let pastedImages = [];
let isRefreshing = false;
let realtimeChannel = null;
let pendingNewPostsCount = 0;
let onboardingAvatarFile = null;
let profileAvatarFile = null;

const lenis = window.lenis || null;

const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

function updateThemeIcon(theme) {
  if ($("iconMoon")) $("iconMoon").style.display = theme === 'dark' ? 'none' : 'block';
  if ($("iconSun")) $("iconSun").style.display = theme === 'dark' ? 'block' : 'none';
}
updateThemeIcon(savedTheme);

function setupSpinHover(element, innerSelector = null) {
  if (!element) return;

  element.addEventListener("mouseenter", () => {
    const target = innerSelector ? element.querySelector(innerSelector) : element;

    if (!target) return;
    if (target.classList.contains("animate-spin")) return;

    target.classList.add("animate-spin");
    setTimeout(() => target.classList.remove("animate-spin"), 800);
  });
}

setupSpinHover(document.getElementById("themeToggle"), "svg:not([style*='display: none'])");
setupSpinHover(document.getElementById("settingsBtn"), "svg");
setupSpinHover(document.getElementById("userProfile"), ".user-avatar-small");

$("themeToggle").addEventListener("click", async () => {
  $("iconMoon").classList.remove("animate-spin");
  $("iconSun").classList.remove("animate-spin");

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
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
      { duration: 550, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
    );
  } catch (e) {}
});

async function refreshFeed(scrollToTop = false) {
  if (isRefreshing) return;
  isRefreshing = true;

  const btn = $("refreshBtn");
  const icon = $("refreshIcon");
  const scrollY = window.scrollY;

  if (btn) btn.disabled = true;
  if (icon) icon.style.animation = "spin 0.8s linear infinite";

  try {
    posts.clearPostsCache();
    await renderPostsList();

    if (scrollToTop) {
      if (lenis) lenis.scrollTo(0, { immediate: false });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      if (lenis) lenis.scrollTo(scrollY, { immediate: true });
      else window.scrollTo(0, scrollY);
    }

    hideNewPostsBanner();
    toast("Feed updated", "success");
  } catch (err) {
    console.error("ОШИБКА ПРИ ОБНОВЛЕНИИ:", err);
    toast("Could not refresh feed", "error");
  } finally {
    isRefreshing = false;
    if (btn) btn.disabled = false;
    if (icon) icon.style.animation = "";
  }
}

if ($("refreshBtn")) $("refreshBtn").addEventListener("click", () => refreshFeed(false));
if ($("newPostsBanner")) $("newPostsBanner").addEventListener("click", () => refreshFeed(true));

function getOwnerBadgeHtml() {
  return `<span class="owner-badge" title="Owner"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>`;
}

function getVerifiedBadgeHtml(isVerified) {
  if (!isVerified) return "";
  return `<span class="verified-badge" title="Verified"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></span>`;
}

function openProfileModal(name, tag, avatar, bio, isOwner, region) {
  $("viewProfileName").innerHTML = escapeHtml(name || "User") + (isOwner ? getOwnerBadgeHtml() : "");
  $("viewProfileTag").textContent = tag || "";
  $("viewProfileRegion").textContent = region && region !== "Unknown" ? `📍 ${region}` : "";
  $("viewProfileAvatar").src = sanitizeUrl(avatar) || DEFAULT_AVATAR;
  $("viewProfileBio").textContent = bio || "No bio yet.";
  $("viewProfileModal").classList.add("open");
}

$("userProfile").addEventListener("click", () => {
  if (!auth.currentProfile) return;
  openProfileModal(
    auth.currentProfile.display_name || auth.currentProfile.tag,
    auth.currentProfile.tag,
    auth.currentProfile.avatar_url,
    auth.currentProfile.bio,
    auth.isAdmin,
    auth.currentProfile.region
  );
});

function bindProfileClicks() {
  document.querySelectorAll(".js-open-profile").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openProfileModal(
        el.dataset.name,
        el.dataset.tag,
        el.dataset.avatar,
        el.dataset.bio,
        el.dataset.owner === "true",
        el.dataset.region
      );
    });
  });
}

async function renderPostsList() {
  const postsList = $("postsList");
  try {
    const fetchedPosts = await posts.fetchPosts();

    if (fetchedPosts.length === 0) {
      postsList.innerHTML = `<div class="card empty-state"><p>It's quiet here... Write your first post!</p></div>`;
      renderPendingVerifications();
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
      const canManage = isAuthor || auth.isAdmin;

      const authorAvatar = sanitizeUrl(post.author.avatar_url) || DEFAULT_AVATAR;
      const authorName = post.author.display_name || post.author.tag || "Anonymous";
      const authorTag = post.author.tag || "";

      const likeState = posts.getLikeState(postId);
      const likeBtnClass = likeState.liked ? "like-btn liked" : "like-btn";
      const likeIcon = likeState.liked ? "♥" : "♡";

      const ownerBadge = post.is_owner ? getOwnerBadgeHtml() : "";
      const verifiedBadge = getVerifiedBadgeHtml(post.author.is_verified);

      const reactions = post.reactions || {};
      const userReactions = post.userReactions || new Set();

      let activeReactionsHtml = "";
      const activeList = Object.keys(reactions).filter(e => reactions[e] > 0);

      if (activeList.length > 0) {
        activeReactionsHtml = activeList.map(emoji => {
          const isActive = userReactions.has(`${postId}_${emoji}`);
          return `<button class="reaction-pill ${isActive ? 'active' : ''}" data-action="toggle-reaction" data-post-id="${postId}" data-emoji="${emoji}">
            <span class="reaction-emoji">${emoji}</span>
            <span class="reaction-count">${reactions[emoji]}</span>
          </button>`;
        }).join("");
      }

      const dropdownHtml = `
        <div class="reaction-dropdown-wrapper">
          <button class="reaction-trigger" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
              <line x1="9" y1="9" x2="9.01" y2="9"></line>
              <line x1="15" y1="9" x2="15.01" y2="9"></line>
            </svg>
            <span class="plus-icon">&plus;</span>
          </button>
          <div class="reaction-menu" id="emoji-menu-${postId}" data-post-id="${postId}"></div>
        </div>
      `;

      return `
       <article class="post card" style="${index < 3 ? `--index: ${index};` : ''}" data-post-id="${escapeHtml(postId)}">
        <div class="post-author js-open-profile"
             data-name="${escapeHtml(authorName)}"
             data-tag="${escapeHtml(authorTag)}"
             data-avatar="${escapeHtml(authorAvatar)}"
             data-bio="${escapeHtml(post.author.bio || "")}"
             data-owner="${post.is_owner}"
             data-region="${escapeHtml(post.author.region || "")}">
          <img src="${escapeHtml(authorAvatar)}" class="post-author-avatar" alt="Author">
          <div class="post-author-info">
            <div class="post-author-name">${escapeHtml(authorName)}${ownerBadge}${verifiedBadge}</div>
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
          <div class="post-footer-left">
            <button class="${likeBtnClass}" type="button" data-action="toggle-like" data-post-id="${escapeHtml(postId)}">
              <span class="like-icon">${likeIcon}</span>
              <span class="like-count">${likeState.count}</span>
            </button>

            ${activeReactionsHtml}
            ${dropdownHtml}
          </div>

          ${canManage ? `<div class="post-footer-actions" style="display: flex; gap: 8px;">
            <button class="btn-glass" data-action="edit-post" data-post-id="${escapeHtml(postId)}">Edit</button>
            <button class="btn-glass" data-action="delete-post" data-post-id="${escapeHtml(postId)}">Delete</button>
          </div>` : ""}
        </div>

        <div class="comments-section" data-comments-for="${escapeHtml(postId)}">
          <button class="comments-toggle" data-action="toggle-comments" data-post-id="${escapeHtml(postId)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
            Comments <span class="count" data-comment-count>${post.comment_count || 0}</span>
          </button>
          <div class="comments-body" data-comments-body>
            <div class="comments-loading"><div class="spinner"></div> Loading...</div>
          </div>
        </div>
      </article>`;
    }).join("");

    bindProfileClicks();
    renderPendingVerifications();
  } catch (err) {
    console.error("Render posts error:", err);
    postsList.innerHTML = `<div class="card empty-state"><p>Could not load posts.</p></div>`;
  }
}

function showNewPostsBanner(count) {
  pendingNewPostsCount += count;
  const banner = $("newPostsBanner");
  const text = $("newPostsBannerText");
  if (!banner || !text) return;
  text.textContent = pendingNewPostsCount === 1
    ? "Show 1 new post"
    : `Show ${pendingNewPostsCount} new posts`;
  banner.hidden = false;
}

function hideNewPostsBanner() {
  pendingNewPostsCount = 0;
  const banner = $("newPostsBanner");
  if (banner) banner.hidden = true;
}

function isUserTyping() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT") {
    return active.value.trim().length > 0;
  }
  return false;
}

function initRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabase.channel('realtime:public')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, async (payload) => {
      if (payload.eventType === 'INSERT') {
        if (payload.new.user_id !== auth.currentUser?.id) showNewPostsBanner(1);
      }
      else if (payload.eventType === 'DELETE') {
        const el = document.querySelector(`.post[data-post-id="${payload.old.id}"]`);
        if (el) el.remove();
      }
      else if (payload.eventType === 'UPDATE') {
        if (payload.new.user_id !== auth.currentUser?.id && !isUserTyping()) renderPostsList();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, (payload) => {
      let postId = payload.new?.post_id || payload.old?.post_id;

      if (payload.eventType === 'DELETE' && !postId) {
        const btnEl = document.querySelector(`[data-action="delete-comment"][data-comment-id="${payload.old.id}"]`);
        if (btnEl) postId = btnEl.dataset.postId;
      }

      if (!postId) return;
      const postEl = document.querySelector(`.post[data-post-id="${postId}"]`);
      if (!postEl) return;

      const countEl = postEl.querySelector("[data-comment-count]");
      if (countEl) {
        let current = parseInt(countEl.textContent, 10) || 0;
        if (payload.eventType === 'INSERT') current++;
        if (payload.eventType === 'DELETE') current = Math.max(0, current - 1);
        countEl.textContent = String(current);
      }

      const bodyEl = postEl.querySelector("[data-comments-body]");
      if (bodyEl && bodyEl.classList.contains("open")) {
        if (payload.eventType === 'DELETE') {
          const commentEl = bodyEl.querySelector(`.comment[data-comment-id="${payload.old.id}"]`);
          if (commentEl) commentEl.remove();
        } else {
          posts.clearCommentsCache(postId);
          bodyEl.dataset.loaded = "";
          posts.loadComments(postId, bodyEl).then(fresh => {
            const input = bodyEl.querySelector('[data-role="comment-input"]');
            if (!input || input.value.trim().length === 0) {
              renderCommentsInto(bodyEl, fresh, postId);
            }
          });
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, (payload) => {
      const postId = payload.new?.post_id || payload.old?.post_id;
      if (!postId) return;

      const postEl = document.querySelector(`.post[data-post-id="${postId}"]`);
      if (!postEl) return;

      const btn = postEl.querySelector('[data-action="toggle-like"]');
      if (!btn) return;

      const likeIcon = btn.querySelector(".like-icon");
      const countEl = btn.querySelector(".like-count");

      if (payload.eventType === 'INSERT') {
        if (payload.new.user_id !== auth.currentUser?.id) {
          btn.classList.add("liked");
          likeIcon.textContent = "♥";
          countEl.textContent = String(parseInt(countEl.textContent || 0, 10) + 1);

          const k = String(postId);
          const cached = posts.likesCache.get(k) || { count: 0, liked: false };
          cached.count++;
          posts.likesCache.set(k, cached);
        }
      } else if (payload.eventType === 'DELETE') {
        if (payload.old.user_id !== auth.currentUser?.id) {
          btn.classList.remove("liked");
          likeIcon.textContent = "♡";
          countEl.textContent = String(Math.max(0, parseInt(countEl.textContent || 0, 10) - 1));

          const k = String(postId);
          const cached = posts.likesCache.get(k) || { count: 0, liked: false };
          cached.count = Math.max(0, cached.count - 1);
          posts.likesCache.set(k, cached);
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'verification_requests' }, (payload) => {
      if (!auth.isAdmin) return;
      if (payload.eventType === 'INSERT' && payload.new.status === 'pending') {
        toast("Новая заявка на верификацию!", "info");
      }
      renderPendingVerifications();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'post_reactions' }, (payload) => {
      let postId = payload.new?.post_id || payload.old?.post_id;
      let emoji = payload.new?.emoji || payload.old?.emoji;
      let userId = payload.new?.user_id || payload.old?.user_id;

      if (userId === auth.currentUser?.id) return;

      if (!postId) {
        if (payload.eventType === 'DELETE' && emoji) {
          const btn = document.querySelector(`.reaction-pill[data-emoji="${emoji}"]`);
          if (btn) postId = btn.dataset.postId;
        }
      }
      if (!postId) return;

      const postEl = document.querySelector(`.post[data-post-id="${postId}"]`);
      if (!postEl) return;

      const footerLeft = postEl.querySelector(".post-footer-left");
      if (!footerLeft) return;

      let pill = footerLeft.querySelector(`.reaction-pill[data-emoji="${emoji}"]`);

      if (payload.eventType === 'INSERT') {
        if (pill) {
          const countEl = pill.querySelector(".reaction-count");
          if (countEl) countEl.textContent = String(parseInt(countEl.textContent, 10) + 1);
        } else {
          const newPill = document.createElement("button");
          newPill.className = "reaction-pill";
          newPill.dataset.action = "toggle-reaction";
          newPill.dataset.postId = postId;
          newPill.dataset.emoji = emoji;
          newPill.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">1</span>`;
          
          const trigger = footerLeft.querySelector(".reaction-dropdown-wrapper");
          footerLeft.insertBefore(newPill, trigger);
        }
      } else if (payload.eventType === 'DELETE') {
        if (pill) {
          const countEl = pill.querySelector(".reaction-count");
          let current = parseInt(countEl.textContent, 10) || 0;
          if (current <= 1) {
            pill.remove();
          } else {
            countEl.textContent = String(current - 1);
          }
        }
      }
    })
    .subscribe();
}

function renderCommentsInto(body, comments, postId) {
  if (!comments) {
    body.innerHTML = `<div class="comments-empty">Could not load comments.</div>`;
    return;
  }

  const listHtml = comments.length === 0
    ? `<div class="comments-empty">No comments yet.</div>`
    : `<div class="comment-list">${comments.map(c => {
        const isAuth = auth.currentUser && c.user_id === auth.currentUser.id;
        const av = sanitizeUrl(c.author.avatar_url) || DEFAULT_AVATAR;
        const nm = c.author.display_name || c.author.tag || "Anon";
        const tg = c.author.tag || "";
        const badge = c.is_owner ? getOwnerBadgeHtml() : "";
        const vBadge = getVerifiedBadgeHtml(c.author.is_verified);
        const bio = c.author.bio || "";
        const region = c.author.region || "";

        return `
          <div class="comment" data-comment-id="${escapeHtml(c.id)}">
            <img src="${escapeHtml(av)}" class="comment-avatar" alt="">
            <div class="comment-body-text">
              <div class="comment-head">
                <span class="comment-author js-open-profile"
                      data-name="${escapeHtml(nm)}"
                      data-tag="${escapeHtml(tg)}"
                      data-avatar="${escapeHtml(av)}"
                      data-bio="${escapeHtml(bio)}"
                      data-region="${escapeHtml(region)}"
                      data-owner="${c.is_owner || false}">${escapeHtml(nm)}${badge}${vBadge}</span>
                <span class="comment-date">${formatShortDate(c.created_at)}</span>
                ${isAuth ? `<button class="comment-delete" type="button"
                    data-action="delete-comment"
                    data-comment-id="${escapeHtml(c.id)}"
                    data-post-id="${escapeHtml(postId)}">🗑</button>` : ""}
              </div>
              <div class="comment-text">${escapeHtml(c.content)}</div>
            </div>
          </div>`;
      }).join("")}</div>`;

  const formHtml = `
    <div class="comment-form">
      <textarea placeholder="Write a comment... (Ctrl+Enter)" maxlength="2000"
                data-role="comment-input" data-post-id="${escapeHtml(postId)}"></textarea>
      <button class="btn-primary" type="button" data-action="submit-comment"
              data-post-id="${escapeHtml(postId)}">Send</button>
    </div>`;

  body.innerHTML = listHtml + formHtml;
  body.dataset.loaded = "true";
  bindProfileClicks();
}

async function renderPendingVerifications() {
  if (!auth.isAdmin) return;

  const existing = document.getElementById("pendingVerificationsBlock");
  if (existing) existing.remove();

  const { data: requests, error } = await supabase
    .from("verification_requests")
    .select("id, message, created_at, user_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return console.error("Verification request error:", error);
  if (!requests || requests.length === 0) return;

  const userIds = [...new Set(requests.map(r => r.user_id))];
  const { data: profiles } = await supabase.from("profiles").select("id, tag, display_name").in("id", userIds);
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });
  const data = requests.map(r => ({ ...r, profiles: profileMap[r.user_id] || null }));

  const section = document.createElement("div");
  section.id = "pendingVerificationsBlock";
  section.className = "card";
  section.style.padding = "24px";
  section.style.marginBottom = "24px";

  section.innerHTML = `<h3 style="font-family: 'Lora', serif; margin-bottom: 16px;">Pending Verifications (${data.length})</h3>
    ${data.map(r => `
      <div style="padding: 12px 0; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 200px;">
          <strong>${escapeHtml(r.profiles?.tag || r.profiles?.display_name || "Unknown")}</strong>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${escapeHtml(r.message)}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-primary" data-approve="${r.id}" style="padding: 6px 12px; font-size: 0.8rem;">Approve</button>
          <button class="btn-danger" data-reject="${r.id}" style="padding: 6px 12px; font-size: 0.8rem;">Reject</button>
        </div>
      </div>
    `).join("")}
  `;

  $("postsList").prepend(section);

  section.querySelectorAll("[data-approve]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.from("verification_requests").update({ status: "approved" }).eq("id", btn.dataset.approve);
      if (error) return toast("Error: " + error.message, "error");
      toast("User approved!", "success");
      section.remove();
      renderPendingVerifications();
    });
  });

  section.querySelectorAll("[data-reject]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.from("verification_requests").update({ status: "rejected" }).eq("id", btn.dataset.reject);
      if (error) return toast("Error: " + error.message, "error");
      toast("User rejected.", "info");
      section.remove();
      renderPendingVerifications();
    });
  });
}

async function startApp() {
  try {
    await auth.refreshSession(
      () => {
        $("authScreen").classList.remove("active");
        document.body.classList.remove("auth-mode");
        $("mainSite").classList.remove("hidden");
        $("mainFooter").classList.remove("hidden");

        $("userProfile").classList.add("active");
        $("settingsBtn").style.display = "block";
        $("logoutBtn").style.display = "block";

        const headerBadge = auth.isAdmin ? getOwnerBadgeHtml() : "";
        $("headerUsername").innerHTML = escapeHtml(auth.currentProfile?.display_name || auth.currentProfile?.tag || "User") + headerBadge + getVerifiedBadgeHtml(auth.currentProfile?.is_verified);
        $("headerAvatar").src = sanitizeUrl(auth.currentProfile?.avatar_url) || DEFAULT_AVATAR;

        $("editor").classList.add("open");
        renderPostsList();
        initRealtime();
        setTimeout(() => { initAutoGrow(); autoGrow($("postContent")); }, 50);
      },
      () => {
        $("authScreen").classList.add("active");
        document.body.classList.add("auth-mode");
        $("mainSite").classList.add("hidden");
        $("mainFooter").classList.add("hidden");
      },
      () => {
        $("authScreen").classList.remove("active");
        $("mainSite").classList.add("hidden");
        $("mainFooter").classList.add("hidden");
        $("onboardingTagModal").classList.add("open");
      }
    );
  } catch (err) {
    console.error("StartApp error:", err);
  } finally {
    const preloader = $("preloader");
    if (preloader) {
      preloader.style.opacity = '0';
      setTimeout(() => preloader.remove(), 300);
    }
  }
}

window.toggleAuthView = function(view) {
  if (view === 'signup') {
    $("loginFormView").style.display = "none";
    $("signupFormView").style.display = "block";
    $("loginError").style.display = "none";
    $("signupError").style.display = "none";
  } else {
    $("signupFormView").style.display = "none";
    $("loginFormView").style.display = "block";
    $("loginError").style.display = "none";
    $("signupError").style.display = "none";
  }
};

const passwordReqs = {
  length: (v) => v.length >= 8,
  upper: (v) => /[A-Z]/.test(v),
  lower: (v) => /[a-z]/.test(v),
  number: (v) => /[0-9]/.test(v),
  special: (v) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(v)
};

function validatePassword(password) {
  const results = {};
  for (const [key, test] of Object.entries(passwordReqs)) {
    results[key] = test(password || "");
  }
  return results;
}

function updatePasswordUI(password) {
  const badges = document.querySelectorAll("#passwordRequirements .req-badge");
  if (!badges.length) return;
  const results = validatePassword(password);
  badges.forEach(badge => {
    const req = badge.dataset.req;
    const icon = badge.querySelector(".req-icon");
    if (results[req]) {
      badge.classList.add("valid");
      if (icon) icon.textContent = "✓";
    } else {
      badge.classList.remove("valid");
      if (icon) icon.textContent = "○";
    }
  });
}

function initPasswordCheck() {
  const passInput = document.getElementById("signupPassword");
  if (!passInput) return;
  passInput.addEventListener("input", (e) => updatePasswordUI(e.target.value));
  if (typeof window.toggleAuthView === "function") {
    const originalToggle = window.toggleAuthView;
    window.toggleAuthView = function(view) {
      originalToggle(view);
      if (view === 'signup') updatePasswordUI(passInput.value);
    };
  }
}

initPasswordCheck();

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
  $("signupError").style.display = "none";

  const password = $("signupPassword").value;
  const validation = validatePassword(password);
  const allValid = Object.values(validation).every(Boolean);

  if (!allValid) {
    $("signupError").textContent = "Please meet all password requirements.";
    $("signupError").style.display = "block";
    const firstFailed = document.querySelector("#passwordRequirements .req-badge:not(.valid)");
    if (firstFailed) {
      firstFailed.style.transform = "scale(1.15)";
      setTimeout(() => firstFailed.style.transform = "scale(1)", 250);
    }
    return;
  }

  $("submitSignup").disabled = true;
  $("submitSignup").textContent = "Creating...";

  try {
    await auth.handleSignup($("signupEmail").value.trim(), password);
    toast("Account created! Welcome to Lowium.", "success");
    startApp();
  } catch (err) {
    $("signupError").textContent = err.message;
    $("signupError").style.display = "block";
  } finally {
    $("submitSignup").disabled = false;
    $("submitSignup").textContent = "Sign Up";
  }
});

$("logoutBtn").addEventListener("click", auth.handleLogout);

$("settingsBtn").addEventListener("click", () => {
  $("settingsModal").classList.add("open");
  $("newEmail").value = "";
  $("newPass").value = "";
  $("emailError").style.display = "none";
  $("passError").style.display = "none";
});

$("closeSettingsBtn").addEventListener("click", () => $("settingsModal").classList.remove("open"));

$("updateEmailBtn").addEventListener("click", async () => {
  const newEmail = $("newEmail").value.trim();
  if (!newEmail) return;
  $("emailError").style.display = "none";
  $("updateEmailBtn").disabled = true;
  $("updateEmailBtn").textContent = "Updating...";

  const { error } = await supabase.auth.updateUser({ email: newEmail });

  $("updateEmailBtn").disabled = false;
  $("updateEmailBtn").textContent = "Update Email";

  if (error) {
    $("emailError").textContent = error.message;
    $("emailError").style.display = "block";
  } else {
    toast("Email updated! Check your inbox to confirm.", "success");
    $("newEmail").value = "";
  }
});

$("updatePassBtn").addEventListener("click", async () => {
  const newPass = $("newPass").value;
  if (!newPass) return;
  $("passError").style.display = "none";
  $("updatePassBtn").disabled = true;
  $("updatePassBtn").textContent = "Updating...";

  const { error } = await supabase.auth.updateUser({ password: newPass });

  $("updatePassBtn").disabled = false;
  $("updatePassBtn").textContent = "Update Password";

  if (error) {
    $("passError").textContent = error.message;
    $("passError").style.display = "block";
  } else {
    toast("Password updated successfully!", "success");
    $("newPass").value = "";
  }
});

$("deleteAccountBtn").addEventListener("click", async () => {
  const ok = await confirmDialog("Are you absolutely sure you want to delete your account? This action cannot be undone.", { title: "Delete Account", okText: "Delete" });
  if (!ok) return;
  const { error } = await supabase.rpc('delete_user');
  if (error) toast("Error deleting account: " + error.message, "error");
  else { await supabase.auth.signOut(); window.location.reload(); }
});

$("publishBtn").addEventListener("click", async () => {
  if (!auth.currentUser) return;

  if (!auth.currentProfile?.is_verified) {
    $("verificationError").style.display = "none";
    $("verificationModal").classList.add("open");
    return;
  }

  const title = $("postTitle").value.trim();
  const content = $("postContent").value.trim();

  if (!title) return toast("Please enter a post title.", "error");
  if (!content && pastedImages.length === 0) return toast("Please write something or add an image.", "error");

  $("publishBtn").disabled = true;
  $("publishBtn").textContent = editingPostId ? "Saving..." : "Publishing...";

  try {
    const imageUrls = [];

    for (const dataUrl of pastedImages) {
      if (dataUrl.startsWith("http")) {
        imageUrls.push(dataUrl);
      } else {
        const res = await fetch(dataUrl);
        const rawBlob = await res.blob();
        const cleanBlob = await stripImageMetadata(rawBlob, { maxSize: 2048, quality: 0.9 });
        const fileExt = cleanBlob.type === "image/png" ? "png"
                      : cleanBlob.type === "image/webp" ? "webp"
                      : cleanBlob.type === "image/gif" ? "gif"
                      : "jpg";
        const fileName = `${auth.currentUser.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage.from('posts').upload(fileName, cleanBlob, { contentType: cleanBlob.type });
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
        imageUrls.push(publicUrl);
      }
    }

    if (editingPostId) {
      const { error: updateError } = await supabase.from('posts').update({ title, content, image_urls: imageUrls }).eq('id', editingPostId);
      if (updateError) throw updateError;
      toast("Post updated successfully!", "success");
    } else {
      const { error: postError } = await supabase.from('posts').insert({ user_id: auth.currentUser.id, title, content, image_urls: imageUrls });
      if (postError) throw postError;
      toast("Post published successfully!", "success");
    }

    editingPostId = null;
    $("postTitle").value = "";
    $("postContent").value = "";
    autoGrow($("postContent"));
    pastedImages = [];
    renderPreviewGrid();
    $("publishBtn").textContent = "Publish Post";
    $("cancelEditBtn").classList.remove("visible");

    posts.clearPostsCache();
    renderPostsList();

  } catch (err) {
    console.error(err);
    toast("Error: " + err.message, "error");
  } finally {
    $("publishBtn").disabled = false;
    if (!editingPostId) $("publishBtn").textContent = "Publish Post";
  }
});

$("cancelEditBtn").addEventListener("click", () => {
  editingPostId = null;
  $("postTitle").value = "";
  $("postContent").value = "";
  autoGrow($("postContent"));
  pastedImages = [];
  renderPreviewGrid();
  $("publishBtn").textContent = "Publish Post";
  $("cancelEditBtn").classList.remove("visible");
});

const postContentEl = $("postContent");
const previewGrid = $("previewGrid");

if (postContentEl && previewGrid) {
  postContentEl.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasImage = false;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        hasImage = true;
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          pastedImages.push(ev.target.result);
          renderPreviewGrid();
        };
        reader.readAsDataURL(file);
      }
    }
    if (hasImage) e.preventDefault();
  });
}

function renderPreviewGrid() {
  if (!previewGrid) return;
  previewGrid.innerHTML = pastedImages.map((url, i) => `
    <div class="preview-item">
      <img src="${url}" alt="Pasted image" />
      <button class="remove-btn" type="button" data-remove-index="${i}">×</button>
    </div>
  `).join("");

  previewGrid.querySelectorAll("[data-remove-index]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.removeIndex, 10);
      pastedImages.splice(idx, 1);
      renderPreviewGrid();
    });
  });
}

const postImageInput = $("postImage");
if (postImageInput) {
  postImageInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        pastedImages.push(ev.target.result);
        renderPreviewGrid();
      };
      reader.readAsDataURL(file);
    });
    postImageInput.value = "";
  });
}

$("submitVerification").addEventListener("click", async () => {
  const message = $("verificationMessage").value.trim();
  const errorEl = $("verificationError");
  errorEl.style.display = "none";

  if (!message) {
    errorEl.textContent = "Please write something.";
    errorEl.style.display = "block";
    return;
  }

  $("submitVerification").disabled = true;
  $("submitVerification").textContent = "Submitting...";

  const { error } = await supabase.from("verification_requests").insert({ user_id: auth.currentUser.id, message });

  $("submitVerification").disabled = false;
  $("submitVerification").textContent = "Submit Request";

  if (error) {
    if (error.code === "23505") errorEl.textContent = "You already have a pending request. Please wait.";
    else errorEl.textContent = error.message;
    errorEl.style.display = "block";
  } else {
    toast("Request sent! Wait for admin approval.", "success");
    $("verificationModal").classList.remove("open");
    $("verificationMessage").value = "";
  }
});

$("cancelVerification").addEventListener("click", () => $("verificationModal").classList.remove("open"));
$("verificationModal").addEventListener("click", (e) => { if (e.target === $("verificationModal")) $("verificationModal").classList.remove("open"); });

$("submitOnboardingTag").addEventListener("click", async () => {
  const tag = $("onboardingTag").value.trim();
  const errorEl = $("onboardingError");
  errorEl.style.display = "none";

  if (!tag) {
    errorEl.textContent = "Please enter a username.";
    errorEl.style.display = "block";
    return;
  }

  $("submitOnboardingTag").disabled = true;
  $("submitOnboardingTag").textContent = "Checking...";

  try {
    await auth.submitTag(tag);
    $("onboardingTagModal").classList.remove("open");
    $("onboardingProfileModal").classList.add("open");
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  } finally {
    $("submitOnboardingTag").disabled = false;
    $("submitOnboardingTag").textContent = "Continue";
  }
});

$("onboardingLogoutBtn").addEventListener("click", auth.handleLogout);

$("onboardingAvatarInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  onboardingAvatarFile = file;
  $("onboardingAvatarPreview").src = URL.createObjectURL(file);
});

$("skipOnboardingProfile").addEventListener("click", () => {
  $("onboardingProfileModal").classList.remove("open");
  startApp();
});

$("submitOnboardingProfile").addEventListener("click", async () => {
  const bio = $("onboardingBio").value.trim();
  $("submitOnboardingProfile").disabled = true;
  $("submitOnboardingProfile").textContent = "Saving...";

  try {
    await auth.updateProfile({
      display_name: auth.currentProfile?.display_name || auth.currentProfile?.tag,
      tag: auth.currentProfile?.tag,
      bio: bio || null,
      region: auth.currentProfile?.region || "Unknown"
    }, onboardingAvatarFile);
    toast("Profile set up successfully!", "success");
    $("onboardingProfileModal").classList.remove("open");
    startApp();
  } catch (err) {
    toast("Error saving profile: " + err.message, "error");
  } finally {
    $("submitOnboardingProfile").disabled = false;
    $("submitOnboardingProfile").textContent = "Save";
  }
});

$("avatarInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  profileAvatarFile = file;
  $("profileAvatarPreview").src = URL.createObjectURL(file);
});

$("submitProfile").addEventListener("click", async () => {
  const tag = $("profileTag").value.trim();
  const displayName = $("profileDisplayName").value.trim();
  const bio = $("profileBio").value.trim();
  const region = $("profileRegion").value;
  const errorEl = $("profileError");
  errorEl.style.display = "none";

  if (!tag) {
    errorEl.textContent = "Tag is required.";
    errorEl.style.display = "block";
    return;
  }

  $("submitProfile").disabled = true;
  $("submitProfile").textContent = "Saving...";

  try {
    await auth.updateProfile({ display_name: displayName || null, tag, bio: bio || null, region }, profileAvatarFile);
    toast("Profile updated!", "success");
    $("profileModal").classList.remove("open");
    $("headerUsername").innerHTML = escapeHtml(auth.currentProfile?.display_name || auth.currentProfile?.tag || "User") + (auth.isAdmin ? getOwnerBadgeHtml() : "") + getVerifiedBadgeHtml(auth.currentProfile?.is_verified);
    $("headerAvatar").src = sanitizeUrl(auth.currentProfile?.avatar_url) || DEFAULT_AVATAR;
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  } finally {
    $("submitProfile").disabled = false;
    $("submitProfile").textContent = "Save Profile";
  }
});

$("closeViewProfileBtn").addEventListener("click", () => $("viewProfileModal").classList.remove("open"));

$("openEditProfileBtn").addEventListener("click", () => {
  $("viewProfileModal").classList.remove("open");
  $("profileAvatarPreview").src = sanitizeUrl(auth.currentProfile?.avatar_url) || DEFAULT_AVATAR;
  $("profileDisplayName").value = auth.currentProfile?.display_name || "";
  $("profileTag").value = auth.currentProfile?.tag || "";
  $("profileBio").value = auth.currentProfile?.bio || "";
  $("profileRegion").value = auth.currentProfile?.region || "Unknown";
  profileAvatarFile = null;
  $("profileModal").classList.add("open");
});

$("viewProfileModal").addEventListener("click", (e) => { if (e.target === $("viewProfileModal")) $("viewProfileModal").classList.remove("open"); });
$("profileModal").addEventListener("click", (e) => { if (e.target === $("profileModal")) $("profileModal").classList.remove("open"); });
$("settingsModal").addEventListener("click", (e) => { if (e.target === $("settingsModal")) $("settingsModal").classList.remove("open"); });

$("postsList").addEventListener("click", async (e) => {
  if (!e.target.closest(".reaction-dropdown-wrapper")) {
    document.querySelectorAll(".reaction-menu.open").forEach(m => m.classList.remove("open"));
  }

  const trigger = e.target.closest(".reaction-trigger");
  if (trigger) {
    const wrapper = trigger.closest(".reaction-dropdown-wrapper");
    const menu = wrapper.querySelector(".reaction-menu");
    const postId = menu.dataset.postId;
    const isOpen = menu.classList.contains("open");

    document.querySelectorAll(".reaction-menu.open").forEach(m => m.classList.remove("open"));

    if (!isOpen) {
      menu.classList.add("open");

      if (menu.innerHTML === "") {
     const picker = new EmojiMart.Picker({
          onEmojiSelect: (emojiData) => {
            const emoji = emojiData.native;
            menu.classList.remove("open");
            
            const postEl = document.querySelector(`.post[data-post-id="${postId}"]`);
            if (!postEl) return;
            
            const footerLeft = postEl.querySelector(".post-footer-left");
            if (!footerLeft) return;

            let existingPill = footerLeft.querySelector(`.reaction-pill[data-emoji="${emoji}"]`);

            if (existingPill) {
              // Если реакция уже есть в DOM, просто кликаем по ней для переключения
              existingPill.click();
            } else {
              // Если реакции нет, создаём её БЕЗ класса active и с нулем
              const newPill = document.createElement("button");
              newPill.className = "reaction-pill"; 
              newPill.dataset.action = "toggle-reaction";
              newPill.dataset.postId = postId;
              newPill.dataset.emoji = emoji;
              newPill.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">0</span>`;
              
              const triggerEl = footerLeft.querySelector(".reaction-dropdown-wrapper");
              footerLeft.insertBefore(newPill, triggerEl);
              
              // Программный клик сделает её active и прибавит 1
              newPill.click();
            }
          },
          theme: document.documentElement.getAttribute("data-theme") || "light",
          previewPosition: "none",
          skinTonePosition: "none",
          perLine: 8,
        });
        menu.appendChild(picker);
      }
    }
    return;
  }

  const target = e.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  const postId = target.dataset.postId;

  if (action === "toggle-reaction") {
    const emoji = target.dataset.emoji;
    const isActive = target.classList.contains("active");
    const countEl = target.querySelector(".reaction-count");
    
    if (isActive) {
      target.classList.remove("active");
      if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);
    } else {
      target.classList.add("active");
      if (countEl) countEl.textContent = parseInt(countEl.textContent, 10) + 1;
    }

    try {
      await posts.toggleReaction(postId, emoji);
    } catch (err) {
      if (isActive) {
        target.classList.add("active");
        if (countEl) countEl.textContent = parseInt(countEl.textContent, 10) + 1;
      } else {
        target.classList.remove("active");
        if (countEl) countEl.textContent = Math.max(0, parseInt(countEl.textContent, 10) - 1);
      }
      toast("Error with reaction: " + err.message, "error");
    }
  }
  else if (action === "toggle-like") {
    try {
      await posts.toggleLike(postId, target);
    } catch (err) {
      toast("Error with like: " + err.message, "error");
    }
  }
  else if (action === "edit-post") {
    const article = target.closest(".post");
    const title = article.querySelector("h2").textContent;
    const content = article.querySelector(".post-content").textContent;
    const existingImages = article.querySelectorAll(".post-gallery img");

    editingPostId = postId;
    $("postTitle").value = title;
    $("postContent").value = content;
    autoGrow($("postContent"));

    pastedImages = Array.from(existingImages).map(img => img.src);
    renderPreviewGrid();

    $("publishBtn").textContent = "Save Changes";
    $("cancelEditBtn").classList.add("visible");

    $("editor").scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  else if (action === "delete-post") {
    if (await confirmDialog("Delete this post?", { title: "Delete", okText: "Yes" })) {
      try {
        const { error } = await supabase.from("posts").delete().eq("id", postId);
        if (error) throw error;
        
        const postEl = target.closest(".post");
        if (postEl) postEl.remove();
        toast("Post deleted.", "success");

        if ($("postsList").children.length === 0) {
          $("postsList").innerHTML = `<div class="card empty-state"><p>It's quiet here... Write your first post!</p></div>`;
        }
      } catch (err) {
        toast("Error deleting post: " + err.message, "error");
      }
    }
  }
  else if (action === "toggle-comments") {
    const sec = target.closest(".comments-section");
    const body = sec.querySelector("[data-comments-body]");
    if (body.classList.contains("open")) {
      body.classList.remove("open");
    } else {
      body.classList.add("open");
      if (!body.dataset.loaded) {
        try {
          const comments = await posts.loadComments(postId, body);
          renderCommentsInto(body, comments, postId);
        } catch (err) {
          console.error(err);
          body.innerHTML = `<div class="comments-empty">Could not load comments.</div>`;
          body.dataset.loaded = "true";
        }
      }
    }
  }
  else if (action === "delete-comment") {
    const commentId = target.dataset.commentId;
    const ok = await confirmDialog("Delete this comment?", { title: "Delete Comment", okText: "Delete" });
    if (!ok) return;

    try {
      await posts.deleteComment(commentId, postId);
      toast("Comment deleted.", "success");
    } catch (err) {
      toast("Error deleting comment: " + err.message, "error");
    }
  }
  else if (action === "submit-comment") {
    if (!auth.currentProfile?.is_verified) {
      $("verificationError").style.display = "none";
      $("verificationModal").classList.add("open");
      return;
    }
    const sec = target.closest(".comments-section");
    const textarea = sec.querySelector('[data-role="comment-input"]');
    const content = textarea.value.trim();
    if (!content) return;

    try {
      await posts.submitComment(postId, content);
      textarea.value = "";
    } catch (err) {
      if (err.message === "VERIFICATION_REQUIRED") {
        $("verificationError").style.display = "none";
        $("verificationModal").classList.add("open");
      } else {
        toast("Error: " + err.message, "error");
      }
    }
  }
});

document.addEventListener("click", (e) => {
  if (e.target.matches(".post-gallery img")) {
    $("imageViewerImg").src = e.target.src;
    $("imageViewer").classList.add("open");
  }
});

$("closeImageViewer").addEventListener("click", () => $("imageViewer").classList.remove("open"));

$("imageViewer").addEventListener("click", (e) => {
  if (e.target === $("imageViewer") || e.target === $("imageViewerImg")) $("imageViewer").classList.remove("open");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("imageViewer").classList.contains("open")) $("imageViewer").classList.remove("open");
});

window.addEventListener("error", (event) => {
  console.error("Global error:", event.error);
  const preloader = document.getElementById("preloader");
  if (preloader) {
    preloader.style.opacity = '0';
    setTimeout(() => preloader.remove(), 300);
  }
});

document.addEventListener("contextmenu", (e) => {
  if (e.target.matches("img, .post-gallery img, .post-author-avatar, .comment-avatar, .user-avatar-small, .profile-avatar-preview, #imageViewerImg")) {
    e.preventDefault();
  }
}, { capture: true });

document.addEventListener("dragstart", (e) => {
  if (e.target.matches("img")) e.preventDefault();
}, { capture: true });

autoGrowObserver.observe(document.body, { childList: true, subtree: true });
startApp();
