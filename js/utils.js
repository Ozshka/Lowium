export function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function sanitizeUrl(url) {
  if (!url) return "";
  const s = String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  if (/^\/[^\/]/.test(s)) return s;
  return "";
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatShortDate(iso) {
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function autoGrow(el) {
  if (!el || !el.classList.contains("auto-grow")) return;
  el.style.height = "auto";
  const maxH = parseFloat(getComputedStyle(el).maxHeight);
  const newH = el.scrollHeight;
  if (maxH && newH >= maxH) { 
    el.style.height = maxH + "px"; 
    el.classList.add("is-overflowing"); 
  } else { 
    el.style.height = newH + "px"; 
    el.classList.remove("is-overflowing"); 
  }
}

export function initAutoGrow(root = document) {
  root.querySelectorAll("textarea").forEach(el => {
    if (el.dataset.autoGrowInit) return;
    el.dataset.autoGrowInit = "1";
    el.classList.add("auto-grow");
    autoGrow(el);
    el.addEventListener("input", () => autoGrow(el));
    el.addEventListener("paste", () => setTimeout(() => autoGrow(el), 0));
  });
}

export const autoGrowObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    m.addedNodes.forEach(node => {
      if (node instanceof HTMLElement) {
        if (node.tagName === "TEXTAREA") initAutoGrow(node.parentElement || document);
        else if (node.querySelectorAll) initAutoGrow(node);
      }
    });
  }
});

export function toast(message, type = "info") {
  const toastContainer = document.getElementById("toastContainer");
  if (!toastContainer) return;
  
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML = `<span>${escapeHtml(message)}</span><button class="toast-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.2rem;margin-left:auto;">&times;</button>`;
  toastContainer.appendChild(el);
  
  const close = () => { 
    el.style.animation = "toastOut 0.2s ease forwards"; 
    setTimeout(() => el.remove(), 200); 
  };
  
  el.querySelector(".toast-close").onclick = close;
  setTimeout(() => { if (el.parentNode) close(); }, 4000);
}

/**
 * Перекодирует изображение через canvas, чтобы удалить EXIF/GPS/прочие метаданные.
 * Возвращает Blob того же (или приведённого) типа.
 * @param {File|Blob} file
 * @param {Object} opts { maxSize?: number, quality?: number, forceType?: string }
 * @returns {Promise<Blob>}
 */
export async function stripImageMetadata(file, opts = {}) {
  const { maxSize = 2048, quality = 0.9 } = opts;

  // GIF не трогаем — canvas убьёт анимацию
  if (file.type === "image/gif") return file;

  // SVG тоже не трогаем — это вектор, canvas его растеризует
  if (file.type === "image/svg+xml") return file;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  // Ограничиваем размер (чтобы не грузить 8K-фото)
  let { width, height } = img;
  if (Math.max(width, height) > maxSize) {
    const k = maxSize / Math.max(width, height);
    width = Math.round(width * k);
    height = Math.round(height * k);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  // Определяем выходной тип: jpeg для фото (без альфы), png для прозрачных
  const outType =
    file.type === "image/png" || file.type === "image/webp"
      ? file.type
      : "image/jpeg";

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, outType, quality)
  );

  return blob;
}

export function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const confirmTitle = document.getElementById("confirmTitle");
    const confirmText = document.getElementById("confirmText");
    const confirmOk = document.getElementById("confirmOk");
    const confirmCancel = document.getElementById("confirmCancel");

    confirmTitle.textContent = opts.title || "Confirm";
    confirmText.textContent = message;
    confirmOk.textContent = opts.okText || "Confirm";
    confirmOk.className = opts.danger === false ? "btn-primary" : "btn-danger-solid";
    modal.classList.add("open");
    
    const cleanup = () => {
      modal.classList.remove("open");
      confirmCancel.removeEventListener("click", onCancel);
      confirmOk.removeEventListener("click", onOk);
    };
    
    const onCancel = () => { cleanup(); resolve(false); };
    const onOk = () => { cleanup(); resolve(true); };
    
    confirmCancel.addEventListener("click", onCancel);
    confirmOk.addEventListener("click", onOk);
  });
}
